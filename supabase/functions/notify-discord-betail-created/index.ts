import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type BetailRow = {
  id: string;
  name: string | null;
  matricule: string | null;
  age: number | null;
  avatar_url: string | null;
  author_id: string | null;
  owner_id: string | null;
  created_at: string | null;
  purchased_at: string | null;
  visible: boolean | null;
};

type ProfileRow = {
  id: string;
  username: string | null;
  email: string | null;
};

type DiscordBetailMessageRow = {
  betail_id: string;
  message_id: string;
  status: string | null;
};

type DiscordButton = {
  type: 2;
  style: 5;
  label: string;
  url: string;
};

const jsonResponse = (status: number, payload: unknown) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const normalizeSecret = (value: string | null) => {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) {
    return raw.slice(1, -1).trim();
  }
  return raw;
};

const truncate = (value: unknown, maxLength: number) => {
  const text = String(value || "").trim();
  if (!text) return "";
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
};

const isHttpUrl = (value: unknown) => {
  try {
    const url = new URL(String(value || ""));
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
};

const getBetailIdFromPayload = (payload: Record<string, unknown>) => {
  const directId = String(payload.betailId || payload.betail_id || "").trim();
  if (directId) return directId;

  const record = payload.record;
  if (record && typeof record === "object") {
    const recordId = String((record as Record<string, unknown>).id || "").trim();
    if (recordId) return recordId;
  }

  return "";
};

const getEventTypeFromPayload = (payload: Record<string, unknown>) => {
  const raw = String(payload.type || payload.event || "").trim().toUpperCase();
  if (raw === "UPDATE") return "UPDATE";
  return "INSERT";
};

const buildBetailUrl = (sitePublicUrl: string, betailId: string) => {
  const baseUrl = sitePublicUrl.replace(/\/+$/, "");
  return `${baseUrl}/betail-register/${encodeURIComponent(betailId)}`;
};

const buildProfileUrl = (sitePublicUrl: string, username: unknown) => {
  const normalizedUsername = String(username || "").trim();
  if (!normalizedUsername) return "";
  const baseUrl = sitePublicUrl.replace(/\/+$/, "");
  return `${baseUrl}/community/profile/${encodeURIComponent(normalizedUsername)}`;
};

const buildDiscordWebhookUrl = (webhookUrl: string, options: { wait?: boolean } = {}) => {
  const url = new URL(webhookUrl);
  url.searchParams.set("with_components", "true");
  if (options.wait) url.searchParams.set("wait", "true");
  return url.toString();
};

const buildDiscordMessageUrl = (webhookUrl: string, messageId: string) => {
  const url = new URL(webhookUrl);
  const basePath = url.pathname.replace(/\/+$/, "");
  url.pathname = `${basePath}/messages/${encodeURIComponent(messageId)}`;
  url.searchParams.set("with_components", "true");
  return url.toString();
};

const parseBearerToken = (req: Request) => {
  const authorization = req.headers.get("authorization") || "";
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || "";
};

const isAuthorized = (req: Request, serviceRoleKey: string) => {
  const bearerToken = parseBearerToken(req);
  return Boolean(serviceRoleKey && bearerToken && bearerToken === serviceRoleKey);
};

const loadBetail = async (
  supabase: ReturnType<typeof createClient>,
  betailId: string,
): Promise<{
  betail: BetailRow | null;
  authorProfile: ProfileRow | null;
  ownerProfile: ProfileRow | null;
  error?: string;
}> => {
  const { data: betail, error: betailError } = await supabase
    .from("betails")
    .select("id,name,matricule,age,avatar_url,author_id,owner_id,created_at,purchased_at,visible")
    .eq("id", betailId)
    .maybeSingle();

  if (betailError) {
    return { betail: null, authorProfile: null, ownerProfile: null, error: betailError.message };
  }

  if (!betail) {
    return { betail: null, authorProfile: null, ownerProfile: null, error: "betail_not_found" };
  }

  const betailRow = betail as BetailRow;
  const profileIds = Array.from(
    new Set([betailRow.author_id, betailRow.owner_id].map((id) => String(id || "").trim()).filter(Boolean)),
  );

  if (!profileIds.length) {
    return { betail: betailRow, authorProfile: null, ownerProfile: null };
  }

  const { data: profiles } = await supabase
    .from("users_profiles")
    .select("id,username,email")
    .in("id", profileIds);

  const profileMap = new Map<string, ProfileRow>();
  ((profiles || []) as ProfileRow[]).forEach((profile) => {
    const id = String(profile?.id || "").trim();
    if (id) profileMap.set(id, profile);
  });

  return {
    betail: betailRow,
    authorProfile: betailRow.author_id ? profileMap.get(betailRow.author_id) || null : null,
    ownerProfile: betailRow.owner_id ? profileMap.get(betailRow.owner_id) || null : null,
  };
};

const buildDiscordMessagePayload = ({
  sitePublicUrl,
  betail,
  authorProfile,
  ownerProfile,
}: {
  sitePublicUrl: string;
  betail: BetailRow;
  authorProfile: ProfileRow | null;
  ownerProfile: ProfileRow | null;
}) => {
  const betailName = truncate(betail.name, 120) || "Bétail sans nom";
  const betailUrl = buildBetailUrl(sitePublicUrl, betail.id);
  const authorProfileUrl = buildProfileUrl(sitePublicUrl, authorProfile?.username);
  const ownerProfileUrl = buildProfileUrl(sitePublicUrl, ownerProfile?.username);
  const authorName = truncate(authorProfile?.username, 80) || "Auteur inconnu";
  const ownerName = truncate(ownerProfile?.username, 80);
  const isPurchased = Boolean(betail.owner_id || betail.purchased_at);
  const createdAt = betail.created_at ? new Date(betail.created_at) : null;
  const createdTimestamp = createdAt && !Number.isNaN(createdAt.getTime()) ? createdAt.toISOString() : new Date().toISOString();

  const fields = [
    { name: "Nom", value: `**${betailName}**`, inline: true },
    { name: "Matricule", value: `\`${truncate(betail.matricule, 80) || "Inconnu"}\``, inline: true },
    { name: "Âge", value: betail.age ? `${betail.age} an${betail.age > 1 ? "s" : ""}` : "Inconnu", inline: true },
    { name: "Créateur", value: authorName, inline: true },
    {
      name: "Statut",
      value: isPurchased ? "**Déjà acheté**" : "**Disponible à l'achat**",
      inline: true,
    },
  ];

  if (isPurchased && ownerName) {
    fields.push({ name: "Propriétaire", value: ownerName, inline: true });
  }

  const embed: Record<string, unknown> = {
    title: isPurchased ? "Bétail acheté" : "Nouveau bétail enregistré",
    description: isPurchased
      ? `**${betailName}** vient d'être acheté et n'est plus disponible dans le registre.`
      : `**${betailName}** vient d'être ajouté au registre FarmGestion.`,
    color: isPurchased ? 0xd94b4b : 0x57c7a8,
    fields,
    timestamp: createdTimestamp,
    footer: { text: isPurchased ? "Statut mis à jour automatiquement" : "Disponible à l'achat" },
  };

  if (!isPurchased) {
    embed.url = betailUrl;
  }

  if (isHttpUrl(betail.avatar_url)) {
    embed.thumbnail = { url: betail.avatar_url };
  }

  const buttons: DiscordButton[] = [];

  if (!isPurchased) {
    buttons.push({
      type: 2,
      style: 5,
      label: "Voir le bétail",
      url: betailUrl,
    });
  }

  if (authorProfileUrl) {
    buttons.push({
      type: 2,
      style: 5,
      label: "Profil du créateur",
      url: authorProfileUrl,
    });
  }

  if (isPurchased && ownerProfileUrl) {
    buttons.push({
      type: 2,
      style: 5,
      label: "Profil du propriétaire",
      url: ownerProfileUrl,
    });
  }

  return {
    username: "FarmGestion",
    embeds: [embed],
    components: buttons.length ? [{ type: 1, components: buttons }] : [],
    allowed_mentions: { parse: [] },
  };
};

const createDiscordEmbed = async ({
  supabase,
  webhookUrl,
  sitePublicUrl,
  betail,
  authorProfile,
  ownerProfile,
}: {
  supabase: ReturnType<typeof createClient>;
  webhookUrl: string;
  sitePublicUrl: string;
  betail: BetailRow;
  authorProfile: ProfileRow | null;
  ownerProfile: ProfileRow | null;
}) => {
  const payload = buildDiscordMessagePayload({
    sitePublicUrl,
    betail,
    authorProfile,
    ownerProfile,
  });

  const response = await fetch(buildDiscordWebhookUrl(webhookUrl, { wait: true }), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Discord webhook failed with ${response.status}: ${text || response.statusText}`);
  }

  const message = (await response.json()) as { id?: string };
  const messageId = String(message?.id || "").trim();
  if (!messageId) {
    throw new Error("Discord webhook did not return a message id");
  }

  const { error } = await supabase
    .from("discord_betail_messages")
    .upsert(
      {
        betail_id: betail.id,
        message_id: messageId,
        status: betail.owner_id || betail.purchased_at ? "purchased" : "available",
        updated_at: new Date().toISOString(),
      },
      { onConflict: "betail_id" },
    );

  if (error) {
    throw new Error(`Failed to store Discord message id: ${error.message}`);
  }
};

const updateDiscordEmbed = async ({
  supabase,
  webhookUrl,
  sitePublicUrl,
  betail,
  authorProfile,
  ownerProfile,
}: {
  supabase: ReturnType<typeof createClient>;
  webhookUrl: string;
  sitePublicUrl: string;
  betail: BetailRow;
  authorProfile: ProfileRow | null;
  ownerProfile: ProfileRow | null;
}) => {
  const { data, error } = await supabase
    .from("discord_betail_messages")
    .select("betail_id,message_id,status")
    .eq("betail_id", betail.id)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load Discord message id: ${error.message}`);
  }

  const messageRow = data as DiscordBetailMessageRow | null;
  const messageId = String(messageRow?.message_id || "").trim();
  if (!messageId) {
    return;
  }

  const payload = buildDiscordMessagePayload({
    sitePublicUrl,
    betail,
    authorProfile,
    ownerProfile,
  });

  const response = await fetch(buildDiscordMessageUrl(webhookUrl, messageId), {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Discord message update failed with ${response.status}: ${text || response.statusText}`);
  }

  const { error: updateError } = await supabase
    .from("discord_betail_messages")
    .update({
      status: betail.owner_id || betail.purchased_at ? "purchased" : "available",
      updated_at: new Date().toISOString(),
    })
    .eq("betail_id", betail.id);

  if (updateError) {
    throw new Error(`Failed to update Discord message status: ${updateError.message}`);
  }
};

serve(async (req) => {
  if (req.method !== "POST") {
    return jsonResponse(405, { ok: false, error: "Method not allowed" });
  }

  const webhookUrl = normalizeSecret(Deno.env.get("DISCORD_BETAIL_WEBHOOK_URL"));
  const sitePublicUrl = normalizeSecret(Deno.env.get("SITE_PUBLIC_URL"));
  const supabaseUrl = normalizeSecret(Deno.env.get("SUPABASE_URL"));
  const supabaseServiceRoleKey = normalizeSecret(Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"));

  if (!webhookUrl || !sitePublicUrl || !supabaseUrl || !supabaseServiceRoleKey) {
    return jsonResponse(500, {
      ok: false,
      error: "Missing DISCORD_BETAIL_WEBHOOK_URL, SITE_PUBLIC_URL, SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY",
    });
  }

  if (!isAuthorized(req, supabaseServiceRoleKey)) {
    return jsonResponse(401, { ok: false, error: "Unauthorized" });
  }

  let payload: Record<string, unknown> = {};
  try {
    payload = (await req.json()) as Record<string, unknown>;
  } catch {
    return jsonResponse(400, { ok: false, error: "Invalid JSON body" });
  }

  const betailId = getBetailIdFromPayload(payload);
  if (!betailId) {
    return jsonResponse(400, { ok: false, error: "Missing betail id" });
  }
  const eventType = getEventTypeFromPayload(payload);

  const supabase = createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: { persistSession: false },
  });

  const { betail, authorProfile, ownerProfile, error } = await loadBetail(supabase, betailId);
  if (error || !betail) {
    return jsonResponse(404, { ok: false, error: error || "betail_not_found" });
  }

  if (betail.visible === false) {
    return jsonResponse(200, {
      ok: true,
      skipped: true,
      reason: "betail_not_visible",
      eventType,
      betailId: betail.id,
    });
  }

  if (eventType === "UPDATE") {
    await updateDiscordEmbed({
      supabase,
      webhookUrl,
      sitePublicUrl,
      betail,
      authorProfile,
      ownerProfile,
    });
  } else {
    await createDiscordEmbed({
      supabase,
      webhookUrl,
      sitePublicUrl,
      betail,
      authorProfile,
      ownerProfile,
    });
  }

  return jsonResponse(200, {
    ok: true,
    eventType,
    betailId: betail.id,
  });
});
