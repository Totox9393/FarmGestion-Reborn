import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";
const DEFAULT_VISION_MODEL = "qwen/qwen3.6-27b";
const MAX_SCAN_LIMIT = 100;
const IMAGE_BATCH_SIZE = 5;

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
  if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) {
    return raw.slice(1, -1).trim();
  }
  return raw.replace(/^Bearer\s+/i, "").trim();
};

const normalizeText = (value: unknown) => String(value || "")
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, " ")
  .trim();

const normalizeImageUrl = (value: unknown, supabaseUrl: string) => {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw)) return raw;
  if (raw.startsWith("/storage/")) return `${supabaseUrl}${raw}`;
  if (raw.startsWith("storage/")) return `${supabaseUrl}/${raw}`;
  return `${supabaseUrl}/storage/v1/object/public/betails/${raw.replace(/^\/+/, "")}`;
};

const wordSimilarity = (left: unknown, right: unknown) => {
  const a = new Set(normalizeText(left).split(" ").filter((word) => word.length > 2));
  const b = new Set(normalizeText(right).split(" ").filter((word) => word.length > 2));
  if (!a.size || !b.size) return 0;
  let common = 0;
  a.forEach((word) => { if (b.has(word)) common += 1; });
  return common / Math.max(a.size, b.size);
};

type BetailRow = {
  id: string;
  name: string | null;
  matricule: string | null;
  avatar_url: string | null;
  comments: string | null;
  author_id: string | null;
  created_at: string | null;
};

type VisionTag = { id: string; identity: string; category: string; tags: string[]; known: boolean };

