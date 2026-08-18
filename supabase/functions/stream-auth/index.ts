import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { StreamChat } from "npm:stream-chat@9.51.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "content-type, authorization, apikey, x-client-info",
};
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, "Content-Type": "application/json" },
});
const env = (name: string) => String(Deno.env.get(name) || "").trim();
const encodeBase64Url = (value: Uint8Array | string) => {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "");
};
const createStreamUserToken = async (userId: string, secret: string) => {
  const header = encodeBase64Url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = encodeBase64Url(JSON.stringify({ user_id: userId }));
  const unsignedToken = `${header}.${payload}`;
  const signingKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", signingKey, new TextEncoder().encode(unsignedToken));
  return `${unsignedToken}.${encodeBase64Url(new Uint8Array(signature))}`;
};
const safeStreamError = (error: unknown, secrets: string[]) => {
  const candidate = error as {
    message?: unknown;
    code?: unknown;
    status?: unknown;
    response?: { status?: unknown; data?: { code?: unknown; message?: unknown } };
  };
  const rawMessage = String(candidate?.response?.data?.message || candidate?.message || "Erreur Stream inconnue");
  const message = secrets.reduce(
    (current, secret) => secret ? current.replaceAll(secret, "[secret masqué]") : current,
    rawMessage,
  );
  return {
    message: message.slice(0, 500),
    code: candidate?.response?.data?.code ?? candidate?.code ?? null,
    status: candidate?.response?.status ?? candidate?.status ?? null,
  };
};
const absoluteAvatarUrl = (value: unknown, supabaseUrl: string) => {
  const raw = String(value || "").trim();
  if (!raw || /^https?:\/\//i.test(raw)) return raw;
  if (raw.startsWith("/storage/")) return `${supabaseUrl}${raw}`;
  if (raw.startsWith("storage/")) return `${supabaseUrl}/${raw}`;
  if (raw.includes("/")) return `${supabaseUrl}/storage/v1/object/public/${raw.replace(/^\/+/, "")}`;
  return `${supabaseUrl}/storage/v1/object/public/avatars/${raw}`;
};

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "Méthode non autorisée." });

  const supabaseUrl = env("SUPABASE_URL");
  const serviceRoleKey = env("SUPABASE_SERVICE_ROLE_KEY");
  const streamApiKey = env("STREAM_API_KEY");
  const streamApiSecret = env("STREAM_API_SECRET");
  const streamAppId = env("STREAM_APP_ID");
  if (!supabaseUrl || !serviceRoleKey || !streamApiKey || !streamApiSecret || !streamAppId) {
    return json(500, { error: "Configuration serveur Stream incomplète." });
  }

  const authHeader = req.headers.get("Authorization") || "";
  const jwt = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  if (!jwt) return json(401, { error: "Authentification requise." });

  const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const authResult = await supabaseAdmin.auth.getUser(jwt);
  const authUser = authResult.data?.user;
  if (authResult.error || !authUser) return json(401, { error: "Session invalide ou expirée." });

  const { data: profile, error: profileError } = await supabaseAdmin
    .from("users_profiles")
    .select("id, username, avatar_url")
    .eq("id", authUser.id)
    .maybeSingle();
  if (profileError) return json(500, { error: "Impossible de charger votre profil." });
  if (!profile) return json(404, { error: "Profil FarmGestion introuvable." });

  try {
    const stream = StreamChat.getInstance(streamApiKey, streamApiSecret);
    const streamUser = {
      id: authUser.id,
      name: String(profile.username || "Utilisateur"),
      username: String(profile.username || "Utilisateur"),
      image: absoluteAvatarUrl(profile.avatar_url, supabaseUrl),
    };
    await stream.upsertUser(streamUser);
    // stream-chat's Node JWT signer is not compatible with the esm.sh bundle
    // used by Supabase Edge Functions ("sign is not a function"). Web Crypto
    // produces the same HS256 Stream user token natively in Deno.
    const token = await createStreamUserToken(authUser.id, streamApiSecret);
    return json(200, { apiKey: streamApiKey, token, user: streamUser });
  } catch (error) {
    const diagnostic = safeStreamError(error, [streamApiSecret]);
    console.error("stream-auth Stream API failure", diagnostic);
    return json(502, {
      error: "Impossible de connecter la messagerie Stream.",
      diagnostic,
    });
  }
});
