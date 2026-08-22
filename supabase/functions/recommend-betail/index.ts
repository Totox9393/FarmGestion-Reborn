import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";
const DEFAULT_MODEL = "qwen/qwen3.6-27b";
const RECOMMENDATION_DURATION_MS = 24 * 60 * 60 * 1000;
const PURCHASE_COOLDOWN_MS = 12 * 60 * 60 * 1000;
const RECOMMENDATION_SETTING_NAME = "betail_recommendation_ai";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "content-type, authorization, apikey, x-client-info",
};
const jsonResponse = (status: number, payload: unknown) => new Response(JSON.stringify(payload), {
  status,
  headers: { "Content-Type": "application/json", ...corsHeaders },
});
const normalizeSecret = (value: string | undefined) => {
  const raw = String(value || "").trim();
  if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) return raw.slice(1, -1).trim();
  return raw.replace(/^Bearer\s+/i, "").trim();
};
const cleanText = (value: unknown, max = 500) => String(value || "")
  .replace(/[\u0000-\u001F\u007F-\u009F\u200B-\u200D\uFEFF]/g, " ")
  .replace(/\s{2,}/g, " ").trim().slice(0, max);
const isFuture = (value: unknown) => {
  const time = new Date(String(value || "")).getTime();
  return Number.isFinite(time) && time > Date.now();
};

const loadRecommendationState = async (adminClient: ReturnType<typeof createClient>, userId: string) => {
  const { data, error } = await adminClient.from("user_settings")
    .select("setting_value")
    .eq("user_id", userId)
    .eq("setting_name", RECOMMENDATION_SETTING_NAME)
    .maybeSingle();
  if (error) throw error;
  return data?.setting_value && typeof data.setting_value === "object" ? data.setting_value : null;
};

const saveRecommendationState = async (
  adminClient: ReturnType<typeof createClient>,
  userId: string,
  state: Record<string, unknown>,
) => {
  const { error } = await adminClient.from("user_settings").upsert({
    user_id: userId,
    setting_name: RECOMMENDATION_SETTING_NAME,
    setting_value: state,
    updated_at: new Date().toISOString(),
  }, { onConflict: "user_id,setting_name" });
  if (error) throw error;
};

let groqHealthCache = { available: false, checkedAt: 0 };

const checkGroq = async (apiKey: string, model: string) => {
  if (Date.now() - groqHealthCache.checkedAt < 5 * 60 * 1000) return groqHealthCache.available;
  try {
    const response = await fetch(GROQ_API_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        temperature: 0,
        max_completion_tokens: 12,
        reasoning_effort: "none",
        messages: [{ role: "user", content: "Réponds uniquement : OK" }],
      }),
    });
    groqHealthCache = { available: response.ok, checkedAt: Date.now() };
    if (!response.ok) console.error("Groq health check failed", response.status, (await response.text()).slice(0, 300));
    return response.ok;
  } catch {
    groqHealthCache = { available: false, checkedAt: Date.now() };
    return false;
  }
};