const analyzeImageBatch = async (rows: BetailRow[], groqApiKey: string, model: string, supabaseUrl: string) => {
  const content: Array<Record<string, unknown>> = [{
    type: "text",
    text: `Analyse les images suivantes afin de détecter des doublons sémantiques. Pour chaque identifiant, indique l'identité visuelle canonique la plus précise possible. Exemple : deux illustrations différentes de Mario doivent toutes deux avoir identity "Mario" et known true. Mets known true uniquement pour un personnage, une célébrité, une œuvre ou un sujet nommé que tu reconnais réellement. Si le sujet est inconnu, mets known false et décris brièvement son type distinctif sans inventer de nom. Retourne uniquement {"items":[{"id":"...","identity":"...","known":true,"category":"personnage|animal|objet|autre","tags":["..."]}]}.`,
  }];

  rows.forEach((row) => {
    content.push({ type: "text", text: `Identifiant de l'image suivante : ${row.id}` });
    content.push({ type: "image_url", image_url: { url: normalizeImageUrl(row.avatar_url, supabaseUrl) } });
  });

  const response = await fetch(GROQ_API_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${groqApiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      temperature: 0.1,
      max_completion_tokens: 900,
      reasoning_effort: "none",
      response_format: { type: "json_object" },
      messages: [{ role: "user", content }],
    }),
  });

  if (!response.ok) {
    console.error("Duplicate vision batch failed", response.status, (await response.text()).slice(0, 400));
    return [];
  }

  try {
    const completion = await response.json();
    const raw = String(completion?.choices?.[0]?.message?.content || "")
      .replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
    const parsed = JSON.parse(raw);
    return (Array.isArray(parsed?.items) ? parsed.items : []).map((item: Record<string, unknown>) => ({
      id: String(item?.id || ""),
      identity: String(item?.identity || "").trim().slice(0, 100),
      category: String(item?.category || "").trim().slice(0, 30),
      tags: Array.isArray(item?.tags) ? item.tags.map((tag) => String(tag).trim()).filter(Boolean).slice(0, 8) : [],
      known: item?.known === true,
    })).filter((item: VisionTag) => item.id);
  } catch (error) {
    console.error("Invalid duplicate vision response", error);
    return [];
  }
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse(405, { error: "Method Not Allowed" });

  const supabaseUrl = normalizeSecret(Deno.env.get("SUPABASE_URL"));
  const anonKey = normalizeSecret(Deno.env.get("SUPABASE_ANON_KEY"));
  const serviceRoleKey = normalizeSecret(Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"));
  const groqApiKey = normalizeSecret(Deno.env.get("GROQ_API_KEY"));
  const authorization = req.headers.get("Authorization") || "";
  if (!supabaseUrl || !anonKey || !serviceRoleKey || !groqApiKey || !authorization) {
    return jsonResponse(500, { error: "Configuration serveur incomplète" });
  }

  const authClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false },
  });
  const { data: userData, error: userError } = await authClient.auth.getUser();
  if (userError || !userData.user) return jsonResponse(401, { error: "Non authentifié" });

  const adminClient = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
  const { data: profile } = await adminClient
    .from("users_profiles")
    .select("role,role_ingame")
    .eq("id", userData.user.id)
    .maybeSingle();
  const roles = `${profile?.role || ""} ${profile?.role_ingame || ""}`.toUpperCase();
  if (!roles.includes("ADMIN")) return jsonResponse(403, { error: "Accès administrateur requis" });

  let body: { action?: string; limit?: number } = {};
  try { body = await req.json(); } catch { /* corps optionnel */ }

  const model = normalizeSecret(Deno.env.get("GROQ_VISION_MODEL")) || DEFAULT_VISION_MODEL;
  if (body.action === "health") {
    try {
      const healthResponse = await fetch(GROQ_API_URL.replace("/chat/completions", "/models"), {
        headers: { Authorization: `Bearer ${groqApiKey}` },
      });
      if (!healthResponse.ok) return jsonResponse(200, { available: false });
      const modelsPayload = await healthResponse.json();
      const availableModels = Array.isArray(modelsPayload?.data)
        ? modelsPayload.data.map((item: { id?: string }) => String(item?.id || ""))
        : [];
      return jsonResponse(200, {
        available: availableModels.includes(model),
        model,
      });
    } catch {
      return jsonResponse(200, { available: false });
    }
  }

  let requestedLimit = MAX_SCAN_LIMIT;
  requestedLimit = Math.max(10, Math.min(MAX_SCAN_LIMIT, Number(body?.limit) || MAX_SCAN_LIMIT));

  const { data: rows, error: rowsError, count } = await adminClient
    .from("betails")
    .select("id,name,matricule,avatar_url,comments,author_id,created_at", { count: "exact" })
    .not("avatar_url", "is", null)
    .order("created_at", { ascending: false })
    .limit(requestedLimit);
  if (rowsError) return jsonResponse(500, { error: "Impossible de charger les bétails" });

  const betails = (rows || []) as BetailRow[];
  const chunks: BetailRow[][] = [];
  for (let index = 0; index < betails.length; index += IMAGE_BATCH_SIZE) {
    chunks.push(betails.slice(index, index + IMAGE_BATCH_SIZE));
  }

  const visionTags: VisionTag[] = [];
  for (let index = 0; index < chunks.length; index += 3) {
    const results = await Promise.all(
      chunks.slice(index, index + 3).map((chunk) => analyzeImageBatch(chunk, groqApiKey, model, supabaseUrl)),
    );
    results.forEach((items) => visionTags.push(...items));
  }

  const tagMap = new Map(visionTags.map((tag) => [tag.id, tag]));
  const parent = new Map(betails.map((row) => [row.id, row.id]));
  const pairReasons = new Map<string, { score: number; reasons: string[] }>();
  const find = (id: string): string => {
    const current = parent.get(id) || id;
    if (current === id) return id;
    const root = find(current);
    parent.set(id, root);
    return root;
  };
  const union = (a: string, b: string) => parent.set(find(b), find(a));

  for (let leftIndex = 0; leftIndex < betails.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < betails.length; rightIndex += 1) {
      const left = betails[leftIndex];
      const right = betails[rightIndex];
      const leftTag = tagMap.get(left.id);
      const rightTag = tagMap.get(right.id);
      const reasons: string[] = [];
      let score = 0;

      if (normalizeImageUrl(left.avatar_url, supabaseUrl) === normalizeImageUrl(right.avatar_url, supabaseUrl)) {
        score = 100;
        reasons.push("Image strictement identique");
      }
      const leftIdentity = normalizeText(leftTag?.identity);
      const rightIdentity = normalizeText(rightTag?.identity);
      if (leftTag?.known && rightTag?.known && leftIdentity.length >= 3 && leftIdentity === rightIdentity) {
        score = Math.max(score, 94);
        reasons.push(`Même identité visuelle : ${leftTag?.identity}`);
      }
      const leftName = normalizeText(left.name);
      const rightName = normalizeText(right.name);
      if (leftName.length >= 3 && leftName === rightName) {
        score = Math.max(score, 84);
        reasons.push("Même nom");
      }
      const commentSimilarity = wordSimilarity(left.comments, right.comments);
      if (commentSimilarity >= 0.72) {
        score = Math.max(score, Math.round(72 + commentSimilarity * 18));
        reasons.push("Descriptions très proches");
      }

      if (score >= 80) {
        union(left.id, right.id);
        pairReasons.set([left.id, right.id].sort().join("|"), { score, reasons });
      }
    }
  }

  const grouped = new Map<string, BetailRow[]>();
  betails.forEach((row) => {
    const root = find(row.id);
    grouped.set(root, [...(grouped.get(root) || []), row]);
  });

  const groups = Array.from(grouped.values()).filter((items) => items.length > 1).map((items, index) => {
    let score = 0;
    const reasons = new Set<string>();
    for (let a = 0; a < items.length; a += 1) {
      for (let b = a + 1; b < items.length; b += 1) {
        const pair = pairReasons.get([items[a].id, items[b].id].sort().join("|"));
        if (pair) {
          score = Math.max(score, pair.score);
          pair.reasons.forEach((reason) => reasons.add(reason));
        }
      }
    }
    const identity = tagMap.get(items[0].id)?.identity;
    return {
      id: `duplicate-${index + 1}`,
      title: identity ? `Doublons possibles de ${identity}` : "Bétails très similaires",
      score,
      level: score >= 92 ? "high" : "possible",
      reasons: Array.from(reasons),
      betails: items.map((row) => ({
        id: row.id,
        name: row.name,
        matricule: row.matricule,
        avatarUrl: row.avatar_url,
        comments: row.comments,
        createdAt: row.created_at,
        authorId: row.author_id,
        visualIdentity: tagMap.get(row.id)?.identity || "",
      })),
    };
  }).sort((a, b) => b.score - a.score);

  return jsonResponse(200, {
    groups,
    scannedCount: betails.length,
    totalCount: count || betails.length,
    analyzedImageCount: visionTags.length,
    limited: (count || 0) > betails.length,
  });
});
