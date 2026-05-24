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

type FunctionAction =
  | "save"
  | "sync_test"
  | "status"
  | "allowlist_status"
  | "allowlist_add"
  | "allowlist_remove"
  | "allowlist_add_my_ip";

type FunctionPayload = MaintenanceRow & {
  action: FunctionAction;
  ip: string;
  item_id: string;
  comment: string;
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

const normalizeSecret = (value: string | null) => {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) {
    return raw.slice(1, -1).trim();
  }
  return raw;
};

const normalizeBearerSecret = (value: string | null) => {
  const cleaned = normalizeSecret(value);
  return cleaned.replace(/^Bearer\s+/i, "").trim();
};

const env = {
  supabaseUrl: normalizeSecret(Deno.env.get("SUPABASE_URL")),
  supabaseServiceRoleKey: normalizeSecret(Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")),
  cloudflareApiToken: normalizeBearerSecret(Deno.env.get("CLOUDFLARE_API_TOKEN")),
  cloudflareAccountApiToken: normalizeBearerSecret(Deno.env.get("CLOUDFLARE_ACCOUNT_API_TOKEN")),
  cloudflareZoneId: normalizeSecret(Deno.env.get("CLOUDFLARE_ZONE_ID")),
  cloudflareRulesetId: normalizeSecret(Deno.env.get("CLOUDFLARE_REDIRECT_RULESET_ID")),
  cloudflareRuleId: normalizeSecret(Deno.env.get("CLOUDFLARE_MAINTENANCE_RULE_ID")),
  cloudflareAccountId: normalizeSecret(Deno.env.get("CLOUDFLARE_ACCOUNT_ID")),
  cloudflareAllowlistListId: normalizeSecret(Deno.env.get("CLOUDFLARE_WHITELIST_LIST_ID")),
  cloudflareAllowlistListName: normalizeSecret(Deno.env.get("CLOUDFLARE_WHITELIST_LIST_NAME")),
};

const parseBody = async (req: Request): Promise<FunctionPayload> => {
  const body = await req.json();
  const rawAction = String(body?.action || "save").trim().toLowerCase();
  const action: FunctionAction =
    rawAction === "allowlist_status"
      ? "allowlist_status"
      : rawAction === "allowlist_add"
        ? "allowlist_add"
        : rawAction === "allowlist_remove"
          ? "allowlist_remove"
          : rawAction === "allowlist_add_my_ip"
            ? "allowlist_add_my_ip"
            : rawAction === "status"
      ? "status"
      : rawAction === "sync_test"
        ? "sync_test"
        : "save";
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
    ip: String(body?.ip || "").trim().slice(0, 120),
    item_id: String(body?.item_id || "").trim().slice(0, 120),
    comment: String(body?.comment || "").trim().slice(0, 140),
  };
};

const normalizeRole = (value: unknown) => String(value || "").trim().toUpperCase();

const isAdminProfile = (profile: { role?: string | null; role_ingame?: string | null } | null) => {
  const role = normalizeRole(profile?.role);
  const roleIngame = normalizeRole(profile?.role_ingame);
  return role.includes("ADMIN") || roleIngame.includes("ADMIN");
};

const normalizePageVariant = (value: unknown): "maintenance" | "waiting" =>
  String(value || "maintenance").toLowerCase() === "waiting" ? "waiting" : "maintenance";

type CloudflareRule = {
  id: string;
  action: string;
  expression: string;
  description?: string;
  enabled?: boolean;
  action_parameters?: Record<string, unknown>;
};

type CloudflareListSummary = {
  id: string;
  name: string;
  kind?: string;
};

type CloudflareListItem = {
  id: string;
  value: string;
  comment: string;
  created_on: string | null;
  modified_on: string | null;
};

const parseCloudflareError = (payload: unknown, fallback = "Cloudflare update failed") => {
  const first = (payload as { errors?: Array<{ message?: string }> })?.errors?.[0]?.message;
  const message = String(first || fallback);
  const lower = message.toLowerCase();
  if (lower.includes("missing authorization header") || lower.includes("authentication error")) {
    return "Cloudflare auth failed. For allowlist, use an account-scoped token with Account Filter Lists (Read/Edit) and set CLOUDFLARE_ACCOUNT_API_TOKEN.";
  }
  return message;
};

