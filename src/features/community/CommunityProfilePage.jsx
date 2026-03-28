import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import { UserRound, Lock, Home, UserPlus, UserMinus, ShieldBan, Check, X, Users, Pin, Heart, MessageSquare } from 'lucide-react';
import { supabase } from '../authentification/supabaseClient';
import { useAuth } from '../authentification/AuthContext';
import {
  acceptFriendRequestById,
  blockRelation,
  cancelFriendRequestById,
  declineFriendRequestById,
  fetchAcceptedFriendsForUser,
  fetchRelationBetweenUsers,
  isFriendRequestsDisabledError,
  isUserAllowingFriendRequests,
  removeFriendRelationById,
  sendFriendRequest,
  unblockRelationById,
} from './friendsApi';
import defaultProfileUser from '../../assets/defaut_profile_user.png';
import blockedProfileFailSound from '../../assets/sounds/JIN_EVENT_FAIL.WAV';
import './CommunityProfilePage.css';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || '';

const isMissingRpcError = (error) => {
  const code = String(error?.code || '');
  const message = String(error?.message || '').toLowerCase();
  return code === '42883' || message.includes('function') || message.includes('rpc');
};

const isNotAuthenticatedError = (error) => {
  const message = String(error?.message || '').toLowerCase();
  return message.includes('not authenticated');
};

const buildAvatarCandidates = (value) => {
  const raw = String(value || '').trim();
  if (!raw) return [];
  if (raw.startsWith('http://') || raw.startsWith('https://')) return [raw];
  if (!SUPABASE_URL) return [raw];

  const candidates = [raw];
  if (raw.startsWith('/storage/v1/object/public/')) {
    candidates.push(`${SUPABASE_URL}${raw}`);
  } else if (raw.startsWith('storage/v1/object/public/')) {
    candidates.push(`${SUPABASE_URL}/${raw}`);
  } else if (raw.startsWith('/')) {
    candidates.push(`${SUPABASE_URL}${raw}`);
    const normalized = raw.replace(/^\/+/, '');
    candidates.push(`${SUPABASE_URL}/${normalized}`);
  } else if (raw.includes('/')) {
    candidates.push(`${SUPABASE_URL}/storage/v1/object/public/${raw}`);
  } else {
    candidates.push(`${SUPABASE_URL}/storage/v1/object/public/avatars/${raw}`);
    candidates.push(`${SUPABASE_URL}/storage/v1/object/public/ressources/${raw}`);
    candidates.push(`${SUPABASE_URL}/storage/v1/object/public/betails/${raw}`);
  }

  return Array.from(new Set(candidates));
};

const normalizeSettingBetailIds = (value) => {
  let parsed = value;
  if (typeof parsed === 'string') {
    const trimmed = parsed.trim();
    if (!trimmed) return [];
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      return [];
    }
  }

  if (!Array.isArray(parsed)) return [];

  return Array.from(
    new Set(
      parsed
        .map((id) => {
          if (typeof id === 'string') return id.trim();
          if (typeof id === 'number' && Number.isFinite(id)) return String(id);
          if (id && typeof id === 'object' && typeof id.id === 'string') return id.id.trim();
          if (id && typeof id === 'object' && typeof id.id === 'number') return String(id.id);
          return '';
        })
        .filter(Boolean),
    ),
  );
};

const resolveBetailImageUrl = (value) => {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (raw.startsWith('http://') || raw.startsWith('https://')) return raw;
  if (!SUPABASE_URL) return raw;

  if (raw.startsWith('/storage/v1/object/public/')) {
    return `${SUPABASE_URL}${raw}`;
  }
  if (raw.startsWith('storage/v1/object/public/')) {
    return `${SUPABASE_URL}/${raw}`;
  }
  if (raw.startsWith('/')) {
    return `${SUPABASE_URL}${raw}`;
  }
  if (raw.includes('/')) {
    return `${SUPABASE_URL}/storage/v1/object/public/${raw}`;
  }
  return `${SUPABASE_URL}/storage/v1/object/public/betails/${raw}`;
};

const dispatchToast = (message, type = 'info') => {
  window.dispatchEvent(new CustomEvent('farmgestion-toast', { detail: { type, message } }));
};

