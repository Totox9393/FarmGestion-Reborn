import { supabase } from '../authentification/supabaseClient';

const USER_RELATIONS_TABLE = 'user_relations';
const USER_SETTINGS_TABLE = 'user_settings';
const ALLOW_FRIEND_REQUESTS_SETTING_NAME = 'allow_friend_requests';
const FRIEND_REQUESTS_DISABLED_CODE = 'FG_FRIEND_REQUESTS_DISABLED';

const ensureUuid = (value) => String(value || '').trim();

const toIsoNow = () => new Date().toISOString();

const getPeerId = (row, currentUserId) => {
  if (!row || !currentUserId) return '';
  return row.user_a === currentUserId ? row.user_b : row.user_a;
};

const buildPairFilter = (a, b) =>
  `or(and(user_a.eq.${a},user_b.eq.${b}),and(user_a.eq.${b},user_b.eq.${a}))`;

const parseBooleanSettingValue = (value, defaultValue = true) => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'false') return false;
    if (normalized === 'true') return true;
    return defaultValue;
  }
  if (value && typeof value === 'object') {
    if (typeof value.enabled === 'boolean') return value.enabled;
    if (typeof value.value === 'boolean') return value.value;
  }
  return defaultValue;
};

export const isUserAllowingFriendRequests = async (userId) => {
  const targetUserId = ensureUuid(userId);
  if (!targetUserId) return true;

  // Preferred path: RPC can bypass restrictive RLS on user_settings.
  const { data: rpcData, error: rpcError } = await supabase.rpc('get_allow_friend_requests', {
    p_user_id: targetUserId,
  });

  if (!rpcError && typeof rpcData === 'boolean') {
    return rpcData;
  }

  const { data, error } = await supabase
    .from(USER_SETTINGS_TABLE)
    .select('setting_value')
    .eq('user_id', targetUserId)
    .eq('setting_name', ALLOW_FRIEND_REQUESTS_SETTING_NAME)
    .maybeSingle();

  if (error) throw error;
  if (!data) return true;

  return parseBooleanSettingValue(data.setting_value, true);
};

export const isFriendRequestsDisabledError = (error) =>
  String(error?.code || '') === FRIEND_REQUESTS_DISABLED_CODE ||
  /ALLOW_FRIEND_REQUESTS_DISABLED|disabled friend requests/i.test(
    `${String(error?.details || '')} ${String(error?.message || '')}`,
  );

const throwFriendRequestsDisabledError = () => {
  const error = new Error('Target user disabled friend requests');
  error.code = FRIEND_REQUESTS_DISABLED_CODE;
  throw error;
};

const fetchProfilesByIds = async (ids) => {
  const uniqueIds = Array.from(new Set((ids || []).filter(Boolean)));
  if (!uniqueIds.length) return [];

  const { data, error } = await supabase
    .from('users_profiles')
    .select('id, username, avatar_url, role_ingame')
    .in('id', uniqueIds);

  if (error) throw error;
  return Array.isArray(data) ? data : [];
};

export const fetchRelationBetweenUsers = async (userIdA, userIdB) => {
  const a = ensureUuid(userIdA);
  const b = ensureUuid(userIdB);
  if (!a || !b || a === b) return null;

  const { data, error } = await supabase
    .from(USER_RELATIONS_TABLE)
    .select('id, user_a, user_b, initiator, status, created_at, responded_at')
    .or(buildPairFilter(a, b))
    .maybeSingle();

  if (error) throw error;
  return data || null;
};

