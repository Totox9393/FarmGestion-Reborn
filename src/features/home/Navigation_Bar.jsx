import { useEffect, useState, useMemo } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../authentification/AuthContext';
import { supabase } from '../authentification/supabaseClient';
import { PlusCircle, ClipboardList, ListChecks, Factory, CalendarDays, Home as HomeIcon, HelpCircle, UserPlus, Settings, UserCheck, UserX, Send, ChevronDown, ShoppingCart, Baby, BabyIcon, Hexagon, UserRoundSearchIcon } from 'lucide-react';
import { Popover, Transition } from '@headlessui/react';
import { Fragment } from 'react';
import logoMilo from '../../assets/logo_ico.png';
import defaultProfileUser from '../../assets/defaut_profile_user.png';
import SettingsModal from '../settings/SettingsModal';
import {
  acceptFriendRequestById,
  declineFriendRequestById,
  fetchPendingFriendRequestsReceived,
  fetchPendingFriendRequestsSent,
} from '../community/friendsApi';
import './Navigation_Bar.css';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || '';
const NAV_MENU_HINT_STORAGE_KEY = 'farmgestion_nav_menu_hint_seen_v1';

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
    candidates.push(`${SUPABASE_URL}/${raw.replace(/^\/+/, '')}`);
  } else if (raw.includes('/')) {
    candidates.push(`${SUPABASE_URL}/storage/v1/object/public/${raw}`);
  } else {
    candidates.push(`${SUPABASE_URL}/storage/v1/object/public/avatars/${raw}`);
    candidates.push(`${SUPABASE_URL}/storage/v1/object/public/ressources/${raw}`);
    candidates.push(`${SUPABASE_URL}/storage/v1/object/public/betails/${raw}`);
  }

  return Array.from(new Set(candidates));
};

