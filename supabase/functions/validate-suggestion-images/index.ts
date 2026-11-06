import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";
const DEFAULT_VISION_MODEL = "qwen/qwen3.6-27b";
const IMAGE_BATCH_SIZE = 5;
const MAX_ITEMS = 30;
const MAX_REFERENCE_ITEMS = 40;

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

type Item = { id: string; name: string; url: string };
type Reference = { name: string; url: string };
type Verdicts = { rejected: string[]; accepted: string[] };

const hostMatches = (hostname: string, domain: string) => hostname === domain || hostname.endsWith(`.${domain}`);

// Seules des images de sources connues sont envoyees a Groq : evite d'y faire transiter des URL arbitraires.
const isAllowedUrl = (value: string, domains: string[]) => {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && domains.some((domain) => hostMatches(url.hostname, domain));
  } catch {
    return false;
  }
};

const CANDIDATE_DOMAINS = ["wikimedia.org", "staticflickr.com", "openverse.org"];
const REFERENCE_DOMAINS = ["wikimedia.org", "anilist.co", "myanimelist.net"];
const isAllowedImageUrl = (value: string) => isAllowedUrl(value, CANDIDATE_DOMAINS);
const isAllowedReferenceUrl = (value: string) => isAllowedUrl(value, REFERENCE_DOMAINS);

const verifyUser = async (req: Request) => {
  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") || "";
  const authorization = req.headers.get("Authorization") || "";
  if (!supabaseUrl || !anonKey || !authorization) return null;

  const client = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false },
  });
  const { data, error } = await client.auth.getUser();
  return error ? null : data.user;
};

const PROMPT = `Tu contrôles la qualité d'images proposées comme avatar pour un sujet (une personnalité publique ou un personnage fictif). Pour chaque image, tu reçois le nom du sujet attendu.

Une image est valide (ok true) uniquement si :
- c'est une vraie photo ou une illustration/image officielle qui montre clairement UN sujet, de préférence son visage ou son corps visible, bien cadré ;
- pour un personnage fictif : un dessin, une capture ou un visuel officiel du personnage lui-même.

Une image est invalide (ok false) si c'est :
- un logo, un symbole, une icône, un blason, un drapeau, un pictogramme, du texte, une affiche à dominante textuelle, une carte, un schéma, une pochette ;
- un cosplay, un déguisement, un masque, une statue, une figurine, une fresque ou un graffiti pour représenter un personnage fictif ;
- une foule, une photo de groupe où le sujet n'est pas clairement isolé, un sujet minuscule ou coupé, une image floue ou très sombre ;
- clairement sans rapport avec le sujet attendu (objet, paysage, bâtiment, véhicule).

Tu ne dois JAMAIS essayer de reconnaître un visage réel : juge uniquement le type et la qualité de l'image. Si tu as un doute léger, mets ok true.

Réponds exclusivement avec ce JSON :
{"items":[{"id":"...","ok":true}]}`;

const PROMPT_SAME_SUBJECT = `Tu aides à choisir de bonnes photos d'un même sujet (une personnalité publique ou un personnage fictif). Tu reçois d'abord une image de RÉFÉRENCE avec le nom du sujet, puis des images candidates. Pour chaque candidate, compare son apparence visuelle avec la référence (visage, coiffure, silhouette, style ; pour un personnage : traits et éléments distinctifs) et avec le nom indiqué.

ok true uniquement si la candidate montre très probablement le même individu ou le même personnage que la référence, de façon claire (portrait ou photo où il est bien visible), même avec un autre angle, une autre tenue ou une autre époque.

ok false si la candidate est :
- une autre personne ou un autre personnage ;
- un objet, un véhicule, un avion, un animal, un paysage, un bâtiment ;
- un logo, un symbole, du texte, une affiche, une pochette, un schéma, une capture de texte ;
- une foule ou un groupe où le sujet n'est pas clairement isolé ;
- un cosplay, un masque, une statue, une figurine ou une fresque (pour un personnage fictif) ;
- floue, minuscule, très sombre, ou le visage n'est pas assez visible pour trancher entre « même sujet » et « autre sujet ». On préfère moins de photos mais toutes justes.

Ne mets jamais d'identité ni de nom de personne dans ta réponse. Réponds exclusivement avec ce JSON :
{"items":[{"id":"...","ok":true}]}`;