export const fetchAcceptedFriendsForUser = async (userId) => {
  const currentUserId = ensureUuid(userId);
  if (!currentUserId) return [];

  const { data: rows, error } = await supabase
    .from(USER_RELATIONS_TABLE)
    .select('id, user_a, user_b, created_at')
    .eq('status', 'accepted')
    .or(`user_a.eq.${currentUserId},user_b.eq.${currentUserId}`)
    .order('created_at', { ascending: false });

  if (error) throw error;

  const rawRows = Array.isArray(rows) ? rows : [];
  const peerIds = rawRows.map((row) => getPeerId(row, currentUserId)).filter(Boolean);
  const profiles = await fetchProfilesByIds(peerIds);
  const profileById = new Map(profiles.map((row) => [row.id, row]));

  return rawRows
    .map((row) => {
      const peerId = getPeerId(row, currentUserId);
      const profile = profileById.get(peerId);
      if (!profile) return null;
      return {
        relationId: row.id,
        friendId: peerId,
        username: profile.username || 'Utilisateur',
        avatarUrl: profile.avatar_url || '',
        roleIngame: profile.role_ingame || '',
        since: row.created_at || '',
      };
    })
    .filter(Boolean);
};

export const fetchAcceptedFriendIdsForUser = async (userId) => {
  const currentUserId = ensureUuid(userId);
  if (!currentUserId) return [];

  const { data: rows, error } = await supabase
    .from(USER_RELATIONS_TABLE)
    .select('user_a, user_b')
    .eq('status', 'accepted')
    .or(`user_a.eq.${currentUserId},user_b.eq.${currentUserId}`);

  if (error) throw error;

  return Array.from(
    new Set(
      (rows || [])
        .map((row) => getPeerId(row, currentUserId))
        .filter(Boolean),
    ),
  );
};

const fetchPendingRelationsByDirection = async (userId, direction) => {
  const currentUserId = ensureUuid(userId);
  if (!currentUserId) return [];

  const { data: rows, error } = await supabase
    .from(USER_RELATIONS_TABLE)
    .select('id, user_a, user_b, initiator, status, created_at')
    .eq('status', 'pending')
    .or(`user_a.eq.${currentUserId},user_b.eq.${currentUserId}`)
    .order('created_at', { ascending: false });

  if (error) throw error;

  const rawRows = Array.isArray(rows) ? rows : [];
  const filteredRows = rawRows.filter((row) => {
    if (!row) return false;
    const isUserInRow = row.user_a === currentUserId || row.user_b === currentUserId;
    if (!isUserInRow) return false;

    const isSent = row.initiator === currentUserId;
    return direction === 'sent' ? isSent : !isSent;
  });

  const peerIds = filteredRows.map((row) => getPeerId(row, currentUserId)).filter(Boolean);
  const profiles = await fetchProfilesByIds(peerIds);
  const profileById = new Map(profiles.map((row) => [row.id, row]));

  return filteredRows
    .map((row) => {
      const peerId = getPeerId(row, currentUserId);
      const peer = profileById.get(peerId);
      if (!peer) return null;
      return {
        id: row.id,
        peerId,
        peerUsername: peer.username || 'Utilisateur',
        peerAvatarUrl: peer.avatar_url || '',
        createdAt: row.created_at || '',
      };
    })
    .filter(Boolean);
};

export const fetchPendingFriendRequestsReceived = async (userId) =>
  fetchPendingRelationsByDirection(userId, 'received');

export const fetchPendingFriendRequestsSent = async (userId) =>
  fetchPendingRelationsByDirection(userId, 'sent');

export const sendFriendRequest = async (fromUserId, toUserId) => {
  const requester = ensureUuid(fromUserId);
  const addressee = ensureUuid(toUserId);
  if (!requester || !addressee || requester === addressee) {
    throw new Error('Invalid users for friend request');
  }

  const existing = await fetchRelationBetweenUsers(requester, addressee);

  if (!existing) {
    const canReceiveRequests = await isUserAllowingFriendRequests(addressee);
    if (!canReceiveRequests) {
      throwFriendRequestsDisabledError();
    }

    const { data, error } = await supabase
      .from(USER_RELATIONS_TABLE)
      .insert({
        user_a: requester,
        user_b: addressee,
        initiator: requester,
        status: 'pending',
      })
      .select('id, user_a, user_b, initiator, status, created_at, responded_at')
      .single();

    if (error) throw error;
    return data;
  }

  if (existing.status === 'blocked') {
    throw new Error('Relation is blocked');
  }

  if (existing.status === 'pending' || existing.status === 'accepted') {
    return existing;
  }

  const canReceiveRequests = await isUserAllowingFriendRequests(addressee);
  if (!canReceiveRequests) {
    throwFriendRequestsDisabledError();
  }

  const { data, error } = await supabase
    .from(USER_RELATIONS_TABLE)
    .update({
      status: 'pending',
      initiator: requester,
      created_at: toIsoNow(),
      responded_at: null,
    })
    .eq('id', existing.id)
    .select('id, user_a, user_b, initiator, status, created_at, responded_at')
    .single();

  if (error) throw error;
  return data;
};

