import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Search, ChevronRight } from 'lucide-react';
import miloFriends from '../../assets/img/milo_friends_happy2nb.png';
import { useAuth } from '../authentification/AuthContext';
import { createHexagonPoints, createTrianglePoints } from '../utils/FarmDesign/farmDesignUtils';
import ProfileAvatarImage from '../utils/ProfileAvatarImage';
import { fetchActiveUserIdsThisMonth, fetchCommunityPage, fetchCommunityStats } from './communityApi';
import { fetchAcceptedFriendIdsForUser } from './friendsApi';
import PublicCommunityChat from '../chat/PublicCommunityChat';
import useStreamAvatarUrls from '../chat/useStreamAvatarUrls';
import './CommunityPage.css';

const SEARCH_DEBOUNCE_MS = 320;
const COMMUNITY_DID_YOU_KNOW = [
  'Vous pouvez changer le thème d\'affichage de FarmGestion depuis les paramètres de votre compte.',
  'Le filtre Actifs met en avant les joueurs vus ce mois-ci.',
  'Chaque ferme publique est visible et accessible à tous.',
  'Vous pouvez passer de Tous les profils à Amis uniquement en un clic.',
  'Le registre vous permet de retrouver rapidement un bétail par matricule.',
  'Pour passer votre ferme publique en privée, allez dans les paramètres de votre compte.',
  'Lorsque vous créez un bétail, plus il y a de détails, plus il vous rapportera de 💸',
  'Un utilisateur que vous avez bloqué ne pourra plus voir votre profil ni interagir avec vous sur FarmGestion.',
];

const PROFILE_FILTERS = [
  { id: 'all', label: 'Tous les profils' },
  { id: 'active', label: 'Actifs ce mois-ci' },
  { id: 'friends', label: 'Mes amis' },
];

const pluralize = (count, singular, plural) => (count > 1 ? plural : singular);

const isRetriableError = (error) => {
  const status = Number(error?.status || 0);
  return status >= 500;
};

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

const buildCommunityProfilePath = (username) => {
  const normalizedUsername = String(username || '').trim();
  if (normalizedUsername) return `/community/profile/${encodeURIComponent(normalizedUsername)}`;
  return '';
};

