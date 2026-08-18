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
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
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
const deterministicChannelId = async (userIds: string[]) => {
  const source = userIds.slice().sort().join(":");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(source));
  const hash = Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `fg-dm-${hash.slice(0, 48)}`;
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

  let body: { friendUserId?: unknown };
  try { body = await req.json(); } catch { return json(400, { error: "Corps JSON invalide." }); }
  const friendUserId = String(body?.friendUserId || "").trim();
  if (!UUID_PATTERN.test(friendUserId)) return json(400, { error: "Identifiant utilisateur invalide." });

  const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const authResult = await supabaseAdmin.auth.getUser(jwt);
  const currentUser = authResult.data?.user;
  if (authResult.error || !currentUser) return json(401, { error: "Session invalide ou expirée." });
  if (currentUser.id === friendUserId) return json(400, { error: "Vous ne pouvez pas ouvrir une discussion avec vous-même." });

  const [relationResult, profilesResult] = await Promise.all([
    supabaseAdmin
      .from("user_relations")
      .select("id")
      .eq("status", "accepted")
      .or(`and(user_a.eq.${currentUser.id},user_b.eq.${friendUserId}),and(user_a.eq.${friendUserId},user_b.eq.${currentUser.id})`)
      .maybeSingle(),
    supabaseAdmin
      .from("users_profiles")
      .select("id, username, avatar_url")
      .in("id", [currentUser.id, friendUserId]),
  ]);
  const { data: relation, error: relationError } = relationResult;
  if (relationError) return json(500, { error: "Impossible de vérifier la relation d’amitié." });
  if (!relation) return json(403, { error: "Cette conversation est réservée aux amis acceptés." });

  const { data: profiles, error: profilesError } = profilesResult;
  if (profilesError) return json(500, { error: "Impossible de charger les profils." });
  if (!profiles || profiles.length !== 2) return json(404, { error: "Un des profils est introuvable." });

  try {
    const stream = StreamChat.getInstance(streamApiKey, streamApiSecret);
    const streamUsers = profiles.map((profile) => ({
      id: profile.id,
      name: String(profile.username || "Utilisateur"),
      username: String(profile.username || "Utilisateur"),
      image: absoluteAvatarUrl(profile.avatar_url, supabaseUrl),
    }));
    await stream.upsertUsers(streamUsers);
    const channelId = await deterministicChannelId([currentUser.id, friendUserId]);
    const channel = stream.channel("messaging", channelId, {
      members: [currentUser.id, friendUserId],
      created_by_id: currentUser.id,
      fg_relation_id: String(relation.id),
    });
    await channel.create();
    const friend = streamUsers.find((profile) => profile.id === friendUserId)!;
    return json(200, { channelType: "messaging", channelId, friend });
  } catch (error) {
    const diagnostic = safeStreamError(error, [streamApiSecret]);
    console.error("stream-open-conversation Stream API failure", diagnostic);
    return json(502, {
      error: "Impossible d’ouvrir la conversation Stream.",
      diagnostic,
    });
  }
});
