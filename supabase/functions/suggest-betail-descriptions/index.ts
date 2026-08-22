import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";
const DEFAULT_VISION_MODEL = "qwen/qwen3.6-27b";
const MAX_IMAGE_DATA_URL_LENGTH = 4 * 1024 * 1024;

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

// Prompt volontairement en français pour pouvoir ajuster facilement le ton du projet.
const SYSTEM_PROMPT = `Tu crées des suggestions de descriptions courtes pour les bétails de FarmGestion.

Dans cet univers, un « bétail » est l'entité créée et collectionnée par l'utilisateur : il peut être représenté par un animal, une personne, un personnage connu, une créature ou n'importe quelle autre image. La description doit avant tout définir ce bétail comme un individu à part entière.

Analyse l'image et le prénom fourni, puis imagine l'identité, la personnalité, le passé, les qualités, les défauts, les ambitions, les habitudes ou une petite anecdote de ce bétail. L'image sert d'inspiration, mais ne te contente jamais de décrire ses vêtements, ses couleurs, son espèce ou sa pose.

Règles :
- Produis exactement 4 descriptions différentes, originales et naturelles, en français.
- Chaque description fait 1 ou 2 phrases et 220 caractères maximum.
- Utilise le prénom fourni, même s'il diffère du personnage visible.
- Si l'image représente clairement un personnage connu, tu peux le nommer explicitement et t'inspirer avec créativité de son univers, tout en définissant le bétail lui-même. Ne prétends pas l'avoir reconnu si tu as un doute.
- Aucun contexte de ferme ou d'agriculture n'est imposé.
- Tu peux évoquer The Promised Neverland seulement si l'image ou le prénom s'y prête réellement ; ce n'est jamais obligatoire.
- Évite quatre simples variantes de la même idée : humour, mystère, aventure et tendresse peuvent coexister.
- Relis chaque phrase : elle doit être grammaticalement correcte et ne contenir aucun mot parasite, mot en majuscules inexpliqué, titre, étiquette ou fragment collé à un autre mot.
- Sois tolérant avec les images étranges, sombres, suggestives ou légèrement violentes : réponds alors de manière neutre et non graphique.
- Refuse uniquement si l'image contient clairement de la nudité sexuelle explicite, un acte sexuel, de la violence graphique/gore, ou de la haine explicite. Dans ce cas, allowed vaut false et suggestions est vide.
- N'ajoute aucun commentaire ni markdown.

Réponds exclusivement avec ce JSON :
{"allowed":true,"suggestions":["...","...","...","..."]}`;

const cleanSuggestion = (value: unknown) => String(value || "")
  .replace(/[\u0000-\u001F\u007F-\u009F\u200B-\u200D\uFEFF]/g, " ")
  // Corrige les artefacts tels que « contreCARTE tous » produits occasionnellement par le modèle.
  .replace(/([a-zà-ÿ])([A-ZÀ-Ÿ]{2,})(?=\s|[.,;:!?])/gu, "$1")
  .replace(/\s{2,}/g, " ")
  .trim()
  .slice(0, 220);

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

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse(405, { error: "Method Not Allowed" });

  const user = await verifyUser(req);
  if (!user) return jsonResponse(401, { error: "Non authentifié" });

  const groqApiKey = normalizeSecret(Deno.env.get("GROQ_API_KEY"));
  if (!groqApiKey) return jsonResponse(500, { error: "GROQ_API_KEY manquante" });

  let body: { name?: string; imageDataUrl?: string };
  try {
    body = await req.json();
  } catch {
    return jsonResponse(400, { error: "JSON invalide" });
  }

  const name = String(body?.name || "").trim().slice(0, 15);
  const imageDataUrl = String(body?.imageDataUrl || "");
  if (!name || !/^data:image\/(png|jpe?g|webp);base64,/i.test(imageDataUrl)) {
    return jsonResponse(400, { error: "Prénom ou image invalide" });
  }
  if (imageDataUrl.length > MAX_IMAGE_DATA_URL_LENGTH) {
    return jsonResponse(413, { error: "Image trop volumineuse" });
  }

  const groqResponse = await fetch(GROQ_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${groqApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: Deno.env.get("GROQ_VISION_MODEL") || DEFAULT_VISION_MODEL,
      temperature: 0.9,
      max_completion_tokens: 700,
      reasoning_effort: "none",
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: [
            { type: "text", text: `Le prénom choisi par l'utilisateur est : ${JSON.stringify(name)}.` },
            { type: "image_url", image_url: { url: imageDataUrl } },
          ],
        },
      ],
    }),
  });

  if (!groqResponse.ok) {
    const details = await groqResponse.text();
    console.error("Groq API error", groqResponse.status, details.slice(0, 500));
    return jsonResponse(502, { error: "Le service IA est temporairement indisponible" });
  }

  try {
    const completion = await groqResponse.json();
    const rawContent = String(completion?.choices?.[0]?.message?.content || "").trim();
    const jsonContent = rawContent
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim();
    const parsed = JSON.parse(jsonContent || "{}");
    const allowed = parsed?.allowed !== false;
    const suggestions = allowed && Array.isArray(parsed?.suggestions)
      ? parsed.suggestions
        .map(cleanSuggestion)
        .filter(Boolean)
        .slice(0, 4)
      : [];

    if (allowed && suggestions.length < 3) {
      return jsonResponse(502, { error: "Réponse IA incomplète" });
    }
    return jsonResponse(200, { allowed, suggestions });
  } catch (error) {
    console.error("Invalid Groq response", error);
    return jsonResponse(502, { error: "Réponse IA invalide" });
  }
});
