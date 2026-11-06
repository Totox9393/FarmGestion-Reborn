import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";
const DEFAULT_VISION_MODEL = "qwen/qwen3.6-27b";
const REGISTRY_SCAN_LIMIT = 300;
const IMAGE_BATCH_SIZE = 5;
// Borne le temps de reponse : le cache se remplit progressivement au fil des appels.
const MAX_NEW_ANALYSES_PER_CALL = 15;

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

const normalizeSecret = (value: string | undefined) => {
  const raw = String(value || "").trim();
  if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) {
    return raw.slice(1, -1).trim();
  }
  return raw.replace(/^Bearer\s+/i, "").trim();
};

const normalizeImageUrl = (value: unknown, supabaseUrl: string) => {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw)) return raw;
  if (raw.startsWith("/storage/")) return `${supabaseUrl}${raw}`;
  if (raw.startsWith("storage/")) return `${supabaseUrl}/${raw}`;
  return `${supabaseUrl}/storage/v1/object/public/betails/${raw.replace(/^\/+/, "")}`;
};

type BetailRow = { id: string; avatar_url: string | null };
type CacheRow = { betail_id: string; avatar_url: string; identity: string; known: boolean };
type Identified = { id: string; identity: string; known: boolean };

const identifyBatch = async (
  rows: BetailRow[],
  groqApiKey: string,
  model: string,
  supabaseUrl: string,
): Promise<Identified[]> => {
  const content: Array<Record<string, unknown>> = [{
    type: "text",
    text: `Pour chaque image, indique le nom canonique de la personnalité publique ou du personnage nommé que tu reconnais réellement (ex : "Britney Spears", "Mario"). Mets known true uniquement si tu es sûr de l'identité ; sinon known false et identity vide. N'invente jamais de nom. Retourne uniquement {"items":[{"id":"...","identity":"...","known":true}]}.`,
  }];

  rows.forEach((row) => {
    content.push({ type: "text", text: `Identifiant de l'image suivante : ${row.id}` });
    content.push({ type: "image_url", image_url: { url: normalizeImageUrl(row.avatar_url, supabaseUrl) } });
  });

  try {
    const response = await fetch(GROQ_API_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${groqApiKey}`, "Content-Type": "application/json" },
      signal: AbortSignal.timeout(15000),
      body: JSON.stringify({
        model,
        temperature: 0,
        max_completion_tokens: 600,
        reasoning_effort: "none",
        response_format: { type: "json_object" },
        messages: [{ role: "user", content }],
      }),
    });
    if (!response.ok) {
      console.error("Identity batch failed", response.status, (await response.text()).slice(0, 400));
      return [];
    }
    const completion = await response.json();
    const raw = String(completion?.choices?.[0]?.message?.content || "")
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/i, "");
    const parsed = JSON.parse(raw);
    return (Array.isArray(parsed?.items) ? parsed.items : [])
      .map((item: Record<string, unknown>) => {
        const identity = String(item?.identity || "").replace(/[\u0000-\u001F\u007F-\u009F]/g, " ").trim().slice(0, 100);
        return { id: String(item?.id || ""), identity, known: item?.known === true && identity.length > 0 };
      })
      .filter((item: Identified) => item.id);
  } catch (error) {
    console.error("Identity batch error", error);
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
  if (!supabaseUrl || !anonKey || !serviceRoleKey || !authorization) {
    return jsonResponse(500, { error: "Configuration serveur incomplète" });
  }

  const authClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false },
  });
  const { data: userData, error: userError } = await authClient.auth.getUser();
  if (userError || !userData.user) return jsonResponse(401, { error: "Non authentifié" });

  const adminClient = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });

  // cacheOnly : reponse rapide (identites deja en cache + noms), sans nouvelle analyse Groq.
  let cacheOnly = false;
  try {
    const body = await req.json();
    cacheOnly = body?.cacheOnly === true;
  } catch {
    // Appel sans corps.
  }

  const { data: rows, error: rowsError } = await adminClient
    .from("betails")
    .select("id,avatar_url")
    .not("avatar_url", "is", null)
    .order("created_at", { ascending: false })
    .limit(REGISTRY_SCAN_LIMIT);
  if (rowsError) return jsonResponse(500, { error: "Impossible de charger le registre" });
  const betails = (rows || []) as BetailRow[];

  const { data: cached } = await adminClient
    .from("betail_identity_cache")
    .select("betail_id,avatar_url,identity,known")
    .in("betail_id", betails.map((row) => row.id));
  const cacheMap = new Map(((cached || []) as CacheRow[]).map((row) => [row.betail_id, row]));

  // On n'analyse que ce qui n'est pas en cache (ou dont la photo a change).
  const pending = betails
    .filter((row) => cacheMap.get(row.id)?.avatar_url !== row.avatar_url)
    .slice(0, MAX_NEW_ANALYSES_PER_CALL);

  if (pending.length && groqApiKey && !cacheOnly) {
    const model = normalizeSecret(Deno.env.get("GROQ_VISION_MODEL")) || DEFAULT_VISION_MODEL;
    const chunks: BetailRow[][] = [];
    for (let index = 0; index < pending.length; index += IMAGE_BATCH_SIZE) {
      chunks.push(pending.slice(index, index + IMAGE_BATCH_SIZE));
    }
    const batches = await Promise.all(chunks.map((chunk) => identifyBatch(chunk, groqApiKey, model, supabaseUrl)));
    const pendingIds = new Set(pending.map((row) => row.id));
    const avatarById = new Map(pending.map((row) => [row.id, String(row.avatar_url)]));

    const upserts = batches.flat()
      .filter((item) => pendingIds.has(item.id))
      .map((item) => ({
        betail_id: item.id,
        avatar_url: avatarById.get(item.id) as string,
        identity: item.identity,
        known: item.known,
        analyzed_at: new Date().toISOString(),
      }));

    if (upserts.length) {
      const { error: upsertError } = await adminClient.from("betail_identity_cache").upsert(upserts);
      if (upsertError) console.error("Identity cache upsert failed", upsertError.message);
      upserts.forEach((row) => cacheMap.set(row.betail_id, row));
    }
  }

  const identities = [...new Set(
    betails
      .map((row) => cacheMap.get(row.id))
      .filter((row): row is CacheRow => Boolean(row?.known && row.identity))
      .map((row) => row.identity),
  )];

  // Noms des betails : les gens nomment souvent le betail comme la personne qu'il represente.
  const { data: nameRows } = await adminClient.from("betails").select("name").limit(3000);
  const names = [...new Set(
    ((nameRows || []) as Array<{ name: string | null }>)
      .map((row) => String(row.name || "").trim().slice(0, 100))
      .filter(Boolean),
  )];

  return jsonResponse(200, { identities, names });
});