const getCloudflareToken = (scope: "zone" | "account") => {
  if (scope === "account") {
    return env.cloudflareAccountApiToken || env.cloudflareApiToken;
  }
  return env.cloudflareApiToken;
};

const normalizeMaybeIp = (rawValue: string) => {
  const trimmed = String(rawValue || "").trim();
  if (!trimmed) return "";
  if (trimmed.includes(",")) return trimmed.split(",")[0].trim();

  if (trimmed.startsWith("[") && trimmed.includes("]")) {
    const endBracket = trimmed.indexOf("]");
    return trimmed.slice(1, endBracket).trim();
  }

  const colonCount = (trimmed.match(/:/g) || []).length;
  if (colonCount === 1 && trimmed.includes(".")) {
    const [host] = trimmed.split(":");
    return host.trim();
  }

  return trimmed;
};

const IPV4_CIDR_REGEX = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}(\/(3[0-2]|[12]?\d))?$/;

const isValidIpv6WithOptionalCidr = (value: string) => {
  const trimmed = String(value || "").trim();
  if (!trimmed.includes(":")) return false;

  const [base, cidrPart] = trimmed.split("/");
  if (!base) return false;

  if (cidrPart !== undefined) {
    const cidr = Number(cidrPart);
    if (!Number.isInteger(cidr) || cidr < 0 || cidr > 128) return false;
  }

  if (!/^[0-9a-fA-F:]+$/.test(base)) return false;

  const pieces = base.split("::");
  if (pieces.length > 2) return false;

  const left = pieces[0] ? pieces[0].split(":") : [];
  const right = pieces.length === 2 && pieces[1] ? pieces[1].split(":") : [];
  const allParts = [...left, ...right].filter((part) => part.length > 0);

  if (allParts.some((part) => part.length > 4 || !/^[0-9a-fA-F]+$/.test(part))) {
    return false;
  }

  if (pieces.length === 1 && allParts.length !== 8) {
    return false;
  }

  if (pieces.length === 2 && allParts.length >= 8) {
    return false;
  }

  return true;
};

const isValidIpOrCidr = (value: string) => {
  const normalized = normalizeMaybeIp(value);
  if (!normalized) return false;
  if (IPV4_CIDR_REGEX.test(normalized)) return true;
  return isValidIpv6WithOptionalCidr(normalized);
};

const getIpVersion = (value: string): 4 | 6 | null => {
  const normalized = normalizeMaybeIp(value);
  if (!normalized) return null;
  if (IPV4_CIDR_REGEX.test(normalized)) return 4;
  if (isValidIpv6WithOptionalCidr(normalized)) return 6;
  return null;
};

