import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type ActionName = "list" | "update_money" | "ban" | "unban" | "reset_password" | "delete";

type Payload = {
  key: string;
  action: ActionName | string;
  userId?: string;
  email?: string;
  money?: unknown;
};

type ProfileRow = {
  id: string;
  username?: string | null;
  email?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  avatar_url?: string | null;
  role?: string | null;
  role_ingame?: string | null;
  money?: number | null;
  farm_id?: string | null;
};

type AuthUserState = {
  banned_until?: string | null;
  last_sign_in_at?: string | null;
};

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "content-type, authorization, apikey, x-client-info",
};

const jsonResponse = (status: number, payload: unknown) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });

const normalizeSecret = (value: string | null) => {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) {
    return raw.slice(1, -1).trim();
  }
  return raw;
};

const parseEmail = (value: unknown) => String(value || "").trim().toLowerCase();

const isValidEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

const parseAction = (value: unknown): ActionName | "" => {
  const raw = String(value || "").trim().toLowerCase();
  if (raw === "list") return "list";
  if (raw === "update_money") return "update_money";
  if (raw === "ban") return "ban";
  if (raw === "unban") return "unban";
  if (raw === "reset_password") return "reset_password";
  if (raw === "delete") return "delete";
  return "";
};

const parseRequestBody = async (req: Request): Promise<Record<string, unknown> | null> => {
  const ct = (req.headers.get("content-type") || "").toLowerCase();

  if (ct.includes("application/json")) {
    try {
      return (await req.json()) as Record<string, unknown>;
    } catch {
      return null;
    }
  }

  try {
    const text = await req.text();
    if (!text.trim()) return {};
    try {
      return JSON.parse(text) as Record<string, unknown>;
    } catch {
      const params = new URLSearchParams(text);
      const obj: Record<string, unknown> = {};
      params.forEach((val, key) => {
        obj[key] = val;
      });
      return obj;
    }
  } catch {
    return null;
  }
};

const parsePayload = async (req: Request): Promise<Payload | null> => {
  const method = req.method.toUpperCase();

  if (method === "GET") {
    const url = new URL(req.url);
    return {
      key: String(url.searchParams.get("key") || "").trim(),
      action: String(url.searchParams.get("action") || "").trim().toLowerCase(),
      userId: String(url.searchParams.get("userId") || "").trim(),
      email: String(url.searchParams.get("email") || "").trim(),
      money: url.searchParams.get("money"),
    };
  }

  if (method === "POST") {
    const body = await parseRequestBody(req);
    if (!body) return null;

    return {
      key: String(body.key || "").trim(),
      action: String(body.action || "").trim().toLowerCase(),
      userId: String(body.userId || "").trim(),
      email: String(body.email || "").trim(),
      money: body.money,
    };
  }

  return null;
};

const toIso = (value: unknown): string | null => {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
};

const isUserActive = (bannedUntil: unknown): boolean => {
  const bannedUntilIso = toIso(bannedUntil);
  if (!bannedUntilIso) return true;
  return Date.parse(bannedUntilIso) <= Date.now();
};

const loadAuthStatesFromSchema = async (
  supabase: ReturnType<typeof createClient>,
  userIds: string[],
): Promise<Map<string, AuthUserState>> => {
  const map = new Map<string, AuthUserState>();
  if (!userIds.length) return map;

  const { data, error } = await supabase
    .schema("auth")
    .from("users")
    .select("id,banned_until,last_sign_in_at")
    .in("id", userIds);

  if (error) {
    throw new Error(error.message);
  }

  (data || []).forEach((row) => {
    const id = String((row as { id?: string }).id || "").trim();
    if (!id) return;
    const authRow = row as { banned_until?: string | null; last_sign_in_at?: string | null };
    map.set(id, {
      banned_until: authRow.banned_until || null,
      last_sign_in_at: authRow.last_sign_in_at || null,
    });
  });

  return map;
};