function CommunityLoadingSkeleton({ didYouKnow }) {
  return (
    <section className="community-results" aria-live="polite" aria-busy="true">
      <p className="community-loading__tip">
        <strong>Le saviez-vous ?</strong> {didYouKnow}
      </p>
      <div className="community-grid" aria-hidden="true">
        {Array.from({ length: 6 }).map((_, index) => (
          <div key={`community-loading-card-${index}`} className="community-card">
            <div className="community-card__head community-card__head--skeleton">
              <span className="community-avatar community-skeleton" />
              <span className="community-loading__line community-skeleton" style={{ width: '45%' }} />
            </div>
            <div className="community-farm-hit">
              <span className="community-loading__line community-skeleton" style={{ width: '60%' }} />
              <span className="community-loading__line community-skeleton" style={{ width: '40%' }} />
              <span className="community-mini-farm community-skeleton" />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

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
  const { user } = useAuth();
  const navigate = useNavigate();
  const [searchInput, setSearchInput] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [page, setPage] = useState(0);
  const [profileFilterMode, setProfileFilterMode] = useState('all');
  const didYouKnowFact = useMemo(
    () => COMMUNITY_DID_YOU_KNOW[Math.floor(Math.random() * COMMUNITY_DID_YOU_KNOW.length)] || COMMUNITY_DID_YOU_KNOW[0],
    [],
  );

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
    staleTime: 20 * 60 * 1000,
    gcTime: 40 * 60 * 1000,
    refetchOnWindowFocus: false,
    retry: (failureCount, error) => failureCount < 2 && isRetriableError(error),
    retryDelay: (attemptIndex) => Math.min(1500 * (2 ** attemptIndex), 7000),
  });

  const statsQuery = useQuery({
    queryKey: ['community', 'stats'],
    queryFn: fetchCommunityStats,
    staleTime: 20 * 60 * 1000,
    gcTime: 40 * 60 * 1000,
    refetchOnWindowFocus: false,
    retry: (failureCount, error) => failureCount < 2 && isRetriableError(error),
    retryDelay: (attemptIndex) => Math.min(1500 * (2 ** attemptIndex), 7000),
  });

  const activeUserIds = activeUsersQuery.data?.activeUserIds || [];

  const communityQuery = useQuery({
    queryKey: ['community', 'farms', page, searchTerm, activeUsersQuery.data?.monthStartIso || 'month'],
    queryFn: () => fetchCommunityPage({ page, searchTerm, activeUserIds }),
    enabled: !activeUsersQuery.isLoading,
    staleTime: 2 * 60 * 1000,
    gcTime: 12 * 60 * 1000,
    keepPreviousData: true,
    refetchOnWindowFocus: false,
    retry: (failureCount, error) => failureCount < 2 && isRetriableError(error),
    retryDelay: (attemptIndex) => Math.min(1500 * (2 ** attemptIndex), 7000),
  });

  const friendsFilterQuery = useQuery({
    queryKey: ['community', 'friends-filter', user?.id || 'anon'],
    enabled: Boolean(user?.id),
    queryFn: () => fetchAcceptedFriendIdsForUser(user.id),
    staleTime: 5 * 60 * 1000,
    gcTime: 20 * 60 * 1000,
    refetchOnWindowFocus: false,
    retry: (failureCount, error) => failureCount < 2 && isRetriableError(error),
    retryDelay: (attemptIndex) => Math.min(1200 * (2 ** attemptIndex), 6000),
  });

  const items = useMemo(() => communityQuery.data?.items || [], [communityQuery.data?.items]);
  const userItems = useMemo(() => communityQuery.data?.userItems || [], [communityQuery.data?.userItems]);
  const communityUserIds = useMemo(
    () => [
      ...items.map((item) => item.ownerId),
      ...userItems.map((item) => item.id),
    ],
    [items, userItems],
  );
  const streamAvatarUrlsById = useStreamAvatarUrls(communityUserIds);
  const hasNextPage = Boolean(communityQuery.data?.hasNextPage);
  const totalVisibleFarms = statsQuery.data?.totalVisibleFarms || 0;
  const totalUsers = statsQuery.data?.totalUsers || 0;
  const publicChatAvatarProfiles = useMemo(() => {
    const profilesById = new Map();
    items.forEach((item) => {
      if (!item.ownerId) return;
      profilesById.set(item.ownerId, {
        id: item.ownerId,
        username: item.username,
        avatarUrl: item.avatarUrl,
      });
    });
    userItems.forEach((item) => {
      if (!item.id) return;
      profilesById.set(item.id, {
        id: item.id,
        username: item.username,
        avatarUrl: item.avatarUrl,
      });
    });
    return Array.from(profilesById.values());
  }, [items, userItems]);

  const friendIdSet = useMemo(
    () => new Set((friendsFilterQuery.data || []).filter(Boolean)),
    [friendsFilterQuery.data],
  );

  const visibleItems = useMemo(
    () => {
      if (profileFilterMode === 'active') return items.filter((item) => item.isActive);
      if (profileFilterMode === 'friends') return items.filter((item) => friendIdSet.has(item.ownerId));
      return items;
    },
    [friendIdSet, items, profileFilterMode],
  );

  const visibleUserItems = useMemo(
    () => {
      if (profileFilterMode === 'friends') return userItems.filter((item) => friendIdSet.has(item.id));
      return userItems;
    },
    [friendIdSet, profileFilterMode, userItems],
  );

  const isFriendsFilterLoading = profileFilterMode === 'friends' && Boolean(user?.id) && friendsFilterQuery.isLoading;
  const showLoadingSkeleton = (
    (!communityQuery.data && (
      activeUsersQuery.isLoading
      || statsQuery.isLoading
      || communityQuery.isLoading
      || communityQuery.isFetching
    ))
    || isFriendsFilterLoading
  );

  const handleUserClick = (username) => {
    const path = buildCommunityProfilePath(username);
    if (!path) {
      dispatchToast(`Le profil de ${username} est indisponible.`, 'warning');
      return;
    }
    navigate(path);
  };

  return (
    <main className="community-page">
      <section className="community-shell">
        <div className="community-panel">
          <header className="community-panel__intro" style={{ '--community-logo': `url(${miloFriends})` }}>
            <h1 className="community-panel__title">Fermes publiques</h1>
            <p className="community-panel__text">
              Explore les fermes de la communauté, retrouve les membres actifs du mois
              et visite leur ferme en un clic.
            </p>
            <p className="community-panel__count">
              <strong>{visibleItems.length}</strong> {pluralize(visibleItems.length, 'ferme affichée', 'fermes affichées')}
              <span>
                {totalVisibleFarms} {pluralize(totalVisibleFarms, 'ferme publique', 'fermes publiques')}, {totalUsers} {pluralize(totalUsers, 'inscrit', 'inscrits')}
              </span>
            </p>

            <label className="community-search" htmlFor="community-search-input">
              <Search size={16} aria-hidden="true" />
              <input
                id="community-search-input"
                type="search"
                placeholder="Rechercher un utilisateur ou une ferme"
                value={searchInput}
                onChange={(event) => setSearchInput(event.target.value)}
                autoComplete="off"
              />
            </label>

            <div className="community-filters" role="group" aria-label="Filtrer les profils">
              {PROFILE_FILTERS.map((filter) => (
                <button
                  key={filter.id}
                  type="button"
                  className="community-filters__tab"
                  aria-pressed={profileFilterMode === filter.id}
                  onClick={() => setProfileFilterMode(filter.id)}
                >
                  {filter.label}
                </button>
              ))}
            </div>
          </header>

          <PublicCommunityChat avatarProfiles={publicChatAvatarProfiles} />
        </div>

        {showLoadingSkeleton ? (
          <CommunityLoadingSkeleton didYouKnow={didYouKnowFact} />
        ) : communityQuery.isError ? (
          <p className="community-state is-error">Impossible de charger la communauté pour le moment.</p>
        ) : !visibleItems.length && !visibleUserItems.length ? (
          <p className="community-state">
            {searchTerm || profileFilterMode !== 'all'
              ? 'Aucune ferme ne correspond à ta recherche ou à ce filtre.'
              : 'Aucune ferme publique pour le moment.'}
          </p>
        ) : (
          <section className="community-results" aria-live="polite">
            {visibleUserItems.length ? (
              <div className="community-profiles" aria-label="Profils sans ferme publique">
                <p className="community-profiles__title">Profils trouvés sans ferme publique</p>
                <div className="community-profiles__list">
                  {visibleUserItems.map((userItem) => (
                    <button
                      key={userItem.id}
                      type="button"
                      className="community-profile-link"
                      onClick={() => handleUserClick(userItem.username)}
                      title={userItem.username}
                    >
                      <span className="community-avatar community-avatar--small" aria-hidden="true">
                        <ProfileAvatarImage
                          avatarUrl={streamAvatarUrlsById[userItem.id] || userItem.avatarUrl}
                          alt="Avatar profil"
                          loading="lazy"
                        />
                      </span>
                      <span className="community-profile-link__name">{userItem.username}</span>
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            {visibleItems.length ? (
              <div className="community-grid">
                {visibleItems.map((item) => (
                  <article key={item.farmId} className="community-card">
                    <div className="community-card__head">
                      <button
                        type="button"
                        className="community-user-hit"
                        onClick={() => handleUserClick(item.username)}
                        title={item.username}
                      >
                        <span className="community-avatar" aria-hidden="true">
                          <ProfileAvatarImage
                            avatarUrl={streamAvatarUrlsById[item.ownerId] || item.avatarUrl}
                            alt="Avatar utilisateur"
                            loading="lazy"
                          />
                        </span>
                        <span className="community-card__identity">
                          <span className="community-card__username">{item.username}</span>
                          <span className="community-card__farmname">
                            Accéder au profil <ChevronRight size={12} aria-hidden="true" />
                          </span>
                        </span>
                      </button>
                      {item.isActive ? <span className="community-status">Actif</span> : null}
                    </div>

                    <button
                      type="button"
                      className="community-farm-hit"
                      onClick={() => navigate(`/farm/${item.farmId}`)}
                      title={`Ouvrir la ferme ${item.farmName}`}
                    >
                      <span className="community-farm-hit__title-row">
                        <span className="community-farm-hit__text">
                          <span className="community-farm-hit__label">Ferme publique</span>
                          <span className="community-farm-hit__name">{item.farmName}</span>
                          <span className="community-farm-hit__meta">Créée le {formatDate(item.creationDate)}</span>
                        </span>
                        <span className="community-hit__cta">
                          Voir ferme <ChevronRight size={15} aria-hidden="true" />
                        </span>
                      </span>
                      <MiniFarmPreview
                        siteColors={item.siteColors}
                        centerStyle={item.centerStyle}
                        label={item.farmName}
                      />
                    </button>
                  </article>
                ))}
              </div>
            ) : null}
          </section>
        )}

        {!communityQuery.isLoading && !communityQuery.isError ? (
          <footer className="community-pagination">
            <button
              type="button"
              onClick={() => setPage((current) => Math.max(0, current - 1))}
              disabled={page === 0 || communityQuery.isFetching}
            >
              Précédent
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
