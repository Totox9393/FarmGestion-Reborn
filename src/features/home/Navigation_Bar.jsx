import { useEffect, useState, useMemo } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../authentification/AuthContext';
import { supabase } from '../authentification/supabaseClient';
import { PlusCircle, ClipboardList, ListChecks, Factory, CalendarDays, Home as HomeIcon, HelpCircle } from 'lucide-react';
import { Popover, Transition } from '@headlessui/react';
import { Fragment } from 'react';
import logoMilo from '../../assets/logo_ico.png';
import SettingsModal from '../settings/SettingsModal';
import './Navigation_Bar.css';

function Navigation_Bar() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [profile, setProfile] = useState(null);
  const [farm, setFarm] = useState(null);
  const [openMenu, setOpenMenu] = useState(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

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

  const formattedMoney = useMemo(() => {
    const value = Number(profile?.money ?? 0);
    return new Intl.NumberFormat('fr-FR', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(value);
  }, [profile?.money]);

  const handleDropdownLeave = (event) => {
    // Ne pas fermer si on reste dans l'élément ou ses descendants (dropdown inclus)
    if (event.currentTarget.contains(event.relatedTarget)) {
      return;
    }
    setOpenMenu(null);
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
                <Popover.Button className={`nav-link ${location.pathname === '/betail-maker' ? 'active' : ''}`}>
                  Bétails
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
                    <button className="nav-dropdown-item" onClick={() => go('/betail-maker')}><PlusCircle size={16} /> Créer un bétail</button>
                    <button className="nav-dropdown-item" onClick={() => go('/betail-register')}><ClipboardList size={16} /> Registre du bétail</button>
                    <button className="nav-dropdown-item" onClick={() => go('/mes-betails')}><ListChecks size={16} /> Mes bétails</button>
                  </Popover.Panel>
                </Transition>
              </>
            )}
          </Popover>

          <Popover className="nav-item nav-dropdown-trigger">
            {({ open }) => (
              <>
                <Popover.Button className="nav-link">
                  Fermes
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
                    <button className="nav-dropdown-item" onClick={() => go('/farms-actives')}><Factory size={16} /> Fermes actives</button>
                    <button className="nav-dropdown-item" onClick={() => go('/gce')}><CalendarDays size={16} /> GCE</button>
                    <button className="nav-dropdown-item" onClick={goMyFarm}>
                      <HomeIcon size={16} /> Ma ferme {farm?.name ? `- ${farm.name}` : '- Non renseignée'}
                    </button>
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
            onClick={() => setIsSettingsOpen(true)}
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
          <button
            type="button"
            className="nav-link nav-logout"
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