const loadAuthStatesFromAdminApi = async (
  supabase: ReturnType<typeof createClient>,
  userIds: string[],
): Promise<Map<string, AuthUserState>> => {
  const wanted = new Set(userIds.map((id) => String(id || "").trim()).filter(Boolean));
  const map = new Map<string, AuthUserState>();
  if (!wanted.size) return map;

  let page = 1;
  const perPage = 1000;

  while (wanted.size > 0) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage });
    if (error) throw new Error(`Failed to list auth users: ${error.message}`);

    const users = data?.users || [];
    if (!users.length) break;

    users.forEach((user) => {
      const id = String(user.id || "").trim();
      if (!id || !wanted.has(id)) return;
      map.set(id, {
        banned_until: user.banned_until || null,
        last_sign_in_at: user.last_sign_in_at || null,
      });
      wanted.delete(id);
    });

    if (users.length < perPage) break;
    page += 1;
  }

  return map;
};

const loadAuthStates = async (supabase: ReturnType<typeof createClient>, userIds: string[]) => {
  try {
    return await loadAuthStatesFromSchema(supabase, userIds);
  } catch {
    return loadAuthStatesFromAdminApi(supabase, userIds);
  }
};

const parseMoney = (value: unknown): number | null => {
  if (typeof value === "number") {
    if (!Number.isFinite(value) || !Number.isInteger(value) || value < 0) return null;
    return value;
  }

  if (typeof value === "string") {
    const raw = value.trim();
    if (!raw) return null;
    if (!/^\d+$/.test(raw)) return null;
    const parsed = Number(raw);
    if (!Number.isSafeInteger(parsed) || parsed < 0) return null;
    return parsed;
  }

  return null;
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }

  if (req.method !== "GET" && req.method !== "POST") {
    return jsonResponse(405, { ok: false, error: "Method not allowed" });
  }

  const payload = await parsePayload(req);
  if (!payload) {
    return jsonResponse(400, { ok: false, error: "Invalid payload" });
  }

  const action = parseAction(payload.action);
  if (!action) {
    return jsonResponse(400, {
      ok: false,
      error: "Unsupported action",
      supportedActions: ["list", "update_money", "ban", "unban", "reset_password", "delete"],
    });
  }

  const adminKey = normalizeSecret(Deno.env.get("FARMGESTION_ADMIN_ACCOUNTS_KEY"));
  if (!adminKey) {
    return jsonResponse(500, { ok: false, error: "Missing FARMGESTION_ADMIN_ACCOUNTS_KEY" });
  }

  if (payload.key !== adminKey) {
    return jsonResponse(401, { ok: false, error: "Unauthorized" });
  }

  const supabaseUrl = normalizeSecret(Deno.env.get("SUPABASE_URL"));
  const supabaseServiceRoleKey = normalizeSecret(Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"));
  if (!supabaseUrl || !supabaseServiceRoleKey) {
    return jsonResponse(500, { ok: false, error: "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY" });
  }

  const supabase = createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: { persistSession: false },
  });

  try {
    if (action === "list") {
      const { data, error } = await supabase
        .from("users_profiles")
        .select("id,username,email,created_at,updated_at,avatar_url,role,role_ingame,money,farm_id")
        .order("created_at", { ascending: false });

      if (error) {
        return jsonResponse(500, { ok: false, error: `Failed to load users_profiles: ${error.message}` });
      }

      const rows = (data || []) as ProfileRow[];
      const userIds = rows.map((row) => String(row.id || "").trim()).filter(Boolean);
      const authStates = await loadAuthStates(supabase, userIds);

      const accounts = rows.map((row) => {
        const id = String(row.id || "").trim();
        const authState = authStates.get(id);
        const lastActiveAt = toIso(authState?.last_sign_in_at) || null;

        return {
          id,
          username: String(row.username || ""),
          email: String(row.email || ""),
          created_at: String(row.created_at || ""),
          updated_at: String(row.updated_at || ""),
          avatar_url: row.avatar_url || null,
          role: String(row.role || ""),
          role_ingame: String(row.role_ingame || ""),
          money: Number.isFinite(Number(row.money)) ? Number(row.money) : 0,
          farm_id: row.farm_id || null,
          is_active: isUserActive(authState?.banned_until),
          last_active_at: lastActiveAt,
        };
      });

      return jsonResponse(200, { ok: true, accounts });
    }

    if (action === "update_money") {
      const userId = String(payload.userId || "").trim();
      if (!userId) return jsonResponse(400, { ok: false, error: "missing_user_id" });

      const money = parseMoney(payload.money);
      if (money === null) {
        return jsonResponse(400, { ok: false, error: "invalid_money_must_be_integer_greater_or_equal_0" });
      }

      const now = new Date().toISOString();
      const { data, error } = await supabase
        .from("users_profiles")
        .update({ money, updated_at: now })
        .eq("id", userId)
        .select("id,money,updated_at")
        .maybeSingle();

      if (error) {
        return jsonResponse(500, { ok: false, error: `Failed to update money: ${error.message}` });
      }

      if (!data) {
        return jsonResponse(404, { ok: false, error: "user_not_found" });
      }

      return jsonResponse(200, {
        ok: true,
        userId,
        money: Number(data.money || 0),
        updated_at: String(data.updated_at || now),
      });
    }

    if (action === "ban" || action === "unban") {
      const userId = String(payload.userId || "").trim();
      if (!userId) return jsonResponse(400, { ok: false, error: "missing_user_id" });

      const banDuration = action === "ban" ? "876000h" : "none";
      const { data, error } = await supabase.auth.admin.updateUserById(userId, {
        ban_duration: banDuration,
      });

      if (error) {
        return jsonResponse(500, {
          ok: false,
          error: `Failed to ${action} user: ${error.message}`,
        });
      }

      return jsonResponse(200, {
        ok: true,
        userId,
        is_active: action === "unban",
        banned_until: data.user?.banned_until || null,
      });
    }

    if (action === "reset_password") {
      const userId = String(payload.userId || "").trim();
      let email = parseEmail(payload.email);

      if (!email && userId) {
        const profile = await supabase
          .from("users_profiles")
          .select("email")
          .eq("id", userId)
          .maybeSingle();

        if (profile.error) {
          return jsonResponse(500, { ok: false, error: `Failed to load user email: ${profile.error.message}` });
        }

        email = parseEmail(profile.data?.email);
      }

      if (!isValidEmail(email)) {
        return jsonResponse(400, { ok: false, error: "invalid_or_missing_email" });
      }

      const redirectTo = normalizeSecret(Deno.env.get("ADMIN_PASSWORD_RESET_REDIRECT"));
      const reset = redirectTo
        ? await supabase.auth.resetPasswordForEmail(email, { redirectTo })
        : await supabase.auth.resetPasswordForEmail(email);

      if (reset.error) {
        return jsonResponse(500, {
          ok: false,
          error: `Failed to send reset password email: ${reset.error.message}`,
        });
      }

      return jsonResponse(200, { ok: true, email });
    }

    if (action === "delete") {
      const userId = String(payload.userId || "").trim();
      if (!userId) return jsonResponse(400, { ok: false, error: "missing_user_id" });

      const settingsDelete = await supabase.from("user_settings").delete().eq("user_id", userId);
      if (settingsDelete.error) {
        return jsonResponse(500, {
          ok: false,
          error: `Failed to delete user settings: ${settingsDelete.error.message}`,
        });
      }

      const profileDelete = await supabase.from("users_profiles").delete().eq("id", userId);
      if (profileDelete.error) {
        return jsonResponse(500, {
          ok: false,
          error: `Failed to delete profile row: ${profileDelete.error.message}`,
        });
      }

      const authDelete = await supabase.auth.admin.deleteUser(userId);
      if (authDelete.error) {
        return jsonResponse(500, {
          ok: false,
          error: `Failed to delete auth user: ${authDelete.error.message}`,
        });
      }

      return jsonResponse(200, { ok: true, userId });
    }

    return jsonResponse(400, { ok: false, error: "Unsupported action" });
  } catch (error) {
    return jsonResponse(500, {
      ok: false,
      error: error instanceof Error ? error.message : "Unknown server error",
    });
  }
});