export const acceptFriendRequestById = async (relationId) => {
  const id = Number(relationId);
  if (!Number.isFinite(id)) throw new Error('Invalid relation id');

  const { data, error } = await supabase
    .from(USER_RELATIONS_TABLE)
    .update({
      status: 'accepted',
      responded_at: toIsoNow(),
    })
    .eq('id', id)
    .eq('status', 'pending')
    .select('id, user_a, user_b, initiator, status, created_at, responded_at')
    .single();

  if (error) throw error;
  return data;
};

export const declineFriendRequestById = async (relationId) => {
  const id = Number(relationId);
  if (!Number.isFinite(id)) throw new Error('Invalid relation id');

  const { data, error } = await supabase
    .from(USER_RELATIONS_TABLE)
    .update({
      status: 'declined',
      responded_at: toIsoNow(),
    })
    .eq('id', id)
    .eq('status', 'pending')
    .select('id')
    .single();

  if (error) throw error;
  return data;
};

export const cancelFriendRequestById = async (relationId) => {
  const id = Number(relationId);
  if (!Number.isFinite(id)) throw new Error('Invalid relation id');

  const { data, error } = await supabase
    .from(USER_RELATIONS_TABLE)
    .update({
      status: 'cancelled',
      responded_at: toIsoNow(),
    })
    .eq('id', id)
    .eq('status', 'pending')
    .select('id')
    .single();

  if (error) throw error;
  return data;
};

export const removeFriendRelationById = async (relationId) => {
  const id = Number(relationId);
  if (!Number.isFinite(id)) throw new Error('Invalid relation id');

  const { error } = await supabase
    .from(USER_RELATIONS_TABLE)
    .delete()
    .eq('id', id)
    .eq('status', 'accepted');

  if (error) throw error;
};

export const blockRelation = async (fromUserId, toUserId) => {
  const blocker = ensureUuid(fromUserId);
  const target = ensureUuid(toUserId);
  if (!blocker || !target || blocker === target) {
    throw new Error('Invalid users for block');
  }

  const existing = await fetchRelationBetweenUsers(blocker, target);

  if (!existing) {
    const { data, error } = await supabase
      .from(USER_RELATIONS_TABLE)
      .insert({
        user_a: blocker,
        user_b: target,
        initiator: blocker,
        status: 'blocked',
        responded_at: toIsoNow(),
      })
      .select('id, user_a, user_b, initiator, status, created_at, responded_at')
      .single();

    if (error) throw error;
    return data;
  }

  const { data, error } = await supabase
    .from(USER_RELATIONS_TABLE)
    .update({
      status: 'blocked',
      initiator: blocker,
      responded_at: toIsoNow(),
    })
    .eq('id', existing.id)
    .select('id, user_a, user_b, initiator, status, created_at, responded_at')
    .single();

  if (error) throw error;
  return data;
};

export const unblockRelationById = async (relationId) => {
  const id = Number(relationId);
  if (!Number.isFinite(id)) throw new Error('Invalid relation id');

  const { data, error } = await supabase
    .from(USER_RELATIONS_TABLE)
    .update({
      status: 'cancelled',
      responded_at: toIsoNow(),
    })
    .eq('id', id)
    .eq('status', 'blocked')
    .select('id, user_a, user_b, initiator, status, created_at, responded_at')
    .single();

  if (error) throw error;
  return data;
};
