import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Search, Users, ChevronRight } from 'lucide-react';
import miloFriends from '../../assets/img/milo_friends_happy2nb.png';
import defaultProfileUser from '../../assets/defaut_profile_user.png';
import { createHexagonPoints, createTrianglePoints } from '../utils/FarmDesign/farmDesignUtils';
import { fetchActiveUserIdsThisMonth, fetchCommunityPage, fetchCommunityStats } from './communityApi';
import './CommunityPage.css';

const SEARCH_DEBOUNCE_MS = 320;

const toAvatarFallback = (username) => {
  const safe = String(username || '').trim();
  return safe ? safe.slice(0, 1).toUpperCase() : '?';
};

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

function AvatarMedia({ avatarUrl, username, alt }) {
  const candidates = useMemo(() => buildAvatarCandidates(avatarUrl), [avatarUrl]);
  const [index, setIndex] = useState(0);

  useEffect(() => {
    setIndex(0);
  }, [avatarUrl]);

  const nextSrc = candidates[index] || '';

  if (!nextSrc || index >= candidates.length) {
    return <img src={defaultProfileUser} alt={alt} loading="lazy" />;
  }

  return (
    <img
      src={nextSrc}
      alt={alt}
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

const formatDate = (iso) => {
  if (!iso) return 'Date inconnue';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'Date inconnue';
  return new Intl.DateTimeFormat('fr-FR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(date);
};

const dispatchToast = (message, type = 'warning') => {
  window.dispatchEvent(
    new CustomEvent('farmgestion-toast', {
      detail: { type, message },
    }),
  );
};

const buildCommunityProfilePath = (username, userId) => {
  const normalizedUsername = String(username || '').trim();
  if (normalizedUsername) return `/community/profile/${encodeURIComponent(normalizedUsername)}`;
  return '';
};

const MiniFarmPreview = ({ siteColors, centerStyle, label }) => {
  const colors = Array.isArray(siteColors) && siteColors.length === 6
    ? siteColors
    : ['#FFB3BA', '#BAFFC9', '#BAE1FF', '#FFFFBA', '#E0BBE4', '#FFDFBA'];

  return (
    <div className="community-mini-farm" style={{ '--farm-glow': colors[0] || '#8b7df1' }} aria-hidden="true">
      <svg viewBox="0 0 200 200" className="community-mini-farm__svg" aria-label={`Ferme ${label}`}>
        <polygon className="community-mini-farm__outline" points={createHexagonPoints(100, 100, 86)} />
        {colors.map((color, index) => (
          <polygon
            key={index}
            className="community-mini-farm__site"
            points={createTrianglePoints(100, 100, 86, index)}
            style={{ fill: color }}
          />
        ))}
        <circle className="community-mini-farm__core" cx="100" cy="100" r="28" />
      </svg>
      <div className="community-mini-farm__center">
        {centerStyle?.type === 'image' && centerStyle?.imageUrl ? (
          <img src={centerStyle.imageUrl} alt="Centre de ferme" loading="lazy" />
        ) : (
          <span>{centerStyle?.emoji || 'H'}</span>
        )}
      </div>
    </div>
  );
};

function CommunityPage() {
  const navigate = useNavigate();
  const [searchInput, setSearchInput] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [page, setPage] = useState(0);
  const [showActiveOnly, setShowActiveOnly] = useState(false);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setPage(0);
      setSearchTerm(searchInput.trim());
    }, SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timeoutId);
  }, [searchInput]);

  const activeUsersQuery = useQuery({
    queryKey: ['community', 'active-users-month'],
    queryFn: fetchActiveUserIdsThisMonth,
    staleTime: 10 * 60 * 1000,
    gcTime: 20 * 60 * 1000,
    refetchOnWindowFocus: false,
    retry: 1,
  });

  const statsQuery = useQuery({
    queryKey: ['community', 'stats'],
    queryFn: fetchCommunityStats,
    staleTime: 10 * 60 * 1000,
    gcTime: 20 * 60 * 1000,
    refetchOnWindowFocus: false,
    retry: 1,
  });

  const activeUserIds = activeUsersQuery.data?.activeUserIds || [];

  const communityQuery = useQuery({
    queryKey: ['community', 'farms', page, searchTerm, activeUsersQuery.data?.monthStartIso || 'month'],
    queryFn: () => fetchCommunityPage({ page, searchTerm, activeUserIds }),
    enabled: !activeUsersQuery.isLoading,
    staleTime: 90 * 1000,
    gcTime: 5 * 60 * 1000,
    keepPreviousData: true,
    refetchOnWindowFocus: false,
    retry: 1,
  });

  const items = communityQuery.data?.items || [];
  const userItems = communityQuery.data?.userItems || [];
  const hasNextPage = Boolean(communityQuery.data?.hasNextPage);
  const totalVisibleFarms = statsQuery.data?.totalVisibleFarms || 0;
  const totalUsers = statsQuery.data?.totalUsers || 0;

  const visibleItems = useMemo(
    () => (showActiveOnly ? items.filter((item) => item.isActive) : items),
    [items, showActiveOnly],
  );

  const handleUserClick = (userId, username) => {
    const path = buildCommunityProfilePath(username, userId);
    if (!path) {
      dispatchToast(`Le profil de ${username} est indisponible.`, 'warning');
      return;
    }
    navigate(path);
  };

  return (
    <main className="community-page">
      <section className="community-shell">
        <header className="community-hero" style={{ '--community-hero-image': `url(${miloFriends})` }}>
          <div className="community-hero__copy">
            <p className="community-hero__eyebrow">Communauté</p>
            <h1>Fermes publiques</h1>
            <p>
              Explore les fermes de la communauté, retrouve les membres actifs du mois
              et visite leur ferme en un clic.
            </p>
            <div className="community-hero__kpis">
              <article className="community-kpi">
                <p className="community-kpi__label">Fermes affichées</p>
                <p className="community-kpi__value"><Users size={14} /> {visibleItems.length}</p>
                <p className="community-kpi__meta">{totalVisibleFarms} fermes · {totalUsers} inscrits</p>
              </article>
            </div>
            <div className="community-hero__tools">
              <label className="community-search" htmlFor="community-search-input">
                <Search size={16} />
                <input
                  id="community-search-input"
                  type="search"
                  placeholder="Rechercher un utilisateur ou une ferme"
                  value={searchInput}
                  onChange={(event) => setSearchInput(event.target.value)}
                  autoComplete="off"
                />
              </label>

              <button
                type="button"
                className={`community-active-toggle ${showActiveOnly ? 'is-on' : ''}`}
                onClick={() => setShowActiveOnly((current) => !current)}
                aria-pressed={showActiveOnly}
              >
                <span className="community-active-toggle__dot" />
                <span>{showActiveOnly ? 'Actifs uniquement' : 'Tous les profils'}</span>
              </button>
            </div>
          </div>
        </header>

        {communityQuery.isLoading ? (
          <p className="community-state">Chargement de la communauté...</p>
        ) : communityQuery.isError ? (
          <p className="community-state is-error">Impossible de charger la communauté pour le moment.</p>
        ) : !visibleItems.length ? (
          <p className="community-state">Aucune ferme publique ne correspond à ta recherche.</p>
        ) : (
          <>
            {userItems.length ? (
              <section className="community-profiles-strip" aria-label="Profils sans ferme publique">
                <p className="community-profiles-strip__title">Profils trouvés (sans ferme publique)</p>
                <div className="community-profiles-strip__list">
                  {userItems.map((userItem) => (
                    <button
                      key={userItem.id}
                      type="button"
                      className="community-profile-chip"
                      onClick={() => handleUserClick(userItem.id, userItem.username)}
                      title={userItem.username}
                    >
                      <span className="community-profile-chip__avatar" aria-hidden="true">
                        <AvatarMedia avatarUrl={userItem.avatarUrl} username={userItem.username} alt="Avatar profil" />
                      </span>
                      <span className="community-profile-chip__name">{userItem.username}</span>
                      <ChevronRight size={14} />
                    </button>
                  ))}
                </div>
              </section>
            ) : null}

            <section className="community-grid" aria-live="polite">
              {visibleItems.map((item) => (
                <article key={item.farmId} className="community-card">
                <div className="community-card__head">
                  <button
                    type="button"
                    className="community-user-hit"
                    onClick={() => handleUserClick(item.ownerId, item.username)}
                    title={item.username}
                  >
                    <div className="community-avatar" aria-hidden="true">
                      <AvatarMedia avatarUrl={item.avatarUrl} username={item.username} alt="Avatar utilisateur" />
                    </div>
                    <div className="community-card__identity">
                      <p className="community-card__username">{item.username}</p>
                      <p className="community-card__farmname">Mère</p>
                    </div>
                    <ChevronRight size={14} className="community-hit__arrow" />
                  </button>
                  {item.isActive ? <span className="community-status">Actif</span> : null}
                </div>

                <button
                  type="button"
                  className="community-farm-hit"
                  onClick={() => navigate(`/farm/${item.farmId}`)}
                  title={`Ouvrir la ferme ${item.farmName}`}
                >
                  <div className="community-farm-hit__title-row">
                    <div>
                      <p className="community-farm-hit__name">{item.farmName}</p>
                      <p className="community-farm-hit__meta">
                        {item.farmState || 'État libre'} · créée le {formatDate(item.creationDate)}
                      </p>
                    </div>
                    <ChevronRight size={15} className="community-hit__arrow" />
                  </div>
                  <MiniFarmPreview
                    siteColors={item.siteColors}
                    centerStyle={item.centerStyle}
                    label={item.farmName}
                  />
                </button>
                </article>
              ))}
            </section>
          </>
        )}

        {!communityQuery.isLoading && !communityQuery.isError ? (
          <footer className="community-pagination">
            <button
              type="button"
              onClick={() => setPage((current) => Math.max(0, current - 1))}
              disabled={page === 0 || communityQuery.isFetching}
            >
              Precedent
            </button>
            <span>Page {page + 1}</span>
            <button
              type="button"
              onClick={() => setPage((current) => current + 1)}
              disabled={!hasNextPage || communityQuery.isFetching}
            >
              Suivant
            </button>
          </footer>
        ) : null}
      </section>
    </main>
  );
}

export default CommunityPage;
