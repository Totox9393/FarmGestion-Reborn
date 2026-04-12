import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type MaintenanceRow = {
  enabled: boolean;
  title: string;
  message: string;
  eta_text: string | null;
  music_url: string | null;
  page_variant: "maintenance" | "waiting";
};

type FunctionAction = "save" | "sync_test";

type MaintenancePayload = MaintenanceRow & {
  action: FunctionAction;
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "content-type, authorization, apikey, x-client-info",
};

const jsonResponse = (status: number, payload: unknown) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });

const env = {
  supabaseUrl: Deno.env.get("SUPABASE_URL") || "",
  supabaseServiceRoleKey: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "",
  cloudflareApiToken: Deno.env.get("CLOUDFLARE_API_TOKEN") || "",
  cloudflareZoneId: Deno.env.get("CLOUDFLARE_ZONE_ID") || "",
  cloudflareRulesetId: Deno.env.get("CLOUDFLARE_REDIRECT_RULESET_ID") || "",
  cloudflareRuleId: Deno.env.get("CLOUDFLARE_MAINTENANCE_RULE_ID") || "",
};

const parseBody = async (req: Request): Promise<MaintenancePayload> => {
  const body = await req.json();
  const action = body?.action === "sync_test" ? "sync_test" : "save";
  const pageVariant = String(body?.page_variant || "maintenance").toLowerCase() === "waiting"
    ? "waiting"
    : "maintenance";

  return {
    action,
    enabled: Boolean(body?.enabled),
    title: String(body?.title || "").trim().slice(0, 160),
    message: String(body?.message || "").trim().slice(0, 700),
    eta_text: String(body?.eta_text || "").trim().slice(0, 140) || null,
    music_url: String(body?.music_url || "").trim().slice(0, 800) || null,
    page_variant: pageVariant,
  };
};

const normalizeRole = (value: unknown) => String(value || "").trim().toUpperCase();

const isAdminProfile = (profile: { role?: string | null; role_ingame?: string | null } | null) => {
  const role = normalizeRole(profile?.role);
  const roleIngame = normalizeRole(profile?.role_ingame);
  return role.includes("ADMIN") || roleIngame.includes("ADMIN");
};

type CloudflareRule = {
  id: string;
  action: string;
  expression: string;
  description?: string;
  enabled?: boolean;
  action_parameters?: Record<string, unknown>;
};

const parseCloudflareError = (payload: unknown, fallback = "Cloudflare update failed") => {
  const first = (payload as { errors?: Array<{ message?: string }> })?.errors?.[0]?.message;
  return String(first || fallback);
};

const getCloudflareMaintenanceRule = async (): Promise<CloudflareRule> => {
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/zones/${env.cloudflareZoneId}/rulesets/phases/http_request_dynamic_redirect/entrypoint`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${env.cloudflareApiToken}`,
        "Content-Type": "application/json",
      },
    },
  );

  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload?.success === false) {
    throw new Error(parseCloudflareError(payload, "Cloudflare rule lookup failed"));
  }

  const rules: CloudflareRule[] = Array.isArray(payload?.result?.rules) ? payload.result.rules : [];
  const target = rules.find((rule: CloudflareRule) => String(rule?.id || "") === env.cloudflareRuleId);

  if (!target) {
    throw new Error("Cloudflare maintenance rule not found in redirect entrypoint");
  }

  if (!target?.action || !target?.expression) {
    throw new Error("Cloudflare rule is missing required action/expression");
  }

  return {
    id: String(target.id),
    action: String(target.action),
    expression: String(target.expression),
    description: target?.description ? String(target.description) : undefined,
    enabled: Boolean(target?.enabled),
    action_parameters:
      target && typeof target.action_parameters === "object" && target.action_parameters !== null
        ? target.action_parameters
        : undefined,
  };
};

const setCloudflareMaintenanceRuleEnabled = async (enabled: boolean) => {
  const currentRule = await getCloudflareMaintenanceRule();

  const patchPayload: Record<string, unknown> = {
    id: currentRule.id,
    action: currentRule.action,
    expression: currentRule.expression,
    enabled,
  };

  if (currentRule.description) {
    patchPayload.description = currentRule.description;
  }

  if (currentRule.action_parameters) {
    patchPayload.action_parameters = currentRule.action_parameters;
  }

  const response = await fetch(
    `https://api.cloudflare.com/client/v4/zones/${env.cloudflareZoneId}/rulesets/${env.cloudflareRulesetId}/rules/${env.cloudflareRuleId}`,
    {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${env.cloudflareApiToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(patchPayload),
    },
  );

  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload?.success === false) {
    throw new Error(parseCloudflareError(payload));
  }
};