function AvatarMedia({ avatarUrl }) {
  const candidates = useMemo(() => buildAvatarCandidates(avatarUrl), [avatarUrl]);
  const [index, setIndex] = useState(0);

  useEffect(() => {
    setIndex(0);
  }, [avatarUrl]);

  const nextSrc = candidates[index] || '';
  if (!nextSrc || index >= candidates.length) {
    return <img src={defaultProfileUser} alt="Avatar profil" loading="lazy" />;
  }

  return (
    <img
      src={nextSrc}
      alt="Avatar profil"
      loading="lazy"
      onError={() => {
        if (index < candidates.length - 1) {
          setIndex((current) => current + 1);
          return;
        }
        setIndex(candidates.length);
      }}
    />
  );
}

const fetchCommunityProfile = async (handleRaw) => {
  const handle = decodeURIComponent(String(handleRaw || '')).trim();
  if (!handle) return null;
  const response = await supabase
    .from('users_profiles')
    .select('id, username, avatar_url, created_at, farm_id, role_ingame')
    .ilike('username', handle)
    .maybeSingle();

  const profile = response.data || null;
  const profileError = response.error || null;

  if (profileError) throw profileError;
  if (!profile) return null;

  const { data: farm } = profile.farm_id
    ? await supabase
        .from('farms_list')
        .select('id, name, visible, state')
        .eq('id', profile.farm_id)
        .maybeSingle()
    : { data: null };

  return {
    ...profile,
    farm: farm || null,
  };
};

