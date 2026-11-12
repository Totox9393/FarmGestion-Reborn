import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type AccountAction = "reset_password" | "ban";

type Payload = {
  action?: unknown;
  userId?: unknown;
  redirectTo?: unknown;
};

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
const normalizedRole = (value: unknown) => String(value || "").trim().toUpperCase();

const isAdmin = (profile: { role?: string | null; role_ingame?: string | null } | null) => (
  normalizedRole(profile?.role) === "ADMIN" || normalizedRole(profile?.role_ingame) === "ADMIN"
);

const parseAction = (value: unknown): AccountAction | null => {
  const action = String(value || "").trim().toLowerCase();
  return action === "reset_password" || action === "ban" ? action : null;
};

const parseRedirectTo = (value: unknown) => {
  const raw = String(value || "").trim();
  if (!raw || raw.length > 800) return undefined;

  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
    return url.toString();
  } catch {
    return undefined;
  }
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { success: false, error: "METHOD_NOT_ALLOWED" });

  const supabaseUrl = env("SUPABASE_URL");
  const serviceRoleKey = env("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    return json(500, { success: false, error: "SERVER_CONFIGURATION_MISSING" });
  }

  const authHeader = req.headers.get("Authorization") || "";
  const jwt = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  if (!jwt) return json(401, { success: false, error: "AUTHENTICATION_REQUIRED" });

  let payload: Payload;
  try {
    payload = await req.json();
  } catch {
    return json(400, { success: false, error: "INVALID_PAYLOAD" });
  }

  const action = parseAction(payload.action);
  const targetUserId = String(payload.userId || "").trim();
  if (!action || !targetUserId) return json(400, { success: false, error: "INVALID_ACTION_OR_USER" });

  const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const callerResult = await supabaseAdmin.auth.getUser(jwt);
  const caller = callerResult.data?.user;
  if (callerResult.error || !caller) return json(401, { success: false, error: "INVALID_SESSION" });

  const { data: callerProfile, error: callerProfileError } = await supabaseAdmin
    .from("users_profiles")
    .select("id,role,role_ingame")
    .eq("id", caller.id)
    .maybeSingle();

  if (callerProfileError) return json(500, { success: false, error: "CALLER_PROFILE_UNAVAILABLE" });
  if (!isAdmin(callerProfile)) return json(403, { success: false, error: "ADMIN_REQUIRED" });

  if (action === "ban" && targetUserId === caller.id) {
    return json(403, { success: false, error: "SELF_BAN_FORBIDDEN" });
  }

  const { data: targetProfile, error: targetProfileError } = await supabaseAdmin
    .from("users_profiles")
    .select("id,email")
    .eq("id", targetUserId)
    .maybeSingle();

  if (targetProfileError) return json(500, { success: false, error: "TARGET_PROFILE_UNAVAILABLE" });
  if (!targetProfile) return json(404, { success: false, error: "USER_NOT_FOUND" });

  if (action === "reset_password") {
    const email = String(targetProfile.email || "").trim();
    if (!email) return json(422, { success: false, error: "TARGET_EMAIL_MISSING" });

    const redirectTo = parseRedirectTo(payload.redirectTo);
    const { error } = await supabaseAdmin.auth.resetPasswordForEmail(
      email,
      redirectTo ? { redirectTo } : undefined,
    );
    if (error) return json(502, { success: false, error: "PASSWORD_EMAIL_FAILED" });

    return json(200, { success: true, action, user_id: targetUserId, email });
  }

  const { data, error } = await supabaseAdmin.auth.admin.updateUserById(targetUserId, {
    // 100 ans : une suspension sans date de fin, réversible ultérieurement par un outil admin dédié.
    ban_duration: "876000h",
  });
  if (error) return json(502, { success: false, error: "BAN_FAILED" });

  return json(200, {
    success: true,
    action,
    user_id: targetUserId,
    banned_until: data.user?.banned_until || null,
  });
});
