import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import { UserRound, Lock, Home, UserPlus, Pin, Heart, MessageSquare } from 'lucide-react';
import { supabase } from '../authentification/supabaseClient';
import { useAuth } from '../authentification/AuthContext';
import defaultProfileUser from '../../assets/defaut_profile_user.png';
import './CommunityProfilePage.css';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || '';

const isMissingRpcError = (error) => {
  const code = String(error?.code || '');
  const message = String(error?.message || '').toLowerCase();
  return code === '42883' || message.includes('function') || message.includes('rpc');
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
  const [flippedBetailIds, setFlippedBetailIds] = useState(() => new Set());

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
    queryKey: ['community', 'profile', 'pinned-betails', profile?.id],
    enabled: Boolean(profile?.id),
    staleTime: 0,
    gcTime: 10 * 60 * 1000,
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
    refetchInterval: 4_000,
    retry: 1,
    queryFn: async () => {
      const mapPinnedRows = (rows) =>
        (rows || []).map((row) => ({
          id: row.id,
          name: row.name || 'Betail',
          matricule: row.matricule || '—',
          likes: Number(row.like_count || 0),
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

        return mapPinnedRows(rows);
      }

      return [];
    },
  });

  const pinnedBetails = pinnedBetailsQuery.data || [];

  useEffect(() => {
    if (!profile?.id) return;

    const invalidateProfile = () => {
      queryClient.invalidateQueries({ queryKey: ['community', 'profile', handle] });
      queryClient.invalidateQueries({ queryKey: ['community', 'profile', 'pinned-betails', profile.id] });
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
                <button
                  type="button"
                  className="community-profile-add-friend"
                  onClick={() => window.dispatchEvent(new CustomEvent('farmgestion-toast', { detail: { type: 'info', message: 'Systeme d\'amis a venir.' } }))}
                >
                  <UserPlus size={16} /> Ajouter en ami
                </button>
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

            <section className="community-profile-pinned" aria-label="Betails epingles">
              <div className="community-profile-pinned__head">
                <h2><Pin size={16} /> Betails epingles</h2>
              </div>
              {pinnedBetailsQuery.isLoading ? (
                <p className="community-profile-pinned__state">Chargement des betails epingles...</p>
              ) : pinnedBetailsQuery.isError ? (
                <p className="community-profile-pinned__state is-error">Impossible de charger les betails epingles.</p>
              ) : !pinnedBetails.length ? (
                <p className="community-profile-pinned__state">Aucun betail epingle pour le moment.</p>
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
                            className="community-pinned-like"
                            onClick={(event) => {
                              event.preventDefault();
                              event.stopPropagation();
                            }}
                            aria-label={`Aimer ${betail.name} (bientot)`}
                            title="Like bientot"
                          >
                            <Heart size={14} /> {betail.likes}
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