function CommunityProfilePage() {
  const { handle } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const blockedSoundPlayedRef = useRef(false);
  const confirmResetTimerRef = useRef(null);
  const [flippedBetailIds, setFlippedBetailIds] = useState(() => new Set());
  const [confirmAction, setConfirmAction] = useState('');

  const profileQuery = useQuery({
    queryKey: ['community', 'profile', handle],
    queryFn: () => fetchCommunityProfile(handle),
    enabled: Boolean(handle),
    staleTime: 0,
    gcTime: 10 * 60 * 1000,
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
    refetchInterval: 4_000,
    retry: 1,
  });

  const profile = profileQuery.data;
  const isOwnProfile = Boolean(user?.id && profile?.id && user.id === profile.id);
  const pinnedBetailsQueryKey = ['community', 'profile', 'pinned-betails', profile?.id];

  const relationQuery = useQuery({
    queryKey: ['community', 'profile', 'relation', user?.id || 'anon', profile?.id || 'none'],
    enabled: Boolean(user?.id && profile?.id && !isOwnProfile),
    staleTime: 0,
    gcTime: 10 * 60 * 1000,
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
    retry: 1,
    queryFn: () => fetchRelationBetweenUsers(user.id, profile.id),
  });

  const friendsListQuery = useQuery({
    queryKey: ['community', 'profile', 'friends-list', profile?.id || 'none'],
    enabled: Boolean(profile?.id),
    staleTime: 0,
    gcTime: 10 * 60 * 1000,
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
    retry: 1,
    queryFn: () => fetchAcceptedFriendsForUser(profile.id),
  });

  const allowFriendRequestsQuery = useQuery({
    queryKey: ['community', 'profile', 'allow-friend-requests', profile?.id || 'none'],
    enabled: Boolean(profile?.id),
    staleTime: 0,
    gcTime: 10 * 60 * 1000,
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
    retry: 1,
    queryFn: () => isUserAllowingFriendRequests(profile.id),
  });

  const relation = relationQuery.data || null;
  const relationStatus = String(relation?.status || '');
  const isIncomingPending = relationStatus === 'pending' && Boolean(relation?.initiator && relation.initiator !== user?.id);
  const isOutgoingPending = relationStatus === 'pending' && Boolean(relation?.initiator && relation.initiator === user?.id);
  const isFriend = relationStatus === 'accepted';
  const canReceiveFriendRequests = allowFriendRequestsQuery.data ?? true;
  const isFriendRequestsDisabledByUser = !canReceiveFriendRequests;
  const isBlockedByCurrentUser = relationStatus === 'blocked' && relation?.initiator === user?.id;
  const isBlockedByOtherUser = relationStatus === 'blocked' && Boolean(relation?.initiator && relation.initiator !== user?.id);
  const isProfileAccessBlocked = Boolean(!isOwnProfile && isBlockedByOtherUser);

  useEffect(() => {
    if (!isProfileAccessBlocked) {
      blockedSoundPlayedRef.current = false;
      return;
    }

    if (blockedSoundPlayedRef.current) return;
    blockedSoundPlayedRef.current = true;

    try {
      const audio = new Audio(blockedProfileFailSound);
      audio.volume = 0.72;
      void audio.play().catch(() => {});
    } catch {
      // Ignore playback errors (autoplay permissions, etc.)
    }
  }, [isProfileAccessBlocked]);

  const refreshRelations = () => {
    queryClient.invalidateQueries({ queryKey: ['community', 'profile', 'relation', user?.id || 'anon', profile?.id || 'none'] });
    queryClient.invalidateQueries({ queryKey: ['community', 'profile', 'friends-list', profile?.id || 'none'] });
    window.dispatchEvent(new CustomEvent('farmgestion-friends-updated'));
  };

  const sendRequestMutation = useMutation({
    mutationFn: () => sendFriendRequest(user.id, profile.id),
    onSuccess: () => {
      refreshRelations();
      dispatchToast('Demande d\'ami envoyée.', 'success');
    },
    onError: (error) => {
      if (isFriendRequestsDisabledError(error)) {
        dispatchToast('Cet utilisateur a désactivé les demandes d\'amis.', 'warning');
        return;
      }
      dispatchToast('Impossible d\'envoyer la demande d\'ami.', 'error');
    },
  });

  const acceptMutation = useMutation({
    mutationFn: () => acceptFriendRequestById(relation.id),
    onSuccess: () => {
      refreshRelations();
      dispatchToast('Demande d\'ami acceptée.', 'success');
    },
    onError: () => dispatchToast('Impossible d\'accepter la demande.', 'error'),
  });

  const declineMutation = useMutation({
    mutationFn: () => declineFriendRequestById(relation.id),
    onSuccess: () => {
      refreshRelations();
      dispatchToast('Demande d\'ami refusée.', 'info');
    },
    onError: () => dispatchToast('Impossible de refuser la demande.', 'error'),
  });

  const cancelMutation = useMutation({
    mutationFn: () => cancelFriendRequestById(relation.id),
    onSuccess: () => {
      refreshRelations();
      dispatchToast('Demande d\'ami annulée.', 'info');
    },
    onError: () => dispatchToast('Impossible d\'annuler la demande.', 'error'),
  });

  const removeFriendMutation = useMutation({
    mutationFn: () => removeFriendRelationById(relation.id),
    onSuccess: () => {
      refreshRelations();
      dispatchToast('Ami supprimé.', 'success');
    },
    onError: () => dispatchToast('Impossible de supprimer cet ami.', 'error'),
  });

  const blockMutation = useMutation({
    mutationFn: () => blockRelation(user.id, profile.id),
    onSuccess: () => {
      refreshRelations();
      dispatchToast('Utilisateur bloqué.', 'success');
    },
    onError: () => dispatchToast('Impossible de bloquer cet utilisateur.', 'error'),
  });

  const unblockMutation = useMutation({
    mutationFn: () => unblockRelationById(relation.id),
    onSuccess: () => {
      refreshRelations();
      dispatchToast('Utilisateur débloqué.', 'success');
    },
    onError: () => dispatchToast('Impossible de débloquer cet utilisateur.', 'error'),
  });

  const isFriendActionBusy =
    sendRequestMutation.isPending ||
    acceptMutation.isPending ||
    declineMutation.isPending ||
    cancelMutation.isPending ||
    removeFriendMutation.isPending ||
    blockMutation.isPending ||
    unblockMutation.isPending;

  const scheduleConfirmReset = () => {
    if (confirmResetTimerRef.current) {
      window.clearTimeout(confirmResetTimerRef.current);
    }
    confirmResetTimerRef.current = window.setTimeout(() => {
      setConfirmAction('');
      confirmResetTimerRef.current = null;
    }, 3800);
  };

  useEffect(() => () => {
    if (confirmResetTimerRef.current) {
      window.clearTimeout(confirmResetTimerRef.current);
    }
  }, []);

  useEffect(() => {
    if (!isFriendActionBusy) return;
    setConfirmAction('');
    if (confirmResetTimerRef.current) {
      window.clearTimeout(confirmResetTimerRef.current);
      confirmResetTimerRef.current = null;
    }
  }, [isFriendActionBusy]);

  const handleRemoveFriend = () => {
    if (!relation?.id) return;
    if (!window.confirm('Supprimer cet ami ?')) return;
    removeFriendMutation.mutate();
  };

  const handleBlockUser = () => {
    if (!user?.id || !profile?.id) return;
    if (confirmAction !== 'block') {
      setConfirmAction('block');
      scheduleConfirmReset();
      dispatchToast('Clique encore sur "Bloquer" pour confirmer.', 'warning');
      return;
    }
    setConfirmAction('');
    blockMutation.mutate();
  };

  const handleUnblockUser = () => {
    if (!relation?.id) return;
    if (confirmAction !== 'unblock') {
      setConfirmAction('unblock');
      scheduleConfirmReset();
      dispatchToast('Clique encore sur "Débloquer" pour confirmer.', 'warning');
      return;
    }
    setConfirmAction('');
    unblockMutation.mutate();
  };

  const friendsList = friendsListQuery.data || [];

  const togglePinnedCard = (betailId) => {
    setFlippedBetailIds((current) => {
      const next = new Set(current);
      if (next.has(betailId)) {
        next.delete(betailId);
      } else {
        next.add(betailId);
      }
      return next;
    });
  };

  const pinnedBetailsQuery = useQuery({
    queryKey: pinnedBetailsQueryKey,
    enabled: Boolean(profile?.id),
    staleTime: 0,
    gcTime: 10 * 60 * 1000,
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
    refetchInterval: 4_000,
    retry: 1,
    queryFn: async () => {
      const mapPinnedRows = (rows, likedIds = new Set()) =>
        (rows || []).map((row) => ({
          id: row.id,
          name: row.name || 'Betail',
          matricule: row.matricule || '—',
          likes: Number(row.like_count || 0),
          likedByMe: Boolean(row.liked_by_me) || likedIds.has(String(row.id)),
          comments: String(row.comments || '').trim(),
          avatarUrl: resolveBetailImageUrl(row.avatar_url),
        }));

      const { data: rpcRows, error: rpcError } = await supabase.rpc('get_public_pinned_betails', {
        p_user_id: profile.id,
        p_limit: 24,
      });

      if (!rpcError) {
        return mapPinnedRows(rpcRows);
      }

      // Temporary fallback while SQL function is not deployed everywhere.
      if (!isMissingRpcError(rpcError)) {
        throw rpcError;
      }

      let pinnedIds = [];
      const { data: settingRow, error: settingsError } = await supabase
        .from('user_settings')
        .select('setting_value')
        .eq('user_id', profile.id)
        .eq('setting_name', 'pinned_betails')
        .maybeSingle();

      // Some profiles might be restricted by RLS on user_settings; fallback below handles it.
      if (!settingsError) {
        pinnedIds = normalizeSettingBetailIds(settingRow?.setting_value);
      }

      if (pinnedIds.length) {
        const { data: fromSettingsRows, error: fromSettingsError } = await supabase
          .from('betails')
          .select('id, name, matricule, avatar_url, like_count, visible, comments')
          .in('id', pinnedIds)
          .eq('visible', true);

        if (fromSettingsError) {
          throw fromSettingsError;
        }

        const rowById = new Map((fromSettingsRows || []).map((row) => [String(row.id), row]));
        const rows = pinnedIds
          .map((id) => rowById.get(String(id)))
          .filter(Boolean);

        const likedIds = new Set();
        if (user?.id && rows.length) {
          const betailIds = rows.map((row) => row.id).filter(Boolean);
          if (betailIds.length) {
            const { data: likedRows } = await supabase
              .from('betail_likes')
              .select('betail_id')
              .eq('user_id', user.id)
              .in('betail_id', betailIds);

            (likedRows || []).forEach((entry) => {
              if (entry?.betail_id) likedIds.add(String(entry.betail_id));
            });
          }
        }

        return mapPinnedRows(rows, likedIds);
      }

      return [];
    },
  });

  const pinnedBetails = pinnedBetailsQuery.data || [];

  const togglePinnedLikeMutation = useMutation({
    mutationFn: async ({ betailId, currentlyLiked }) => {
      const rpcName = currentlyLiked ? 'unlike_betail' : 'like_betail';
      const { data, error } = await supabase.rpc(rpcName, { p_betail_id: betailId });
      if (error) throw error;

      const payload = Array.isArray(data) ? data[0] : data;
      return {
        betailId,
        currentlyLiked,
        liked: Boolean(payload?.liked),
        likeCount: Number(payload?.like_count ?? 0),
      };
    },
    onMutate: async ({ betailId, currentlyLiked }) => {
      await queryClient.cancelQueries({ queryKey: pinnedBetailsQueryKey });
      const previousRows = queryClient.getQueryData(pinnedBetailsQueryKey);

      queryClient.setQueryData(pinnedBetailsQueryKey, (currentRows = []) =>
        currentRows.map((row) => {
          if (row?.id !== betailId) return row;
          const nextLiked = !currentlyLiked;
          const currentLikes = Number(row?.likes || 0);
          return {
            ...row,
            likedByMe: nextLiked,
            likes: Math.max(0, currentLikes + (nextLiked ? 1 : -1)),
          };
        }),
      );

      return { previousRows };
    },
    onError: (error, _variables, context) => {
      if (context?.previousRows) {
        queryClient.setQueryData(pinnedBetailsQueryKey, context.previousRows);
      }

      if (isNotAuthenticatedError(error)) {
        dispatchToast('Connecte-toi pour liker un bétail.', 'warning');
        return;
      }

      dispatchToast('Impossible de mettre à jour le like.', 'error');
    },
    onSuccess: (result) => {
      queryClient.setQueryData(pinnedBetailsQueryKey, (currentRows = []) =>
        currentRows.map((row) => {
          if (row?.id !== result.betailId) return row;
          return {
            ...row,
            likedByMe: result.liked,
            likes: result.likeCount,
          };
        }),
      );
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: pinnedBetailsQueryKey });
    },
  });

  const handleTogglePinnedLike = (betail) => {
    if (!betail?.id || togglePinnedLikeMutation.isPending) return;
    togglePinnedLikeMutation.mutate({
      betailId: betail.id,
      currentlyLiked: Boolean(betail.likedByMe),
    });
  };

  useEffect(() => {
    if (!profile?.id) return;

    const invalidateProfile = () => {
      queryClient.invalidateQueries({ queryKey: ['community', 'profile', handle] });
      queryClient.invalidateQueries({ queryKey: ['community', 'profile', 'pinned-betails', profile.id] });
      queryClient.invalidateQueries({ queryKey: ['community', 'profile', 'allow-friend-requests', profile.id] });
    };

    const channel = supabase
      .channel(`community-profile-live-${profile.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'betails',
          filter: `owner_id=eq.${profile.id}`,
        },
        invalidateProfile,
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'user_settings',
          filter: `user_id=eq.${profile.id}`,
        },
        invalidateProfile,
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'users_profiles',
          filter: `id=eq.${profile.id}`,
        },
        invalidateProfile,
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'user_relations',
          filter: `user_a=eq.${profile.id}`,
        },
        invalidateProfile,
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'user_relations',
          filter: `user_b=eq.${profile.id}`,
        },
        invalidateProfile,
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [handle, profile?.id, queryClient]);

  return (
    <main className="community-profile-page">
      <section className="community-profile-shell">
        {profileQuery.isLoading ? (
          <p className="community-profile-state">Chargement du profil...</p>
        ) : profileQuery.isError ? (
          <p className="community-profile-state is-error">Impossible de charger ce profil.</p>
        ) : !profile ? (
          <p className="community-profile-state">Profil introuvable.</p>
        ) : isProfileAccessBlocked ? (
          <article className="community-profile-blocked" aria-live="polite">
            <div className="community-profile-blocked__lock" aria-hidden="true">
              <div className="community-profile-blocked__shackle" />
              <div className="community-profile-blocked__body">
                <Lock size={52} strokeWidth={2.2} />
              </div>
            </div>

            <p className="community-profile-blocked__eyebrow">Accès verrouillé</p>
            <h1>
              {isBlockedByCurrentUser
                ? 'Profil inaccessible : tu as bloqué cet utilisateur'
                : 'Profil inaccessible : cet utilisateur t\'a bloqué'}
            </h1>
            <p className="community-profile-blocked__text">
              Ce profil est actuellement verrouillé. Les interactions sociales sont suspendues entre vos comptes.
            </p>

            <div className="community-profile-blocked__actions">
              <button type="button" className="community-profile-back" onClick={() => navigate('/community')}>
                <UserRound size={16} /> Retour communauté
              </button>
            </div>
          </article>
        ) : (
          <article className="community-profile-card">
            <div className="community-profile-head">
              <div className="community-profile-avatar" aria-hidden="true">
                <AvatarMedia avatarUrl={profile?.avatar_url} />
              </div>
              <div>
                <p className="community-profile-eyebrow">Profil communauté</p>
                <h1>{profile.username || 'Utilisateur'}</h1>
                <p className="community-profile-role">{profile.role_ingame || 'Membre non-vérifié'}</p>
              </div>
              {!isOwnProfile ? (
                <div className="community-profile-friend-actions">
                  {relationQuery.isLoading || allowFriendRequestsQuery.isLoading ? (
                    <span className="community-profile-friend-hint">Chargement relation...</span>
                  ) : isIncomingPending ? (
                    <>
                      <button
                        type="button"
                        className="community-profile-add-friend"
                        disabled={isFriendActionBusy}
                        onClick={() => acceptMutation.mutate()}
                      >
                        <Check size={16} /> Accepter
                      </button>
                      <button
                        type="button"
                        className="community-profile-friend-btn community-profile-friend-btn--danger"
                        disabled={isFriendActionBusy}
                        onClick={() => declineMutation.mutate()}
                      >
                        <X size={16} /> Refuser
                      </button>
                    </>
                  ) : isOutgoingPending ? (
                    <button
                      type="button"
                      className="community-profile-friend-btn community-profile-friend-btn--ghost"
                      disabled={isFriendActionBusy}
                      onClick={() => cancelMutation.mutate()}
                    >
                      <X size={16} /> Annuler la demande
                    </button>
                  ) : isFriend ? (
                    <>
                      <button
                        type="button"
                        className="community-profile-friend-btn community-profile-friend-btn--warn"
                        disabled={isFriendActionBusy}
                        onClick={handleRemoveFriend}
                      >
                        <UserMinus size={16} /> Supprimer ami
                      </button>
                      <button
                        type="button"
                        className="community-profile-friend-btn community-profile-friend-btn--danger"
                        disabled={isFriendActionBusy}
                        onClick={handleBlockUser}
                      >
                        <ShieldBan size={16} /> {confirmAction === 'block' ? 'Confirmer blocage' : 'Bloquer'}
                      </button>
                    </>
                  ) : isBlockedByCurrentUser ? (
                    <button
                      type="button"
                      className="community-profile-friend-btn community-profile-friend-btn--warn"
                      disabled={isFriendActionBusy}
                      onClick={handleUnblockUser}
                    >
                      <ShieldBan size={16} /> {confirmAction === 'unblock' ? 'Confirmer déblocage' : 'Débloquer'}
                    </button>
                  ) : isBlockedByOtherUser ? (
                    <button type="button" className="community-profile-friend-btn community-profile-friend-btn--blocked" disabled>
                      <ShieldBan size={16} /> Tu es bloqué
                    </button>
                  ) : isFriendRequestsDisabledByUser ? (
                    <>
                      <div className="community-profile-friend-disabled" aria-live="polite">
                        <button
                          type="button"
                          className="community-profile-friend-btn community-profile-friend-btn--disabled-request"
                          disabled
                          tabIndex={-1}
                        >
                          <UserPlus size={16} /> Demandes désactivées
                        </button>
                      </div>
                      <button
                        type="button"
                        className="community-profile-friend-btn community-profile-friend-btn--danger"
                        disabled={isFriendActionBusy}
                        onClick={handleBlockUser}
                      >
                        <ShieldBan size={16} /> {confirmAction === 'block' ? 'Confirmer blocage' : 'Bloquer'}
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        type="button"
                        className="community-profile-add-friend"
                        disabled={isFriendActionBusy}
                        onClick={() => sendRequestMutation.mutate()}
                      >
                        <UserPlus size={16} /> Ajouter en ami
                      </button>
                      <button
                        type="button"
                        className="community-profile-friend-btn community-profile-friend-btn--danger"
                        disabled={isFriendActionBusy}
                        onClick={handleBlockUser}
                      >
                        <ShieldBan size={16} /> {confirmAction === 'block' ? 'Confirmer blocage' : 'Bloquer'}
                      </button>
                    </>
                  )}
                </div>
              ) : null}
            </div>

            <div className="community-profile-actions">
              {profile?.farm?.id && profile.farm.visible ? (
                <button type="button" onClick={() => navigate(`/farm/${profile.farm.id}`)}>
                  <Home size={16} /> Voir la ferme publique
                </button>
              ) : (
                <p className="community-profile-private"><Lock size={16} /> Ferme privée ou indisponible</p>
              )}

              <button type="button" className="community-profile-back" onClick={() => navigate('/community')}>
                <UserRound size={16} /> Retour communauté
              </button>
            </div>

            <section className="community-profile-friends" aria-label="Liste d'amis">
              <div className="community-profile-friends__head">
                <h2><Users size={16} /> Liste d'amis</h2>
                <span>{friendsList.length}</span>
              </div>

              {friendsListQuery.isLoading ? (
                <p className="community-profile-friends__state">Chargement des amis...</p>
              ) : friendsListQuery.isError ? (
                <p className="community-profile-friends__state is-error">Impossible de charger la liste d'amis.</p>
              ) : !friendsList.length ? (
                <p className="community-profile-friends__state">Aucun ami affiché pour le moment.</p>
              ) : (
                <div className="community-profile-friends__grid">
                  {friendsList.map((friend) => (
                    <button
                      key={friend.friendId}
                      type="button"
                      className="community-profile-friend-card"
                      title={friend.username}
                      onClick={() => navigate(`/community/profile/${encodeURIComponent(friend.username)}`)}
                    >
                      <span className="community-profile-friend-card__avatar" aria-hidden="true">
                        <AvatarMedia avatarUrl={friend.avatarUrl} />
                      </span>
                      <span className="community-profile-friend-card__content">
                        <span className="community-profile-friend-card__name">{friend.username}</span>
                        <span className="community-profile-friend-card__role">{friend.roleIngame || 'Membre'}</span>
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </section>

            <section className="community-profile-pinned" aria-label="Betails epinglés">
              <div className="community-profile-pinned__head">
                <h2><Pin size={16} /> Betails epinglés</h2>
              </div>
              {pinnedBetailsQuery.isLoading ? (
                <p className="community-profile-pinned__state">Chargement des betails épinglés...</p>
              ) : pinnedBetailsQuery.isError ? (
                <p className="community-profile-pinned__state is-error">Impossible de charger les betails épinglés.</p>
              ) : !pinnedBetails.length ? (
                <p className="community-profile-pinned__state">Aucun betail épinglé pour le moment.</p>
              ) : (
                <div className="community-profile-pinned__grid">
                  {pinnedBetails.map((betail) => (
                    <article
                      key={betail.id}
                      className={`community-pinned-card ${flippedBetailIds.has(betail.id) ? 'is-flipped' : ''}`}
                      title={`${betail.name} (${betail.matricule})`}
                      role="button"
                      tabIndex={0}
                      onClick={() => togglePinnedCard(betail.id)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          togglePinnedCard(betail.id);
                        }
                      }}
                    >
                      <div className="community-pinned-card__inner">
                        <div className="community-pinned-card__face community-pinned-card__face--front">
                          <button
                            type="button"
                            className={`community-pinned-like ${betail.likedByMe ? 'is-liked' : ''}`}
                            onClick={(event) => {
                              event.preventDefault();
                              event.stopPropagation();
                              handleTogglePinnedLike(betail);
                            }}
                            disabled={togglePinnedLikeMutation.isPending}
                            aria-label={betail.likedByMe ? `Retirer le like de ${betail.name}` : `Aimer ${betail.name}`}
                            title={betail.likedByMe ? 'Retirer le like' : 'Aimer'}
                          >
                            <Heart size={14} fill={betail.likedByMe ? 'currentColor' : 'none'} /> {betail.likes}
                          </button>
                          <div className="community-pinned-avatar" aria-hidden="true">
                            {betail.avatarUrl ? (
                              <img src={betail.avatarUrl} alt="" loading="lazy" />
                            ) : (
                              <img src={defaultProfileUser} alt="" loading="lazy" />
                            )}
                          </div>
                          <div className="community-pinned-info">
                            <span className="community-pinned-name">{betail.name}</span>
                            <span className="community-pinned-matricule">{betail.matricule}</span>
                          </div>
                        </div>

                        <div className="community-pinned-card__face community-pinned-card__face--back">
                          <span className="community-pinned-comment-title"><MessageSquare size={14} /> Commentaire</span>
                          <span className="community-pinned-comment-scroll">
                            {betail.comments || 'Aucun commentaire pour ce betail.'}
                          </span>
                        </div>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </section>
          </article>
        )}
      </section>
    </main>
  );
}

export default CommunityProfilePage;