function RequestAvatarMedia({ avatarUrl, alt }) {
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

const dispatchToast = (message, type = 'info') => {
  window.dispatchEvent(new CustomEvent('farmgestion-toast', { detail: { type, message } }));
};

const formatRequestDate = (iso) => {
  if (!iso) return 'Date inconnue';
  const value = new Date(iso);
  if (Number.isNaN(value.getTime())) return 'Date inconnue';
  return new Intl.DateTimeFormat('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(value);
};

const formatPendingBadgeValue = (count) => {
  const safeCount = Number.isFinite(Number(count)) ? Math.max(0, Math.floor(Number(count))) : 0;
  if (safeCount > 99) return '99+';
  return String(safeCount);
};

function Navigation_Bar() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [profile, setProfile] = useState(null);
  const [farm, setFarm] = useState(null);
  const [openMenu, setOpenMenu] = useState(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [friendsTab, setFriendsTab] = useState('received');
  const [receivedRequests, setReceivedRequests] = useState([]);
  const [sentRequests, setSentRequests] = useState([]);
  const [isRequestsLoading, setIsRequestsLoading] = useState(false);
  const [activeRequestId, setActiveRequestId] = useState(null);
  const [showMenuHint, setShowMenuHint] = useState(false);

  useEffect(() => {
    try {
      if (!window.localStorage.getItem(NAV_MENU_HINT_STORAGE_KEY)) {
        setShowMenuHint(true);
      }
    } catch {
      setShowMenuHint(true);
    }
  }, []);

  useEffect(() => {
    let isMounted = true;
    const fetchProfile = async () => {
      if (!user) return;
      const { data } = await supabase
        .from('users_profiles')
        .select('username, avatar_url, farm_id, money, role, role_ingame')
        .eq('id', user.id)
        .maybeSingle();
      if (isMounted) {
        setProfile(data || null);
      }
      if (data?.farm_id) {
        const { data: farmData } = await supabase
          .from('farms_list')
          .select('name')
          .eq('id', data.farm_id)
          .maybeSingle();
        if (isMounted) {
          setFarm(farmData || null);
        }
      } else if (isMounted) {
        setFarm(null);
      }
    };
    fetchProfile();
    return () => {
      isMounted = false;
    };
  }, [user]);

  useEffect(() => {
    const handleBalanceUpdate = (event) => {
      const updatedUserId = event?.detail?.userId;
      const updatedMoney = Number(event?.detail?.money);

      if (!user?.id || updatedUserId !== user.id || !Number.isFinite(updatedMoney)) {
        return;
      }

      setProfile((prev) => ({
        ...(prev || {}),
        money: updatedMoney,
      }));
    };

    window.addEventListener('farmgestion-balance-updated', handleBalanceUpdate);
    return () => window.removeEventListener('farmgestion-balance-updated', handleBalanceUpdate);
  }, [user?.id]);

  useEffect(() => {
    let isMounted = true;
    if (!user?.id) {
      setReceivedRequests([]);
      setSentRequests([]);
      return () => {
        isMounted = false;
      };
    }

    const fetchRequests = async ({ silent = false } = {}) => {
      if (!silent && isMounted) {
        setIsRequestsLoading(true);
      }

      try {
        const [receivedRows, sentRows] = await Promise.all([
          fetchPendingFriendRequestsReceived(user.id),
          fetchPendingFriendRequestsSent(user.id),
        ]);

        if (!isMounted) return;
        setReceivedRequests(receivedRows || []);
        setSentRequests(sentRows || []);
      } catch {
        if (!silent) {
          dispatchToast('Impossible de charger les demandes d\'amis.', 'error');
        }
      } finally {
        if (isMounted) {
          setIsRequestsLoading(false);
        }
      }
    };

    fetchRequests();

    const intervalId = window.setInterval(() => {
      fetchRequests({ silent: true });
    }, 8000);

    const handleFriendSync = () => {
      fetchRequests({ silent: true });
    };

    window.addEventListener('farmgestion-friends-updated', handleFriendSync);

    return () => {
      isMounted = false;
      window.clearInterval(intervalId);
      window.removeEventListener('farmgestion-friends-updated', handleFriendSync);
    };
  }, [user?.id]);

  // Ferme les menus quand on change de page
  useEffect(() => {
    setIsMenuOpen(false);
    setOpenMenu(null);
  }, [location.pathname]);

  // Ferme le hamburger si on repasse en desktop
  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth > 900 && isMenuOpen) {
        setIsMenuOpen(false);
        setOpenMenu(null);
      }
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [isMenuOpen]);

  // Ne rien afficher si pas connecté
  if (!user) return null;

  const go = (path) => {
    setIsMenuOpen(false);
    navigate(path);
  };

  const goMyFarm = () => {
    const farmId = profile?.farm_id;
    if (!farmId) {
      window.dispatchEvent(
        new CustomEvent('farmgestion-toast', {
          detail: { type: 'error', message: 'Aucune ferme liée à ton profil.' },
        })
      );
      go('/home');
      return;
    }
    go(`/farm/${farmId}`);
  };

  const goMyProfile = () => {
    const username = String(profile?.username || '').trim();
    if (!username) {
      go('/community');
      return;
    }
    go(`/community/profile/${encodeURIComponent(username)}`);
  };

  const formattedMoney = useMemo(() => {
    const value = Number(profile?.money ?? 0);
    return new Intl.NumberFormat('fr-FR', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(value);
  }, [profile?.money]);

  const pendingCount = receivedRequests.length;
  const pendingBadgeValue = formatPendingBadgeValue(pendingCount);

  const openRequestProfile = (username) => {
    const safe = String(username || '').trim();
    if (!safe) return;
    go(`/community/profile/${encodeURIComponent(safe)}`);
  };

  const refreshRequests = async () => {
    if (!user?.id) return;
    try {
      const [receivedRows, sentRows] = await Promise.all([
        fetchPendingFriendRequestsReceived(user.id),
        fetchPendingFriendRequestsSent(user.id),
      ]);
      setReceivedRequests(receivedRows || []);
      setSentRequests(sentRows || []);
      window.dispatchEvent(new CustomEvent('farmgestion-friends-updated'));
    } catch {
      dispatchToast('Impossible d\'actualiser les demandes d\'amis.', 'error');
    }
  };

  const handleAcceptRequest = async (relationId) => {
    const id = Number(relationId);
    if (!Number.isFinite(id)) return;
    setActiveRequestId(id);
    try {
      await acceptFriendRequestById(id);
      dispatchToast('Demande d\'ami acceptée.', 'success');
      await refreshRequests();
    } catch {
      dispatchToast('Impossible d\'accepter la demande.', 'error');
    } finally {
      setActiveRequestId(null);
    }
  };

  const handleDeclineRequest = async (relationId) => {
    const id = Number(relationId);
    if (!Number.isFinite(id)) return;
    setActiveRequestId(id);
    try {
      await declineFriendRequestById(id);
      dispatchToast('Demande d\'ami refusée.', 'info');
      await refreshRequests();
    } catch {
      dispatchToast('Impossible de refuser la demande.', 'error');
    } finally {
      setActiveRequestId(null);
    }
  };

  const handleDropdownLeave = (event) => {
    // Ne pas fermer si on reste dans l'élément ou ses descendants (dropdown inclus)
    if (event.currentTarget.contains(event.relatedTarget)) {
      return;
    }
    setOpenMenu(null);
  };

  const dismissMenuHint = () => {
    setShowMenuHint(false);
    try {
      window.localStorage.setItem(NAV_MENU_HINT_STORAGE_KEY, '1');
    } catch {
      // Ignore storage errors and keep graceful behavior.
    }
  };

  return (
    <>
      <header className="nav-shell">
        <div className="nav-inner">
        <div className="nav-logo" role="button" tabIndex={0} onClick={() => go('/home')} onKeyDown={(e) => e.key === 'Enter' && go('/home')}>
          <div className="nav-logo__mark">
            <img src={logoMilo} alt="FarmGestion" />
          </div>
          <div className="nav-logo__text">FarmGestion</div>
        </div>

        <Popover as="nav" className={`nav-links ${isMenuOpen ? 'is-open' : ''}`}>
          <div className="nav-item">
            <button className={`nav-link ${location.pathname === '/home' ? 'active' : ''}`} onClick={() => go('/home')}>
              <HomeIcon size={16} /> Accueil
            </button>
          </div>

          <Popover className="nav-item nav-dropdown-trigger">
            {({ open }) => (
              <>
                <Popover.Button
                  className={`nav-link nav-link--dropdown ${location.pathname === '/betail-maker' ? 'active' : ''}`}
                  onClick={dismissMenuHint}
                >
                  <span>Bétails</span>
                  <span className="nav-link-dropdown-hint" aria-hidden="true">
                    <ChevronDown size={14} />
                  </span>
                </Popover.Button>
                {showMenuHint ? (
                  <button
                    type="button"
                    className="nav-menu-first-tip"
                    onClick={dismissMenuHint}
                    aria-label="Fermer l'aide des menus"
                  >
                    Clique ici pour voir plus d'actions.
                  </button>
                ) : null}
                <Transition
                  as={Fragment}
                  enter="nav-enter"
                  enterFrom="nav-enter-from"
                  enterTo="nav-enter-to"
                  leave="nav-leave"
                  leaveFrom="nav-leave-from"
                  leaveTo="nav-leave-to"
                >
                  <Popover.Panel className={`nav-dropdown ${open ? 'is-open' : ''}`} static>
                    <button className="nav-dropdown-item" onClick={() => go('/betail-maker')}><BabyIcon size={16} /> Créer un bétail</button>
                    <button className="nav-dropdown-item" onClick={() => go('/betail-register')}><ShoppingCart size={16} /> Registre du bétail</button>
                    <button className="nav-dropdown-item" onClick={() => go('/mes-betails')}><ListChecks size={16} /> Mes bétails</button>
                  </Popover.Panel>
                </Transition>
              </>
            )}
          </Popover>

          <Popover className="nav-item nav-dropdown-trigger">
            {({ open }) => (
              <>
                <Popover.Button className="nav-link nav-link--dropdown" onClick={dismissMenuHint}>
                  <span>Fermes</span>
                  <span className="nav-link-dropdown-hint" aria-hidden="true">
                    <ChevronDown size={14} />
                  </span>
                </Popover.Button>
                <Transition
                  as={Fragment}
                  enter="nav-enter"
                  enterFrom="nav-enter-from"
                  enterTo="nav-enter-to"
                  leave="nav-leave"
                  leaveFrom="nav-leave-from"
                  leaveTo="nav-leave-to"
                >
                  <Popover.Panel className={`nav-dropdown ${open ? 'is-open' : ''}`} static>
                    <button className="nav-dropdown-item" onClick={goMyFarm}>
                      <Hexagon size={16} /> Ma ferme {farm?.name ? `- ${farm.name}` : '- Non renseignée'}
                    </button>
                    <button className="nav-dropdown-item" onClick={() => go('/community')}><UserRoundSearchIcon size={16} /> Communauté</button>
                    <button className="nav-dropdown-item" onClick={() => go('/gce')}><CalendarDays size={16} /> GCE</button>
                  </Popover.Panel>
                </Transition>
              </>
            )}
          </Popover>

          <div className="nav-item">
            <button className="nav-link" onClick={() => go('/faq')}>
              <HelpCircle size={16} /> FAQ / Tutoriel
            </button>
          </div>

          <div className="nav-item nav-item-logout">
            <button
              type="button"
              className="nav-link nav-logout nav-logout--mobile"
              onClick={async () => {
                await supabase.auth.signOut();
                navigate('/');
              }}
            >
              Déconnexion
            </button>
          </div>
        </Popover>

        <div className="nav-right">
          <button
            className="nav-user"
            type="button"
            title={profile?.username || user.email}
            onClick={goMyProfile}
          >
            <div className="nav-avatar">
              {profile?.avatar_url ? (
                <img src={profile.avatar_url} alt="avatar" />
              ) : (
                <span>{(profile?.username || user.email || 'U')?.[0]?.toUpperCase() || 'U'}</span>
              )}
            </div>
            <div className="nav-identity">
              <p className="nav-username">{profile?.username || 'Profil'}</p>
              <p className="nav-balance" aria-label="Solde disponible">
                💸 {formattedMoney}
              </p>
            </div>
          </button>

          <Popover className="nav-friends-menu">
            {({ open }) => (
              <>
                <Popover.Button
                  type="button"
                  className={`nav-friends-toggle ${open ? 'is-open' : ''}`}
                  aria-label="Ouvrir les demandes d'amis"
                  title="Demandes d'amis"
                >
                  <UserPlus size={17} strokeWidth={2.1} />
                  {pendingCount > 0 ? (
                    <span
                      className="nav-friends-badge"
                      role="status"
                      aria-label={`${pendingCount} demande${pendingCount > 1 ? 's' : ''} d'ami en attente`}
                    >
                      {pendingBadgeValue}
                    </span>
                  ) : null}
                </Popover.Button>

                <Transition
                  as={Fragment}
                  enter="nav-enter"
                  enterFrom="nav-enter-from"
                  enterTo="nav-enter-to"
                  leave="nav-leave"
                  leaveFrom="nav-leave-from"
                  leaveTo="nav-leave-to"
                >
                  <Popover.Panel className="nav-friends-panel" static>
                    <div className="nav-friends-head">
                      <h3>Demandes d'amis</h3>
                    </div>

                    <div className="nav-friends-tabs">
                      <button
                        type="button"
                        className={`nav-friends-tab ${friendsTab === 'received' ? 'is-active' : ''}`}
                        onClick={() => setFriendsTab('received')}
                      >
                        Reçues ({receivedRequests.length})
                      </button>
                      <button
                        type="button"
                        className={`nav-friends-tab ${friendsTab === 'sent' ? 'is-active' : ''}`}
                        onClick={() => setFriendsTab('sent')}
                      >
                        Envoyées ({sentRequests.length})
                      </button>
                    </div>

                    {isRequestsLoading ? (
                      <p className="nav-friends-state">Chargement...</p>
                    ) : friendsTab === 'received' ? (
                      receivedRequests.length ? (
                        <div className="nav-friends-list">
                          {receivedRequests.map((request) => {
                            const isBusy = activeRequestId === request.id;
                            return (
                              <article key={request.id} className="nav-friends-item">
                                <div className="nav-friends-item__main">
                                  <span className="nav-friends-avatar" aria-hidden="true">
                                    <RequestAvatarMedia
                                      avatarUrl={request.peerAvatarUrl}
                                      alt={`Avatar de ${request.peerUsername}`}
                                    />
                                  </span>
                                  <button
                                    type="button"
                                    className="nav-friends-identity"
                                    onClick={() => openRequestProfile(request.peerUsername)}
                                    title={`Voir le profil de ${request.peerUsername}`}
                                  >
                                    <span className="nav-friends-user">{request.peerUsername}</span>
                                    <span className="nav-friends-date">Reçue le : {formatRequestDate(request.createdAt)}</span>
                                  </button>
                                </div>

                                <div className="nav-friends-actions">
                                  <button
                                    type="button"
                                    className="nav-friends-action nav-friends-action--accept"
                                    disabled={isBusy}
                                    onClick={() => handleAcceptRequest(request.id)}
                                  >
                                    <UserCheck size={14} /> Accepter
                                  </button>
                                  <button
                                    type="button"
                                    className="nav-friends-action nav-friends-action--reject"
                                    disabled={isBusy}
                                    onClick={() => handleDeclineRequest(request.id)}
                                  >
                                    <UserX size={14} /> Refuser
                                  </button>
                                </div>
                              </article>
                            );
                          })}
                        </div>
                      ) : (
                        <p className="nav-friends-state">Aucune demande reçue en attente.</p>
                      )
                    ) : sentRequests.length ? (
                      <div className="nav-friends-list">
                        {sentRequests.map((request) => (
                          <article key={request.id} className="nav-friends-item nav-friends-item--sent">
                            <div className="nav-friends-item__main">
                              <span className="nav-friends-avatar" aria-hidden="true">
                                <RequestAvatarMedia
                                  avatarUrl={request.peerAvatarUrl}
                                  alt={`Avatar de ${request.peerUsername}`}
                                />
                              </span>
                              <button
                                type="button"
                                className="nav-friends-identity"
                                onClick={() => openRequestProfile(request.peerUsername)}
                                title={`Voir le profil de ${request.peerUsername}`}
                              >
                                <span className="nav-friends-user">{request.peerUsername}</span>
                                <span className="nav-friends-date">Envoyée le {formatRequestDate(request.createdAt)}</span>
                              </button>
                            </div>
                            <span className="nav-friends-pending-tag"><Send size={12} /> En attente</span>
                          </article>
                        ))}
                      </div>
                    ) : (
                      <p className="nav-friends-state">Aucune demande envoyée en attente.</p>
                    )}
                  </Popover.Panel>
                </Transition>
              </>
            )}
          </Popover>

          <button
            type="button"
            className="nav-settings"
            onClick={() => setIsSettingsOpen(true)}
            aria-label="Ouvrir les paramètres"
            title="Paramètres"
          >
            <Settings size={17} strokeWidth={2.1} />
          </button>
          <button
            type="button"
            className="nav-link nav-logout nav-logout--desktop"
            onClick={async () => {
              await supabase.auth.signOut();
              navigate('/');
            }}
          >
            Déconnexion
          </button>
          <button
            type="button"
            className={`nav-burger ${isMenuOpen ? 'is-open' : ''}`}
            aria-label="Menu"
            aria-expanded={isMenuOpen}
            onClick={() => setIsMenuOpen((v) => !v)}
          >
            <span />
            <span />
          </button>
        </div>
      </div>
    </header>
    <SettingsModal
      isOpen={isSettingsOpen}
      onClose={() => setIsSettingsOpen(false)}
      user={user}
      profile={profile}
    />
    </>
  );
}

export default Navigation_Bar;




