import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import { UserRound, Lock, Home } from 'lucide-react';
import { supabase } from '../authentification/supabaseClient';
import defaultProfileUser from '../../assets/defaut_profile_user.png';
import './CommunityProfilePage.css';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || '';

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

  const profileQuery = useQuery({
    queryKey: ['community', 'profile', handle],
    queryFn: () => fetchCommunityProfile(handle),
    enabled: Boolean(handle),
    staleTime: 2 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
    refetchOnWindowFocus: false,
    retry: 1,
  });

  const profile = profileQuery.data;

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
          </article>
        )}
      </section>
    </main>
  );
}

export default CommunityProfilePage;