const testCloudflareSync = async () => {
  const currentRule = await getCloudflareMaintenanceRule();
  await setCloudflareMaintenanceRuleEnabled(Boolean(currentRule.enabled));
  return {
    enabled: Boolean(currentRule.enabled),
    description: currentRule.description || "",
  };
};

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse(405, { success: false, error: "Method Not Allowed" });
  }

  if (
    !env.supabaseUrl
    || !env.supabaseServiceRoleKey
    || !env.cloudflareApiToken
    || !env.cloudflareZoneId
    || !env.cloudflareRulesetId
    || !env.cloudflareRuleId
  ) {
    return jsonResponse(500, {
      success: false,
      error:
        "Missing secrets. Required: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, CLOUDFLARE_API_TOKEN, CLOUDFLARE_ZONE_ID, CLOUDFLARE_REDIRECT_RULESET_ID, CLOUDFLARE_MAINTENANCE_RULE_ID",
    });
  }

  const authHeader = req.headers.get("Authorization") || "";
  const jwt = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (!jwt) {
    return jsonResponse(401, { success: false, error: "Missing bearer token" });
  }

  const supabaseAdmin = createClient(env.supabaseUrl, env.supabaseServiceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const userResult = await supabaseAdmin.auth.getUser(jwt);
  if (userResult.error || !userResult.data?.user) {
    return jsonResponse(401, { success: false, error: "Invalid user token" });
  }

  const currentUserId = userResult.data.user.id;
  const { data: profile, error: profileError } = await supabaseAdmin
    .from("users_profiles")
    .select("role,role_ingame")
    .eq("id", currentUserId)
    .maybeSingle();

  if (profileError) {
    return jsonResponse(500, { success: false, error: "Unable to load user profile" });
  }

  if (!isAdminProfile(profile || null)) {
    return jsonResponse(403, { success: false, error: "Admin role required" });
  }

  let payload: MaintenancePayload;
  try {
    payload = await parseBody(req);
  } catch {
    return jsonResponse(400, { success: false, error: "Invalid JSON payload" });
  }

  if (payload.action === "sync_test") {
    try {
      const result = await testCloudflareSync();
      return jsonResponse(200, {
        success: true,
        message: "Synchronisation Cloudflare validee.",
        cloudflare: result,
      });
    } catch (error) {
      return jsonResponse(502, {
        success: false,
        error: `Cloudflare sync failed: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }

  const safeTitle = payload.title || "La ferme passe en atelier";
  const safeMessage = payload.message || "Nous preparons une version plus stable et plus rapide. Merci pour votre patience.";

  const { data: previousConfig, error: previousError } = await supabaseAdmin
    .from("site_maintenance_config")
    .select("enabled,title,message,eta_text,music_url,page_variant")
    .eq("id", true)
    .maybeSingle();

  if (previousError) {
    return jsonResponse(500, { success: false, error: "Unable to read maintenance configuration" });
  }

  const previousRow: MaintenanceRow = {
    enabled: Boolean(previousConfig?.enabled),
    title: String(previousConfig?.title || "La ferme passe en atelier"),
    message: String(previousConfig?.message || "Nous preparons une version plus stable et plus rapide. Merci pour votre patience."),
    eta_text: previousConfig?.eta_text ? String(previousConfig.eta_text) : null,
    music_url: previousConfig?.music_url ? String(previousConfig.music_url) : null,
    page_variant: String(previousConfig?.page_variant || "maintenance").toLowerCase() === "waiting"
      ? "waiting"
      : "maintenance",
  };

  const nowIso = new Date().toISOString();
  const nextRow = {
    id: true,
    enabled: payload.enabled,
    title: safeTitle,
    message: safeMessage,
    eta_text: payload.eta_text,
    music_url: payload.music_url,
    page_variant: payload.page_variant,
    updated_by: currentUserId,
    updated_at: nowIso,
  };

  const { error: saveError } = await supabaseAdmin
    .from("site_maintenance_config")
    .upsert(nextRow, { onConflict: "id" });

  if (saveError) {
    return jsonResponse(500, { success: false, error: "Unable to save maintenance configuration" });
  }

  try {
    await setCloudflareMaintenanceRuleEnabled(payload.enabled);
  } catch (error) {
    await supabaseAdmin
      .from("site_maintenance_config")
      .upsert(
        {
          id: true,
          enabled: previousRow.enabled,
          title: previousRow.title,
          message: previousRow.message,
          eta_text: previousRow.eta_text,
          music_url: previousRow.music_url,
          page_variant: previousRow.page_variant,
          updated_by: currentUserId,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "id" },
      );

    return jsonResponse(502, {
      success: false,
      error: `Cloudflare sync failed: ${error instanceof Error ? error.message : String(error)}`,
    });
  }

  return jsonResponse(200, {
    success: true,
    config: {
      ...nextRow,
    },
  });
});