const checkBatch = async (
  items: Item[],
  groqApiKey: string,
  model: string,
  reference: Reference | null,
): Promise<Verdicts> => {
  const none: Verdicts = { rejected: [], accepted: [] };
  const content: Array<Record<string, unknown>> = [
    { type: "text", text: reference ? PROMPT_SAME_SUBJECT : PROMPT },
  ];
  if (reference) {
    content.push({ type: "text", text: `Image de RÉFÉRENCE — sujet : ${JSON.stringify(reference.name)}` });
    content.push({ type: "image_url", image_url: { url: reference.url } });
  }
  items.forEach((item) => {
    content.push({
      type: "text",
      text: reference
        ? `Candidate, identifiant : ${item.id}`
        : `Identifiant : ${item.id} — sujet attendu : ${JSON.stringify(item.name)}`,
    });
    content.push({ type: "image_url", image_url: { url: item.url } });
  });

  try {
    const response = await fetch(GROQ_API_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${groqApiKey}`, "Content-Type": "application/json" },
      signal: AbortSignal.timeout(12000),
      body: JSON.stringify({
        model,
        temperature: 0,
        max_completion_tokens: 400,
        reasoning_effort: "none",
        response_format: { type: "json_object" },
        messages: [{ role: "user", content }],
      }),
    });
    if (!response.ok) {
      console.error("Image validation failed", response.status, (await response.text()).slice(0, 300));
      return none;
    }
    const completion = await response.json();
    const raw = String(completion?.choices?.[0]?.message?.content || "")
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/i, "");
    const parsed = JSON.parse(raw);
    const knownIds = new Set(items.map((item) => item.id));
    // Seuls les verdicts explicites sont renvoyes : un refus de Groq (ou une reponse illisible) ne decide de rien.
    const entries = (Array.isArray(parsed?.items) ? parsed.items : [])
      .filter((entry: Record<string, unknown>) => knownIds.has(String(entry?.id || "")));
    return {
      rejected: entries.filter((entry: Record<string, unknown>) => entry.ok === false).map((entry: Record<string, unknown>) => String(entry.id)),
      accepted: entries.filter((entry: Record<string, unknown>) => entry.ok === true).map((entry: Record<string, unknown>) => String(entry.id)),
    };
  } catch (error) {
    console.error("Image validation error", error);
    return none;
  }
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse(405, { error: "Method Not Allowed" });

  const user = await verifyUser(req);
  if (!user) return jsonResponse(401, { error: "Non authentifié" });

  const groqApiKey = normalizeSecret(Deno.env.get("GROQ_API_KEY"));
  if (!groqApiKey) return jsonResponse(500, { error: "GROQ_API_KEY manquante" });

  let body: { items?: unknown; reference?: unknown };
  try {
    body = await req.json();
  } catch {
    return jsonResponse(400, { error: "JSON invalide" });
  }

  // Mode "meme sujet" : les candidates sont comparees a une image de reference.
  const rawReference = (body?.reference || {}) as Record<string, unknown>;
  const referenceUrl = String(rawReference.url || "").trim().slice(0, 500);
  const reference: Reference | null = isAllowedReferenceUrl(referenceUrl)
    ? {
      name: String(rawReference.name || "").replace(/[\u0000-\u001F\u007F-\u009F]/g, " ").trim().slice(0, 80),
      url: referenceUrl,
    }
    : null;

  const items: Item[] = (Array.isArray(body?.items) ? body.items : [])
    .map((entry: Record<string, unknown>) => ({
      id: String(entry?.id || "").slice(0, 60),
      name: String(entry?.name || "").replace(/[\u0000-\u001F\u007F-\u009F]/g, " ").trim().slice(0, 80),
      url: String(entry?.url || "").trim().slice(0, 500),
    }))
    .filter((item: Item) => item.id && (reference || item.name) && isAllowedImageUrl(item.url))
    .slice(0, reference ? MAX_REFERENCE_ITEMS : MAX_ITEMS);

  if (!items.length) return jsonResponse(400, { error: "Aucune image valide" });

  const model = normalizeSecret(Deno.env.get("GROQ_VISION_MODEL")) || DEFAULT_VISION_MODEL;
  const batches: Item[][] = [];
  for (let index = 0; index < items.length; index += IMAGE_BATCH_SIZE) {
    batches.push(items.slice(index, index + IMAGE_BATCH_SIZE));
  }

  const results = await Promise.all(batches.map((batch) => checkBatch(batch, groqApiKey, model, reference)));
  return jsonResponse(200, {
    rejected: results.flatMap((result) => result.rejected),
    accepted: results.flatMap((result) => result.accepted),
  });
});
