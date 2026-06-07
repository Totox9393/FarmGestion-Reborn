import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type NewsletterStatus = "active" | "unsubscribed";

type UserProfileRow = {
  id: string;
  email: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

type NewsletterSettingRow = {
  user_id: string;
  setting_value: unknown;
  created_at?: string | null;
  updated_at?: string | null;
};

type SubscriberItem = {
  email: string;
  status: NewsletterStatus;
  date?: string;
  updatedAt?: string;
};

type ActionName = "subscribers" | "admin_subscribe" | "admin_unsubscribe" | "send";

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

const parseAction = (value: unknown): ActionName => {
  const raw = String(value || "subscribers").trim().toLowerCase();
  if (raw === "admin_subscribe") return "admin_subscribe";
  if (raw === "admin_unsubscribe") return "admin_unsubscribe";
  if (raw === "send") return "send";
  return "subscribers";
};

const parseEmail = (value: unknown) => String(value || "").trim().toLowerCase();

const isValidEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

const parseMaybeDate = (value: unknown): string | undefined => {
  const normalized = String(value || "").trim();
  if (!normalized) return undefined;
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) return undefined;
  return parsed.toISOString();
};

const isDateNewer = (left?: string, right?: string) => {
  if (!right) return false;
  if (!left) return true;
  return Date.parse(right) > Date.parse(left);
};

const isDateOlder = (left?: string, right?: string) => {
  if (!right) return false;
  if (!left) return true;
  return Date.parse(right) < Date.parse(left);
};

const isFalseLike = (value: unknown): boolean => {
  if (value === false) return true;
  if (typeof value === "number") return value === 0;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    return normalized === "false" || normalized === "0" || normalized === "off" || normalized === "no";
  }
  if (Array.isArray(value)) {
    return value.some((entry) => isFalseLike(entry));
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if ("enabled" in record) return isFalseLike(record.enabled);
    if ("value" in record) return isFalseLike(record.value);
  }
  return false;
};

const resolveRequestPayload = async (req: Request) => {
  const url = new URL(req.url);
  if (req.method === "GET") {
    return {
      action: parseAction(url.searchParams.get("action")),
      key: String(url.searchParams.get("key") || "").trim(),
    };
  }

  if (req.method === "POST") {
    let body: Record<string, unknown> = {};
    try {
      body = await req.json();
    } catch {
      return null;
    }
    return {
      action: parseAction(body.action),
      key: String(body.key || "").trim(),
    };
  }

  return null;
};

const buildSubscribers = (
  users: UserProfileRow[],
  settings: NewsletterSettingRow[],
): SubscriberItem[] => {
  const optOutByUserId = new Map<string, { isOptOut: boolean; updatedAt?: string; createdAt?: string }>();

  settings.forEach((row) => {
    const userId = String(row?.user_id || "").trim();
    if (!userId) return;

    const nextUpdatedAt = parseMaybeDate(row?.updated_at);
    const nextCreatedAt = parseMaybeDate(row?.created_at);
    const nextOptOut = isFalseLike(row?.setting_value);

    const current = optOutByUserId.get(userId);
    if (!current) {
      optOutByUserId.set(userId, {
        isOptOut: nextOptOut,
        createdAt: nextCreatedAt,
        updatedAt: nextUpdatedAt,
      });
      return;
    }

    current.isOptOut = current.isOptOut || nextOptOut;
    if (isDateOlder(current.createdAt, nextCreatedAt)) {
      current.createdAt = nextCreatedAt;
    }
    if (isDateNewer(current.updatedAt, nextUpdatedAt)) {
      current.updatedAt = nextUpdatedAt;
    }
    optOutByUserId.set(userId, current);
  });

  const dedup = new Map<string, SubscriberItem>();
  users.forEach((user) => {
    const email = parseEmail(user?.email);
    if (!email || !isValidEmail(email)) return;

    const profileCreatedAt = parseMaybeDate(user?.created_at);
    const profileUpdatedAt = parseMaybeDate(user?.updated_at);
    const userOptOut = optOutByUserId.get(String(user?.id || "").trim());

    const status: NewsletterStatus = userOptOut?.isOptOut ? "unsubscribed" : "active";
    const date = userOptOut?.createdAt || profileCreatedAt;
    const updatedAt = userOptOut?.updatedAt || profileUpdatedAt;

    const existing = dedup.get(email);
    if (!existing) {
      dedup.set(email, {
        email,
        status,
        ...(date ? { date } : {}),
        ...(updatedAt ? { updatedAt } : {}),
      });
      return;
    }

    const mergedStatus: NewsletterStatus =
      existing.status === "unsubscribed" || status === "unsubscribed" ? "unsubscribed" : "active";

    const existingDate = parseMaybeDate(existing.date);
    const existingUpdatedAt = parseMaybeDate(existing.updatedAt);
    const mergedDate = isDateOlder(existingDate, date) ? date : existingDate;
    const mergedUpdatedAt = isDateNewer(existingUpdatedAt, updatedAt) ? updatedAt : existingUpdatedAt;

    dedup.set(email, {
      email,
      status: mergedStatus,
      ...(mergedDate ? { date: mergedDate } : {}),
      ...(mergedUpdatedAt ? { updatedAt: mergedUpdatedAt } : {}),
    });
  });

  return Array.from(dedup.values()).sort((left, right) => left.email.localeCompare(right.email, "fr"));
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }

  if (req.method !== "GET" && req.method !== "POST") {
    return jsonResponse(405, { ok: false, error: "Method not allowed" });
  }

  const payload = await resolveRequestPayload(req);
  if (!payload) {
    return jsonResponse(400, { ok: false, error: "Invalid JSON body" });
  }

  const adminKey = normalizeSecret(Deno.env.get("NEWSLETTER_ADMIN_KEY"));
  if (!adminKey) {
    return jsonResponse(500, { ok: false, error: "Missing NEWSLETTER_ADMIN_KEY" });
  }

  if (payload.key !== adminKey) {
    return jsonResponse(401, { ok: false, error: "Unauthorized" });
  }

  if (payload.action !== "subscribers") {
    return jsonResponse(400, {
      ok: false,
      error: `Unsupported action: ${payload.action}`,
      supportedActions: ["subscribers"],
    });
  }

  const supabaseUrl = normalizeSecret(Deno.env.get("SUPABASE_URL"));
  const supabaseServiceRoleKey = normalizeSecret(Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"));

  if (!supabaseUrl || !supabaseServiceRoleKey) {
    return jsonResponse(500, { ok: false, error: "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY" });
  }

  const supabase = createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: { persistSession: false },
  });

  const [usersResult, settingsResult] = await Promise.all([
    supabase
      .from("users_profiles")
      .select("id,email,created_at,updated_at"),
    supabase
      .from("user_settings")
      .select("user_id,setting_value,created_at,updated_at")
      .eq("setting_name", "receive_newsletter"),
  ]);

  if (usersResult.error) {
    return jsonResponse(500, { ok: false, error: `Failed to load users_profiles: ${usersResult.error.message}` });
  }

  if (settingsResult.error) {
    return jsonResponse(500, { ok: false, error: `Failed to load user_settings: ${settingsResult.error.message}` });
  }

  const subscribers = buildSubscribers(
    (usersResult.data || []) as UserProfileRow[],
    (settingsResult.data || []) as NewsletterSettingRow[],
  );

  return jsonResponse(200, {
    ok: true,
    subscribers,
  });
});