const getPublicBetail = async (adminClient: ReturnType<typeof createClient>, betailId: string | null) => {
  if (!betailId) return null;
  const { data } = await adminClient.from("betails")
    .select("id,name,matricule,avatar_url,age,premium,comments,author_id,created_at,like_count,visible,owner_id,farm_id,purchased_at,auction_locked")
    .eq("id", betailId).maybeSingle();
  if (!data || !data.visible || data.owner_id || data.farm_id || data.auction_locked) return null;
  const { data: author } = await adminClient.from("users_profiles").select("username").eq("id", data.author_id).maybeSingle();
  return { ...data, authorName: author?.username || "Auteur inconnu" };
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse(405, { error: "Method Not Allowed" });

  const supabaseUrl = normalizeSecret(Deno.env.get("SUPABASE_URL"));
  const anonKey = normalizeSecret(Deno.env.get("SUPABASE_ANON_KEY"));
  const serviceRoleKey = normalizeSecret(Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"));
  const groqApiKey = normalizeSecret(Deno.env.get("GROQ_API_KEY"));
  const model = normalizeSecret(Deno.env.get("GROQ_VISION_MODEL")) || DEFAULT_MODEL;
  const authorization = req.headers.get("Authorization") || "";
  if (!supabaseUrl || !anonKey || !serviceRoleKey || !groqApiKey || !authorization) {
    return jsonResponse(500, { error: "Configuration serveur incomplète" });
  }

  let body: { action?: string } = {};
  try { body = await req.json(); } catch { /* corps optionnel */ }

  const authClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } }, auth: { persistSession: false },
  });
  const { data: userData, error: userError } = await authClient.auth.getUser();
  if (userError || !userData.user) return jsonResponse(401, { error: "Non authentifié" });
  const userId = userData.user.id;
  const adminClient = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });

  let stored: Record<string, unknown> | null = null;
  try {
    stored = await loadRecommendationState(adminClient, userId);
  } catch (error) {
    console.error("Recommendation storage read failed", error);
    return jsonResponse(500, { error: "recommendation_storage_unavailable" });
  }
  const storedBetailId = typeof stored?.betail_id === "string" ? stored.betail_id : null;
  let cooldownUntil = typeof stored?.cooldown_until === "string" ? stored.cooldown_until : null;
  let storedRecommendation = storedBetailId ? await getPublicBetail(adminClient, storedBetailId) : null;

  if (storedBetailId && !storedRecommendation) {
    const { data: purchased } = await adminClient.from("betails")
      .select("owner_id,purchased_at").eq("id", storedBetailId).maybeSingle();
    const purchasedAtMs = new Date(purchased?.purchased_at || 0).getTime();
    const recommendedAtMs = new Date(stored?.recommended_at || 0).getTime();
    const expiresAtMs = new Date(stored?.expires_at || 0).getTime();
    const wasActiveRecommendationPurchase = purchased?.owner_id === userId
      && Number.isFinite(purchasedAtMs)
      && purchasedAtMs >= recommendedAtMs
      && purchasedAtMs <= expiresAtMs;
    if (wasActiveRecommendationPurchase) {
      const purchaseTime = new Date(purchased.purchased_at).getTime();
      cooldownUntil = new Date(purchaseTime + PURCHASE_COOLDOWN_MS).toISOString();
      await saveRecommendationState(adminClient, userId, {
        betail_id: null, explanation: null, tone: null,
        recommended_at: null, expires_at: null, cooldown_until: cooldownUntil,
      });
    } else {
      await saveRecommendationState(adminClient, userId, {
        ...stored, betail_id: null, explanation: null, recommended_at: null, expires_at: null,
      });
    }
  }

  const aiAvailable = await checkGroq(groqApiKey, model);
  const activeRecommendation = storedRecommendation && isFuture(stored?.expires_at)
    ? { betail: storedRecommendation, explanation: stored?.explanation || "Milo pense que ce bétail pourrait vous plaire.", tone: stored?.tone || "chaleureux", expiresAt: stored?.expires_at }
    : null;

  if (body.action !== "recommend") {
    return jsonResponse(200, { aiAvailable, recommendation: activeRecommendation, cooldownUntil: isFuture(cooldownUntil) ? cooldownUntil : null });
  }
  if (activeRecommendation) return jsonResponse(200, { aiAvailable, recommendation: activeRecommendation, cooldownUntil: null });
  if (isFuture(cooldownUntil)) return jsonResponse(429, { error: "cooldown_active", aiAvailable, cooldownUntil });
  if (!aiAvailable) return jsonResponse(503, { error: "ai_unavailable", aiAvailable: false });

  const [{ data: profile }, { data: ownedRows }, { data: likeRows }, { data: candidateRows }] = await Promise.all([
    adminClient.from("users_profiles").select("farm_id").eq("id", userId).maybeSingle(),
    adminClient.from("betails").select("name,comments,premium,age").eq("owner_id", userId).order("purchased_at", { ascending: false }).limit(25),
    adminClient.from("betail_likes").select("betail_id").eq("user_id", userId).order("created_at", { ascending: false }).limit(30),
    adminClient.from("betails").select("id,name,matricule,comments,premium,age,like_count,author_id,avatar_url,created_at")
      .eq("visible", true).is("owner_id", null).is("farm_id", null).eq("auction_locked", false)
      .neq("author_id", userId).order("like_count", { ascending: false }).limit(60),
  ]);
  let farmName = "";
  if (profile?.farm_id) {
    const { data: farm } = await adminClient.from("farms_list").select("name").eq("id", profile.farm_id).maybeSingle();
    farmName = cleanText(farm?.name, 100);
  }
  const likedIds = (likeRows || []).map((row) => row.betail_id).filter(Boolean);
  let likedBetails: Array<Record<string, unknown>> = [];
  if (likedIds.length) {
    const { data } = await adminClient.from("betails").select("name,comments,premium,age").in("id", likedIds);
    likedBetails = data || [];
  }
  const candidates = candidateRows || [];
  if (!candidates.length) return jsonResponse(404, { error: "no_available_betail", aiAvailable });

  const compact = (rows: Array<Record<string, unknown>>) => rows.map((row) => ({
    name: cleanText(row.name, 80), description: cleanText(row.comments, 180), premium: Boolean(row.premium), age: row.age,
  }));
  const candidateContext = candidates.map((row) => ({
    id: row.id, name: cleanText(row.name, 80), description: cleanText(row.comments, 220),
    premium: Boolean(row.premium), age: row.age, likes: row.like_count,
  }));
  const prompt = `Tu es Milo, le guide de FarmGestion. Choisis exactement un bétail disponible qui correspondrait le mieux à cet utilisateur.
Tu dois tenir compte, dans cet ordre, de ses bétails possédés, de ses likes, puis du nom de sa ferme. S'il n'a aucune donnée, choisis une proposition attachante, variée et accessible.
L'explication doit faire 1 ou 2 phrases courtes en français et adopter librement un ton sérieux, humoristique ou chaleureux. N'invente aucune information absente.
Ferme : ${JSON.stringify(farmName || "Nom inconnu")}
Bétails possédés : ${JSON.stringify(compact((ownedRows || []) as Array<Record<string, unknown>>))}
Bétails aimés : ${JSON.stringify(compact(likedBetails))}
Candidats disponibles : ${JSON.stringify(candidateContext)}
Réponds uniquement en JSON : {"betailId":"uuid exact d'un candidat","explanation":"...","tone":"serieux|humoristique|chaleureux"}`;

  const groqResponse = await fetch(GROQ_API_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${groqApiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model, temperature: 0.75, max_completion_tokens: 500, reasoning_effort: "none", response_format: { type: "json_object" }, messages: [{ role: "user", content: prompt }] }),
  });
  if (!groqResponse.ok) return jsonResponse(503, { error: "ai_unavailable", aiAvailable: false });

  try {
    const completion = await groqResponse.json();
    const raw = String(completion?.choices?.[0]?.message?.content || "").replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
    const choice = JSON.parse(raw);
    const selected = candidates.find((row) => row.id === choice?.betailId);
    if (!selected) return jsonResponse(502, { error: "invalid_ai_choice", aiAvailable: true });
    const explanation = cleanText(choice?.explanation, 320) || `Milo pense que ${selected.name} trouverait parfaitement sa place dans votre collection.`;
    const tone = ["serieux", "humoristique", "chaleureux"].includes(choice?.tone) ? choice.tone : "chaleureux";
    const now = new Date();
    const expiresAt = new Date(now.getTime() + RECOMMENDATION_DURATION_MS).toISOString();
    try {
      await saveRecommendationState(adminClient, userId, {
        betail_id: selected.id, explanation, tone, recommended_at: now.toISOString(),
        expires_at: expiresAt, cooldown_until: null,
      });
    } catch (error) {
      console.error("Recommendation storage save failed", error);
      return jsonResponse(500, { error: "recommendation_save_failed" });
    }
    const betail = await getPublicBetail(adminClient, selected.id);
    return jsonResponse(200, { aiAvailable: true, recommendation: { betail, explanation, tone, expiresAt }, cooldownUntil: null });
  } catch (error) {
    console.error("Invalid recommendation response", error);
    return jsonResponse(502, { error: "invalid_ai_response", aiAvailable: true });
  }
});