const parseIpv4ToInt = (value: string): number | null => {
  const normalized = normalizeMaybeIp(value);
  const base = normalized.split("/")[0];
  const parts = base.split(".");
  if (parts.length !== 4) return null;
  const nums = parts.map((part) => Number(part));
  if (nums.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
  return ((nums[0] << 24) >>> 0) + ((nums[1] << 16) >>> 0) + ((nums[2] << 8) >>> 0) + nums[3];
};

const parseIpv6ToHextets = (value: string): number[] | null => {
  const normalized = normalizeMaybeIp(value);
  const base = normalized.split("/")[0].toLowerCase();
  if (!base || !base.includes(":")) return null;

  const [leftRaw, rightRaw] = base.split("::");
  if (base.split("::").length > 2) return null;

  const parseSide = (side: string) => {
    if (!side) return [] as number[];
    const tokens = side.split(":").filter(Boolean);
    const out: number[] = [];
    for (const token of tokens) {
      if (token.includes(".")) {
        const v4 = parseIpv4ToInt(token);
        if (v4 === null) return null;
        out.push((v4 >>> 16) & 0xffff, v4 & 0xffff);
        continue;
      }
      const n = Number.parseInt(token, 16);
      if (!Number.isInteger(n) || n < 0 || n > 0xffff) return null;
      out.push(n);
    }
    return out;
  };

  const left = parseSide(leftRaw || "");
  if (!left) return null;
  const right = parseSide(rightRaw || "");
  if (!right) return null;

  if (base.includes("::")) {
    const missing = 8 - (left.length + right.length);
    if (missing < 1) return null;
    return [...left, ...new Array(missing).fill(0), ...right];
  }

  if (left.length !== 8) return null;
  return left;
};

const parseIpv6ToBigInt = (value: string): bigint | null => {
  const hextets = parseIpv6ToHextets(value);
  if (!hextets || hextets.length !== 8) return null;
  return hextets.reduce((acc, part) => (acc << 16n) + BigInt(part), 0n);
};

const isRequesterIpAllowedByEntry = (requesterIp: string, entryValue: string) => {
  const requester = normalizeMaybeIp(requesterIp);
  const entry = normalizeMaybeIp(entryValue);
  if (!requester || !entry) return false;

  const [entryBase, entryPrefixRaw] = entry.split("/");
  const requesterVersion = getIpVersion(requester);
  const entryVersion = getIpVersion(entryBase);
  if (!requesterVersion || !entryVersion || requesterVersion !== entryVersion) return false;

  if (entryPrefixRaw === undefined) {
    return requester.toLowerCase() === entryBase.toLowerCase();
  }

  const prefix = Number(entryPrefixRaw);
  if (!Number.isInteger(prefix)) return false;

  if (requesterVersion === 4) {
    if (prefix < 0 || prefix > 32) return false;
    const requesterInt = parseIpv4ToInt(requester);
    const entryInt = parseIpv4ToInt(entryBase);
    if (requesterInt === null || entryInt === null) return false;
    const mask = prefix === 0 ? 0 : ((0xffffffff << (32 - prefix)) >>> 0);
    return (requesterInt & mask) === (entryInt & mask);
  }

  if (prefix < 0 || prefix > 128) return false;
  const requesterBig = parseIpv6ToBigInt(requester);
  const entryBig = parseIpv6ToBigInt(entryBase);
  if (requesterBig === null || entryBig === null) return false;
  const shift = BigInt(128 - prefix);
  if (prefix === 0) return true;
  return (requesterBig >> shift) === (entryBig >> shift);
};

const buildIpv6Prefix64 = (value: string) => {
  const hextets = parseIpv6ToHextets(value);
  if (!hextets || hextets.length !== 8) return "";
  const left = hextets.slice(0, 4).map((part) => part.toString(16));
  return `${left.join(":")}::/64`;
};

const extractRequesterIp = (req: Request) => {
  const headerCandidates = [
    req.headers.get("CF-Connecting-IP"),
    req.headers.get("X-Forwarded-For"),
    req.headers.get("x-real-ip"),
  ];

  for (const candidate of headerCandidates) {
    const normalized = normalizeMaybeIp(String(candidate || ""));
    if (isValidIpOrCidr(normalized)) {
      return normalized;
    }
  }

  return "";
};

const cloudflareAccountBaseUrl = () =>
  `https://api.cloudflare.com/client/v4/accounts/${env.cloudflareAccountId}/rules/lists`;

const cloudflareAccountFetch = async (path: string, init: RequestInit = {}) => {
  const accountToken = getCloudflareToken("account");
  const response = await fetch(`${cloudflareAccountBaseUrl()}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${accountToken}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });

  const payload = await response.json().catch(() => ({}));
  return { response, payload };
};

const resolveAllowlistId = async () => {
  const directId = String(env.cloudflareAllowlistListId || "").trim();
  if (directId) return directId;

  const targetName = String(env.cloudflareAllowlistListName || "").trim();
  if (!targetName) {
    throw new Error("Missing allowlist configuration: set CLOUDFLARE_WHITELIST_LIST_ID or CLOUDFLARE_WHITELIST_LIST_NAME");
  }

  const { response, payload } = await cloudflareAccountFetch("?per_page=200");
  if (!response.ok || payload?.success === false) {
    throw new Error(parseCloudflareError(payload, "Cloudflare lists lookup failed"));
  }

  const rows: CloudflareListSummary[] = Array.isArray(payload?.result)
    ? payload.result
        .map((item: unknown) => ({
          id: String((item as { id?: string })?.id || ""),
          name: String((item as { name?: string })?.name || ""),
          kind: String((item as { kind?: string })?.kind || ""),
        }))
        .filter((item: CloudflareListSummary) => item.id && item.name)
    : [];

  const found = rows.find((item) => item.name === targetName);
  if (!found?.id) {
    throw new Error(`Cloudflare allowlist not found: ${targetName}`);
  }

  return found.id;
};

const fetchAllowlistItems = async (listId: string): Promise<CloudflareListItem[]> => {
  const mergedRows: CloudflareListItem[] = [];
  const seenIds = new Set<string>();
  let page = 1;

  while (page <= 20) {
    const { response, payload } = await cloudflareAccountFetch(`/${listId}/items?page=${page}&per_page=500`);
    if (!response.ok || payload?.success === false) {
      throw new Error(parseCloudflareError(payload, "Cloudflare allowlist read failed"));
    }

    const rows = Array.isArray(payload?.result) ? payload.result : [];
    if (!rows.length) break;

    for (const row of rows) {
      const id = String((row as { id?: string })?.id || "").trim();
      if (!id || seenIds.has(id)) continue;
      seenIds.add(id);

      const value = String(
        (row as { ip?: string; value?: string; asn?: number })?.ip
          || (row as { value?: string })?.value
          || "",
      ).trim();

      mergedRows.push({
        id,
        value,
        comment: String((row as { comment?: string })?.comment || "").trim(),
        created_on: (row as { created_on?: string })?.created_on || null,
        modified_on: (row as { modified_on?: string })?.modified_on || null,
      });
    }

    if (rows.length < 500) break;
    page += 1;
  }

  return mergedRows
    .filter((item) => item.value)
    .sort((a, b) => a.value.localeCompare(b.value, "en"));
};

const tryCloudflareListMutation = async (path: string, method: "POST" | "PUT" | "PATCH" | "DELETE", bodies: unknown[]) => {
  let lastError = "Cloudflare allowlist mutation failed";

  for (const body of bodies) {
    const { response, payload } = await cloudflareAccountFetch(path, {
      method,
      body: body === null ? undefined : JSON.stringify(body),
    });

    if (response.ok && payload?.success !== false) {
      return;
    }

    lastError = parseCloudflareError(payload, `Cloudflare allowlist ${method} failed`);
  }

  throw new Error(lastError);
};

const addAllowlistIp = async (listId: string, ip: string, comment: string) => {
  const normalizedIp = normalizeMaybeIp(ip);
  const trimmedComment = String(comment || "").trim().slice(0, 120);

  await tryCloudflareListMutation(`/${listId}/items`, "POST", [
    [{ ip: normalizedIp, comment: trimmedComment || undefined }],
    { items: [{ ip: normalizedIp, comment: trimmedComment || undefined }] },
    [{ value: normalizedIp, comment: trimmedComment || undefined }],
    { items: [{ value: normalizedIp, comment: trimmedComment || undefined }] },
  ]);
};

const deleteAllowlistItem = async (listId: string, itemId: string) => {
  const directDelete = await cloudflareAccountFetch(`/${listId}/items/${itemId}`, {
    method: "DELETE",
  });

  if (directDelete.response.ok && directDelete.payload?.success !== false) {
    return;
  }

  await tryCloudflareListMutation(`/${listId}/items`, "DELETE", [
    [{ id: itemId }],
    { items: [{ id: itemId }] },
  ]);
};

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const getCloudflareMaintenanceRule = async (): Promise<CloudflareRule> => {
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/zones/${env.cloudflareZoneId}/rulesets/phases/http_request_dynamic_redirect/entrypoint`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${getCloudflareToken("zone")}`,
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
        Authorization: `Bearer ${getCloudflareToken("zone")}`,
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

const readMaintenanceConfig = async (supabaseAdmin: ReturnType<typeof createClient>) => {
  const { data, error } = await supabaseAdmin
    .from("site_maintenance_config")
    .select("enabled,page_variant,title,message,eta_text,music_url,updated_at")
    .eq("id", true)
    .maybeSingle();

  if (error) throw new Error("Unable to read maintenance configuration");

  return {
    enabled: Boolean(data?.enabled),
    page_variant: normalizePageVariant(data?.page_variant),
    title: String(data?.title || "La ferme passe en atelier"),
    message: String(data?.message || "Nous preparons une version plus stable et plus rapide. Merci pour votre patience."),
    eta_text: data?.eta_text ? String(data.eta_text) : null,
    music_url: data?.music_url ? String(data.music_url) : null,
    updated_at: data?.updated_at ? String(data.updated_at) : null,
  };
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

  let payload: FunctionPayload;
  try {
    payload = await parseBody(req);
  } catch {
    return jsonResponse(400, { success: false, error: "Invalid JSON payload" });
  }

  const allowlistActions = new Set<FunctionAction>([
    "allowlist_status",
    "allowlist_add",
    "allowlist_remove",
    "allowlist_add_my_ip",
  ]);

  if (allowlistActions.has(payload.action) && (!env.cloudflareAccountId || (!env.cloudflareAllowlistListId && !env.cloudflareAllowlistListName))) {
    return jsonResponse(500, {
      success: false,
      error:
        "Missing allowlist secrets. Required: CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_WHITELIST_LIST_ID (or CLOUDFLARE_WHITELIST_LIST_NAME)",
    });
  }

  if (allowlistActions.has(payload.action) && !getCloudflareToken("account")) {
    return jsonResponse(500, {
      success: false,
      error:
        "Missing Cloudflare account token for allowlist. Set CLOUDFLARE_ACCOUNT_API_TOKEN (recommended) or use CLOUDFLARE_API_TOKEN with Account Filter Lists permissions.",
    });
  }

  if (payload.action === "allowlist_status") {
    try {
      const listId = await resolveAllowlistId();
      const items = await fetchAllowlistItems(listId);
      const requesterIp = extractRequesterIp(req);
      const requesterAllowed = requesterIp
        ? items.some((item) => isRequesterIpAllowedByEntry(requesterIp, String(item.value || "")))
        : false;
      const requesterVersion = requesterIp ? getIpVersion(requesterIp) : null;
      const suggestedIpv6Prefix64 = requesterVersion === 6 ? buildIpv6Prefix64(requesterIp) : "";

      return jsonResponse(200, {
        success: true,
        allowlist: {
          list_id: listId,
          list_name: String(env.cloudflareAllowlistListName || "").trim() || null,
          items,
          total: items.length,
          requester_ip: requesterIp || null,
          requester_ip_version: requesterVersion,
          requester_suggested_ipv6_prefix_64: suggestedIpv6Prefix64 || null,
          requester_allowed: requesterAllowed,
        },
      });
    } catch (error) {
      return jsonResponse(502, {
        success: false,
        error: `Cloudflare allowlist read failed: ${error instanceof Error ? error.message : String(error)} (account_id=${env.cloudflareAccountId || "missing"}, list_name=${env.cloudflareAllowlistListName || "missing"})`,
      });
    }
  }

  if (payload.action === "allowlist_add" || payload.action === "allowlist_add_my_ip") {
    const sourceIp = payload.action === "allowlist_add_my_ip"
      ? extractRequesterIp(req)
      : normalizeMaybeIp(payload.ip);

    if (!isValidIpOrCidr(sourceIp)) {
      return jsonResponse(400, {
        success: false,
        error: "Invalid IP/CIDR format.",
      });
    }

    try {
      const listId = await resolveAllowlistId();
      const currentItems = await fetchAllowlistItems(listId);
      const sourceVersion = getIpVersion(sourceIp);

      const requestedValues = [sourceIp];
      if (payload.action === "allowlist_add_my_ip" && sourceVersion === 6) {
        const prefix64 = buildIpv6Prefix64(sourceIp);
        if (prefix64) requestedValues.push(prefix64);
      }

      const uniqueRequested = Array.from(new Set(requestedValues.map((value) => normalizeMaybeIp(value)).filter(Boolean)));
      const valuesToAdd = uniqueRequested.filter(
        (value) => !currentItems.some((item) => isRequesterIpAllowedByEntry(value, String(item.value || ""))),
      );

      if (!valuesToAdd.length) {
        return jsonResponse(409, {
          success: false,
          error: "IP deja couverte par la allowlist.",
        });
      }

      for (const value of valuesToAdd) {
        const comment = value.includes("/64")
          ? (payload.comment || "auto_ipv6_prefix_64")
          : (payload.comment || "");
        await addAllowlistIp(listId, value, comment);
      }

      let nextItems = await fetchAllowlistItems(listId);
      for (let attempt = 0; attempt < 4; attempt += 1) {
        const allPresent = valuesToAdd.every((value) =>
          nextItems.some((item) => isRequesterIpAllowedByEntry(value, String(item.value || ""))),
        );
        if (allPresent) break;
        await pause(220);
        nextItems = await fetchAllowlistItems(listId);
      }

      return jsonResponse(200, {
        success: true,
        added_values: valuesToAdd,
        allowlist: {
          list_id: listId,
          items: nextItems,
          total: nextItems.length,
        },
      });
    } catch (error) {
      return jsonResponse(502, {
        success: false,
        error: `Cloudflare allowlist add failed: ${error instanceof Error ? error.message : String(error)} (account_id=${env.cloudflareAccountId || "missing"}, list_name=${env.cloudflareAllowlistListName || "missing"})`,
      });
    }
  }

  if (payload.action === "allowlist_remove") {
    const targetItemId = String(payload.item_id || "").trim();
    const targetIp = normalizeMaybeIp(payload.ip);

    if (!targetItemId && !targetIp) {
      return jsonResponse(400, {
        success: false,
        error: "Missing item_id or ip for removal.",
      });
    }

    try {
      const listId = await resolveAllowlistId();
      const currentItems = await fetchAllowlistItems(listId);
      const resolvedItem = targetItemId
        ? currentItems.find((item) => item.id === targetItemId)
        : currentItems.find((item) => String(item.value || "").trim().toLowerCase() === targetIp.toLowerCase());

      if (!resolvedItem?.id) {
        return jsonResponse(404, {
          success: false,
          error: "IP entry not found in allowlist.",
        });
      }

      await deleteAllowlistItem(listId, resolvedItem.id);

      let nextItems = await fetchAllowlistItems(listId);
      for (let attempt = 0; attempt < 4; attempt += 1) {
        const stillPresent = nextItems.some((item) => item.id === resolvedItem.id);
        if (!stillPresent) break;
        await pause(220);
        nextItems = await fetchAllowlistItems(listId);
      }

      return jsonResponse(200, {
        success: true,
        allowlist: {
          list_id: listId,
          items: nextItems,
          total: nextItems.length,
        },
      });
    } catch (error) {
      return jsonResponse(502, {
        success: false,
        error: `Cloudflare allowlist delete failed: ${error instanceof Error ? error.message : String(error)} (account_id=${env.cloudflareAccountId || "missing"}, list_name=${env.cloudflareAllowlistListName || "missing"})`,
      });
    }
  }

  if (payload.action === "status") {
    try {
      const dbConfig = await readMaintenanceConfig(supabaseAdmin);
      const cloudflareRule = await getCloudflareMaintenanceRule();
      const cloudflareEnabled = Boolean(cloudflareRule.enabled);

      if (dbConfig.enabled !== cloudflareEnabled) {
        await supabaseAdmin
          .from("site_maintenance_config")
          .upsert(
            {
              id: true,
              enabled: cloudflareEnabled,
              page_variant: dbConfig.page_variant,
              title: dbConfig.title,
              message: dbConfig.message,
              eta_text: dbConfig.eta_text,
              music_url: dbConfig.music_url,
              updated_by: currentUserId,
              updated_at: new Date().toISOString(),
            },
            { onConflict: "id" },
          );
      }

      return jsonResponse(200, {
        success: true,
        config: {
          ...dbConfig,
          enabled: cloudflareEnabled,
        },
        cloudflare: {
          enabled: cloudflareEnabled,
          rule_id: cloudflareRule.id,
        },
      });
    } catch (error) {
      return jsonResponse(502, {
        success: false,
        error: `Cloudflare sync failed: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
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

  let previousRow: MaintenanceRow;
  try {
    previousRow = await readMaintenanceConfig(supabaseAdmin);
  } catch {
    return jsonResponse(500, { success: false, error: "Unable to read maintenance configuration" });
  }

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
