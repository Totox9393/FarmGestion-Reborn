import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";
const DEFAULT_TEXT_MODEL = "llama-3.3-70b-versatile";
const NAMES_COUNT = 28;
const CHARACTERS_COUNT = 6;

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

// Thèmes tirés au hasard à chaque appel pour que les suggestions ne soient jamais les mêmes.
const THEMES = [
  "présentateurs et journalistes de télévision francophones",
  "acteurs et actrices de cinéma français",
  "personnages de l'animé Death Note",
  "chanteurs et chanteuses de la scène française actuelle",
  "footballeurs et footballeuses de renommée mondiale",
  "athlètes olympiques et sportifs de haut niveau",
  "humoristes et comédiens francophones",
  "youtubeurs, streamers et créateurs de contenu francophones",
  "stars hollywoodiennes",
  "chanteurs et chanteuses internationaux",
  "animateurs télé et radio",
  "personnages de l'animé Sword Art Online",
  "écrivains, penseurs et scientifiques célèbres",
  "personnages de l'animé Naruto",
  "acteurs de séries télévisées célèbres",
  "personnalités historiques célèbres du XXe siècle",
  "rappeurs et rappeuses francophones",
];

// Personnages fictifs : une petite part de chaque liste pour varier les suggestions.
const CHARACTER_THEMES = [
  "personnages de dessins animés classiques (Disney, Looney Tunes, Hanna-Barbera)",
  "personnages d'animes et de mangas célèbres",
  "personnages de dessins animés français et européens",
  "personnages de jeux vidéo cultes",
  "personnages de dessins animés modernes (Pixar, séries animées pour adultes, Cartoon Network, Disney Channel)",
  "super-héros et méchants de comics",
  "personnages de films d'animation (Ghibli, DreamWorks, Pixar)",
];

const buildPrompt = (themes: string[], characterThemes: string[], seed: number, letters: string[], exclude: string[]) =>
  `Tu proposes des sujets réellement célèbres qui possèdent une page Wikipédia avec une image : des personnalités publiques réelles ET quelques personnages fictifs.

Thèmes de personnalités réelles à mélanger : ${themes.join(" ; ")}.
Thèmes de personnages fictifs à mélanger : ${characterThemes.join(" ; ")}.

Règles :
- Exactement ${NAMES_COUNT} noms différents : environ ${NAMES_COUNT - CHARACTERS_COUNT} personnalités réelles et ${CHARACTERS_COUNT} personnages fictifs (dessins animés, animés, mangas, jeux vidéo, comics).
- Écris chaque nom exactement comme le titre de leur page Wikipédia française (ex : "Anne-Claire Coudray", "Bob l'éponge", "Son Goku").
- Personnes : uniquement des personnalités publiques bien connues et réelles. Aucune personne privée, aucun nom inventé, aucun mineur.
- Personnages : uniquement des personnages célèbres ayant leur propre page Wikipédia, pas des séries ou des films.
- Évite les sujets polémiques ou sensibles (criminels, dirigeants controversés, contenu sexuel).
- Au moins 8 des noms doivent avoir un nom de famille commençant par l'une de ces lettres : ${letters.join(", ")}.
- Évite les stars évidentes : privilégie des sujets moins attendus mais connus du grand public.${exclude.length ? `\n- Ne propose AUCUN de ces noms déjà vus : ${JSON.stringify(exclude)}.` : ""}
- Graine de variété : ${seed}. Varie fortement les choix.

Réponds exclusivement avec ce JSON, sans markdown :
{"names":["...","..."]}`;

const pickRandom = <T,>(list: T[], count: number) =>
  [...list].sort(() => Math.random() - 0.5).slice(0, count);

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

  let body: { exclude?: unknown } = {};
  try {
    body = await req.json();
  } catch {
    // Corps optionnel.
  }
  const exclude = Array.isArray(body?.exclude)
    ? body.exclude
      .map((value: unknown) => String(value || "").replace(/[\u0000-\u001F\u007F-\u009F]/g, " ").trim().slice(0, 80))
      .filter(Boolean)
      .slice(0, 80)
    : [];

  const themes = pickRandom(THEMES, 3);
  const characterThemes = pickRandom(CHARACTER_THEMES, 2);
  const letters = pickRandom("ABCDEFGHIJKLMNOPRSTV".split(""), 5);
  const seed = Math.floor(Math.random() * 100000);

  const groqResponse = await fetch(GROQ_API_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${groqApiKey}`, "Content-Type": "application/json" },
    signal: AbortSignal.timeout(8000),
    body: JSON.stringify({
      model: Deno.env.get("GROQ_TEXT_MODEL") || DEFAULT_TEXT_MODEL,
      temperature: 1,
      max_completion_tokens: 600,
      response_format: { type: "json_object" },
      messages: [{ role: "user", content: buildPrompt(themes, characterThemes, seed, letters, exclude) }],
    }),
  }).catch((error) => {
    console.error("Groq fetch failed", error);
    return null;
  });

  if (!groqResponse || !groqResponse.ok) {
    if (groqResponse) console.error("Groq API error", groqResponse.status, (await groqResponse.text()).slice(0, 500));
    return jsonResponse(502, { error: "Le service IA est temporairement indisponible" });
  }

  try {
    const completion = await groqResponse.json();
    const rawContent = String(completion?.choices?.[0]?.message?.content || "")
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim();
    const parsed = JSON.parse(rawContent || "{}");
    const names = Array.isArray(parsed?.names)
      ? [...new Set(
        parsed.names
          .map((value: unknown) => String(value || "").replace(/[\u0000-\u001F\u007F-\u009F|]/g, " ").trim().slice(0, 80))
          .filter(Boolean),
      )].slice(0, 40)
      : [];

    if (names.length < 8) return jsonResponse(502, { error: "Réponse IA incomplète" });
    return jsonResponse(200, { names });
  } catch (error) {
    console.error("Invalid Groq response", error);
    return jsonResponse(502, { error: "Réponse IA invalide" });
  }
});
