import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { StreamChat } from "npm:stream-chat@9.51.0";

const CHANNEL_TYPE = "livestream";
const CHANNEL_ID = "farmgestion-public";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "content-type, authorization, apikey, x-client-info",
};
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, "Content-Type": "application/json" },
});
const env = (name: string) => String(Deno.env.get(name) || "").trim();
const normalizedRoles = (profile: { role?: unknown; role_ingame?: unknown }) => [
  String(profile.role || "").trim().toUpperCase(),
  String(profile.role_ingame || "").trim().toUpperCase(),
];
const isModerator = (profile: { role?: unknown; role_ingame?: unknown }) => {
  const roles = normalizedRoles(profile);
  return roles.includes("ADMIN") || roles.includes("MODERATION");
};
const isAdmin = (profile: { role?: unknown; role_ingame?: unknown }) => {
  return normalizedRoles(profile).includes("ADMIN");
};

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "Méthode non autorisée." });

  const supabaseUrl = env("SUPABASE_URL");
  const serviceRoleKey = env("SUPABASE_SERVICE_ROLE_KEY");
  const streamApiKey = env("STREAM_API_KEY");
  const streamApiSecret = env("STREAM_API_SECRET");
  if (!supabaseUrl || !serviceRoleKey || !streamApiKey || !streamApiSecret) {
    return json(500, { error: "Configuration serveur Stream incomplète." });
  }

  const authHeader = req.headers.get("Authorization") || "";
  const jwt = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  if (!jwt) return json(401, { error: "Authentification requise." });

  let body: {
    action?: unknown;
    messageId?: unknown;
    targetUserId?: unknown;
    durationMinutes?: unknown;
    cooldownSeconds?: unknown;
  } = {};
  try { body = await req.json(); } catch { /* body optionnel */ }

  const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const authResult = await supabaseAdmin.auth.getUser(jwt);
  const user = authResult.data?.user;
  if (authResult.error || !user) return json(401, { error: "Session invalide ou expirée." });

  const { data: profile, error: profileError } = await supabaseAdmin
    .from("users_profiles")
    .select("id, role, role_ingame")
    .eq("id", user.id)
    .maybeSingle();
  if (profileError || !profile) return json(403, { error: "Compte FarmGestion requis." });

  const stream = StreamChat.getInstance(streamApiKey, streamApiSecret);
  const channel = stream.channel(CHANNEL_TYPE, CHANNEL_ID, {
    name: "Place du village",
    created_by_id: user.id,
    fg_public: true,
  });

  try {
    await channel.create();
    const action = String(body.action || "open");

    // Stream applique le mode lent côté serveur à partir des capacités du membre.
    // On synchronise donc le rôle FarmGestion au rôle de modérateur de CE salon,
    // sans accorder de droits d'administration globaux dans l'application Stream.
    if (action === "open") {
      const canModerate = isModerator(profile);
      const memberResponse = await channel.queryMembers({ user_id: user.id }, [], { limit: 1 });
      const currentMember = memberResponse.members?.[0];
      const isChannelModerator = currentMember?.channel_role === "channel_moderator";
      if (canModerate && !currentMember) await channel.addMembers([user.id]);
      if (canModerate && !isChannelModerator) await channel.addModerators([user.id]);
      if (!canModerate && isChannelModerator) await channel.demoteModerators([user.id]);
    }

    if (action === "open" || action === "status") {
      const canModerate = isModerator(profile);
      const banFilters = canModerate
        ? { channel_cid: channel.cid }
        : { channel_cid: channel.cid, user_id: user.id };
      const bansResponse = await stream.queryBannedUsers(
        banFilters,
        [{ created_at: -1 }],
        { exclude_expired_bans: true, limit: canModerate ? 100 : 1 },
      );
      const mutedUsers = (bansResponse.bans || [])
        .filter((ban) => ban.user?.id && ban.expires)
        .map((ban) => ({ userId: ban.user.id, expiresAt: ban.expires }));
      return json(200, {
        channelType: CHANNEL_TYPE,
        channelId: CHANNEL_ID,
        canModerate,
        canClear: isAdmin(profile),
        cooldown: Math.max(0, Number(channel.data?.cooldown || 0)),
        mutedUsers,
      });
    }

    if (action === "truncate") {
      if (!isAdmin(profile)) return json(403, { error: "Action réservée aux administrateurs." });
      await channel.truncate();
      return json(200, { success: true });
    }

    if (!isModerator(profile)) return json(403, { error: "Droits de modération requis." });

    if (action === "delete") {
      const messageId = String(body.messageId || "").trim();
      if (!messageId) return json(400, { error: "Message invalide." });
      await stream.deleteMessage(messageId, true);
      return json(200, { success: true });
    }

    if (action === "mute") {
      const targetUserId = String(body.targetUserId || "").trim();
      const durationMinutes = Math.min(60, Math.max(1, Number(body.durationMinutes || 60)));
      if (!targetUserId || targetUserId === user.id) return json(400, { error: "Utilisateur invalide." });
      await channel.banUser(targetUserId, {
        banned_by_id: user.id,
        reason: "Mise en sourdine par la modération FarmGestion",
        timeout: durationMinutes,
      });
      return json(200, {
        success: true,
        durationMinutes,
        expiresAt: new Date(Date.now() + durationMinutes * 60_000).toISOString(),
      });
    }

    if (action === "unmute") {
      const targetUserId = String(body.targetUserId || "").trim();
      if (!targetUserId || targetUserId === user.id) return json(400, { error: "Utilisateur invalide." });
      await channel.unbanUser(targetUserId);
      return json(200, { success: true });
    }

    if (action === "pin" || action === "unpin") {
      const messageId = String(body.messageId || "").trim();
      if (!messageId) return json(400, { error: "Message invalide." });
      if (action === "pin") await stream.pinMessage(messageId, null, user.id);
      else await stream.unpinMessage(messageId, user.id);
      return json(200, { success: true, pinned: action === "pin" });
    }

    if (action === "slow_mode") {
      const cooldownSeconds = Number(body.cooldownSeconds);
      if (!Number.isInteger(cooldownSeconds) || cooldownSeconds < 1 || cooldownSeconds > 60) {
        return json(400, { error: "Le mode lent doit être compris entre 1 et 60 secondes." });
      }
      await channel.enableSlowMode(cooldownSeconds);
      await channel.sendMessage({
        type: "system",
        text: `Le mode lent a été activé : ${cooldownSeconds} seconde${cooldownSeconds > 1 ? "s" : ""} entre chaque message.`,
        user_id: user.id,
      });
      return json(200, { success: true, cooldown: cooldownSeconds });
    }

    if (action === "disable_slow_mode") {
      await channel.disableSlowMode();
      await channel.sendMessage({
        type: "system",
        text: "Le mode lent a été désactivé.",
        user_id: user.id,
      });
      return json(200, { success: true, cooldown: 0 });
    }

    return json(400, { error: "Action inconnue." });
  } catch (error) {
    console.error("stream-public-channel failure", error);
    return json(502, { error: "Le salon public est momentanément indisponible." });
  }
});
