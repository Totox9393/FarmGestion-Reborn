import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Moon, Sun } from 'lucide-react';
import { supabase } from '../authentification/supabaseClient';
import Settings_ChangePassword from './Settings_ChangePassword';
import Settings_ChangeEmail from './Settings_ChangeEmail';
import Settings_ChangeAvatar from './Settings_ChangeAvatar';
import Settings_AdminShippingPanel from './Settings_AdminShippingPanel';
import Settings_AdminInvisibleBetailsPanel from './Settings_AdminInvisibleBetailsPanel';
import Settings_ReportsPanel from './Settings_ReportsPanel';
import {
  applyLocalThemePreference,
  getLocalThemePreference,
  normalizeThemeValue,
  saveUserThemePreference,
} from './themePreferences';
import './SettingsModal.css';

const SECTIONS = {
  account: 'Compte',
  preferences: 'Préférences',
  badges: 'Badges',
  import: 'Importer',
  administration: 'Administration',
  expeditions: 'Expéditions',
  invisibleBetails: 'Bétails invisibles',
  reports: 'Signalements',
};

const NEWSLETTER_SETTING_NAME = 'receive_newsletter';
const ALLOW_FRIEND_REQUESTS_SETTING_NAME = 'allow_friend_requests';
const ADMIN_REPORTS_PENDING_COUNT_QUERY_KEY = ['settings', 'admin', 'reports', 'pending-count'];

const parseNewsletterSettingValue = (value) => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'false') return false;
    if (normalized === 'true') return true;
  }
  if (value && typeof value === 'object') {
    if (typeof value.enabled === 'boolean') return value.enabled;
    if (typeof value.value === 'boolean') return value.value;
  }
  return true;
};

const resolveNewsletterEnabled = (row) => {
  if (!row) return true;
  return parseNewsletterSettingValue(row.setting_value);
};

const resolveFriendRequestsEnabled = (row) => {
  if (!row) return true;
  return parseNewsletterSettingValue(row.setting_value);
};

function SettingsModal({ isOpen, onClose, user, profile }) {
  const marketingVersion = import.meta.env.VITE_APP_MARKETING_VERSION || '0.0.0';
  const commitHash = import.meta.env.VITE_APP_COMMIT_HASH || 'dev';
  const versionLabel = `v${marketingVersion} • ${commitHash}`;
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [activeSection, setActiveSection] = useState('account');
  const [theme, setTheme] = useState(() => getLocalThemePreference());
  const [newsletterEnabled, setNewsletterEnabled] = useState(false);
  const [friendRequestsEnabled, setFriendRequestsEnabled] = useState(false);
  const [farmVisible, setFarmVisible] = useState(false);
  const [farmId, setFarmId] = useState(null);
  const [loadingPreferences, setLoadingPreferences] = useState(false);
  const [savingNewsletter, setSavingNewsletter] = useState(false);
  const [savingFriendRequests, setSavingFriendRequests] = useState(false);
  const [savingFarm, setSavingFarm] = useState(false);
  const [copiedId, setCopiedId] = useState(false);
  const isDark = theme === 'dark';
  const themeClass =
    theme === 'dark'
      ? 'is-dark'
      : theme === 'pastel'
        ? 'is-pastel'
        : theme === 'galactic'
          ? 'is-galactic'
          : theme === 'multicolor'
            ? 'is-multicolor'
            : 'is-light';
  const normalizedRoles = String(`${profile?.role || ''} ${profile?.role_ingame || ''}`)
    .trim()
    .toUpperCase();
  const isAdmin = normalizedRoles.includes('ADMIN');
  const isModeration = normalizedRoles.includes('MODERATION');
  const canAccessAdministration = isAdmin || isModeration;

  const pendingReportsCountQuery = useQuery({
    queryKey: ADMIN_REPORTS_PENDING_COUNT_QUERY_KEY,
    queryFn: async () => {
      const { count, error } = await supabase
        .from('betails_reports')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'pending');

      if (error) {
        return 0;
      }

      return Number(count || 0);
    },
    enabled: Boolean(isOpen && canAccessAdministration),
    staleTime: 20_000,
    gcTime: 300_000,
    retry: 1,
    refetchOnWindowFocus: false,
  });

  const pendingReportsCount = pendingReportsCountQuery.data ?? 0;
  const pendingReportsBadgeCount = pendingReportsCount > 9999 ? '9999+' : String(pendingReportsCount);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        onClose?.();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  useEffect(() => {
    if (isOpen) {
      setActiveSection('account');
    }
  }, [isOpen]);

  useEffect(() => {
    if (canAccessAdministration) return;
    if (activeSection.startsWith('administration_')) {
      setActiveSection('account');
    }
  }, [activeSection, canAccessAdministration]);

  useEffect(() => {
    if (isOpen) {
      setTheme(getLocalThemePreference());
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || !canAccessAdministration) return;

    const channel = supabase
      .channel(`settings-admin-reports-${user?.id || 'anon'}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'betails_reports',
        },
        () => {
          queryClient.invalidateQueries({ queryKey: ADMIN_REPORTS_PENDING_COUNT_QUERY_KEY });
          queryClient.invalidateQueries({ queryKey: ['settings', 'admin', 'reports'] });
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [isOpen, canAccessAdministration, queryClient, user?.id]);

  useEffect(() => {
    if (!isOpen || !user) return;
    let isMounted = true;
    setLoadingPreferences(true);
    (async () => {
      try {
        const [
          { data: profileData },
          { data: newsletterSetting, error: newsletterError },
          { data: friendRequestsSetting, error: friendRequestsError },
        ] = await Promise.all([
          supabase
            .from('users_profiles')
            .select('farm_id')
            .eq('id', user.id)
            .maybeSingle(),
          supabase
            .from('user_settings')
            .select('setting_value')
            .eq('user_id', user.id)
            .eq('setting_name', NEWSLETTER_SETTING_NAME)
            .maybeSingle(),
          supabase
            .from('user_settings')
            .select('setting_value')
            .eq('user_id', user.id)
            .eq('setting_name', ALLOW_FRIEND_REQUESTS_SETTING_NAME)
            .maybeSingle(),
        ]);
        if (!isMounted) return;
        if (newsletterError) {
          console.error('Impossible de lire la préférence newsletter', newsletterError);
          setNewsletterEnabled(true);
        } else {
          setNewsletterEnabled(resolveNewsletterEnabled(newsletterSetting));
        }
        if (friendRequestsError) {
          console.error('Impossible de lire la préférence de demandes d\'amis', friendRequestsError);
          setFriendRequestsEnabled(true);
        } else {
          setFriendRequestsEnabled(resolveFriendRequestsEnabled(friendRequestsSetting));
        }
        setFarmId(profileData?.farm_id || null);

        if (profileData?.farm_id) {
          const { data: farmData } = await supabase
            .from('farms_list')
            .select('visible')
            .eq('id', profileData.farm_id)
            .maybeSingle();
          if (!isMounted) return;
          setFarmVisible(Boolean(farmData?.visible));
        } else {
          setFarmVisible(false);
        }
      } finally {
        if (isMounted) {
          setLoadingPreferences(false);
        }
      }
    })();
    return () => {
      isMounted = false;
    };
  }, [isOpen, user]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const normalizedTheme = normalizeThemeValue(theme);
    if (normalizedTheme !== theme) {
      setTheme(normalizedTheme);
      return;
    }

    applyLocalThemePreference(normalizedTheme);

    if (!user?.id) {
      return;
    }

    let isCancelled = false;
    (async () => {
      const { error } = await saveUserThemePreference({ userId: user.id, theme: normalizedTheme });
      if (!isCancelled && error) {
        console.error('Impossible de sauvegarder le thème utilisateur', error);
      }
    })();

    return () => {
      isCancelled = true;
    };
  }, [isOpen, theme, user?.id]);

  const handleNewsletterToggle = async () => {
    if (!user || savingNewsletter) return;
    const nextValue = !newsletterEnabled;
    setNewsletterEnabled(nextValue);
    setSavingNewsletter(true);

    let error = null;
    if (nextValue) {
      const { error: deleteError } = await supabase
        .from('user_settings')
        .delete()
        .eq('user_id', user.id)
        .eq('setting_name', NEWSLETTER_SETTING_NAME);
      error = deleteError;
    } else {
      const { error: upsertError } = await supabase
        .from('user_settings')
        .upsert(
          {
            user_id: user.id,
            setting_name: NEWSLETTER_SETTING_NAME,
            setting_value: false,
          },
          { onConflict: 'user_id,setting_name' },
        );
      error = upsertError;
    }

    if (error) {
      console.error('Impossible de mettre à jour la préférence newsletter', error);
      setNewsletterEnabled(!nextValue);
    }
    setSavingNewsletter(false);
  };

  const handleFarmVisibilityToggle = async () => {
    if (!farmId || savingFarm) return;
    const nextValue = !farmVisible;
    setFarmVisible(nextValue);
    setSavingFarm(true);
    const { error } = await supabase
      .from('farms_list')
      .update({ visible: nextValue })
      .eq('id', farmId);
    if (error) {
      console.error('Impossible de mettre à jour la visibilité de la ferme', error);
      setFarmVisible(!nextValue);
    }
    setSavingFarm(false);
  };

  const handleFriendRequestsToggle = async () => {
    if (!user || savingFriendRequests) return;
    const nextValue = !friendRequestsEnabled;
    setFriendRequestsEnabled(nextValue);
    setSavingFriendRequests(true);

    let error = null;
    if (nextValue) {
      const { error: deleteError } = await supabase
        .from('user_settings')
        .delete()
        .eq('user_id', user.id)
        .eq('setting_name', ALLOW_FRIEND_REQUESTS_SETTING_NAME);
      error = deleteError;
    } else {
      const { error: upsertError } = await supabase
        .from('user_settings')
        .upsert(
          {
            user_id: user.id,
            setting_name: ALLOW_FRIEND_REQUESTS_SETTING_NAME,
            setting_value: false,
          },
          { onConflict: 'user_id,setting_name' },
        );
      error = upsertError;
    }

    if (error) {
      console.error('Impossible de mettre à jour la préférence des demandes d\'amis', error);
      setFriendRequestsEnabled(!nextValue);
    }

    setSavingFriendRequests(false);
  };

  const handleCopyId = async () => {
    if (!user?.id) return;
    try {
      await navigator.clipboard.writeText(user.id);
      setCopiedId(true);
      setTimeout(() => setCopiedId(false), 2000);
    } catch (error) {
      console.error('Impossible de copier l\'ID', error);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="settings-overlay" role="dialog" aria-modal="true" onClick={onClose}>
      <div
        className={`settings-modal ${themeClass}`}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="settings-header">
          <div>
            <p className="settings-subtitle">Paramètres</p>
            <h2 className="settings-title">Préférences</h2>
          </div>
          <div className="settings-actions">
            <button
              type="button"
              className="settings-theme-toggle"
              onClick={() =>
                setTheme((value) =>
                  value === 'dark'
                    ? 'pastel'
                    : value === 'pastel'
                      ? 'galactic'
                      : value === 'galactic'
                        ? 'multicolor'
                        : value === 'multicolor'
                          ? 'light'
                          : 'dark'
                )
              }
              aria-label="Changer de thème"
              title="Changer de thème"
            >
              {isDark ? <Sun size={18} /> : <Moon size={18} />}
            </button>
            <button type="button" className="settings-close" onClick={onClose} aria-label="Fermer">
              ×
            </button>
          </div>
        </header>

        <div className="settings-body">
          <aside className="settings-sidebar">
            <div className="settings-sidebar-categories">
              <div className="settings-category">
                <p className="settings-category-title">Compte</p>
                <button
                  type="button"
                  className={`settings-link settings-link--account ${activeSection === 'account' ? 'active' : ''}`}
                  onClick={() => setActiveSection('account')}
                >
                  <div className="settings-user">
                    <div className="settings-user-avatar">
                      {profile?.avatar_url ? (
                        <img src={profile.avatar_url} alt="avatar" />
                      ) : (
                        <svg viewBox="0 0 24 24" aria-hidden="true">
                          <path
                            fill="currentColor"
                            d="M12 12a4 4 0 1 0-4-4 4 4 0 0 0 4 4Zm0 2c-4.42 0-8 2-8 4.5V20h16v-1.5C20 16 16.42 14 12 14Z"
                          />
                        </svg>
                      )}
                    </div>
                    <div className="settings-user-info">
                      <p className="settings-user-name">{profile?.username || 'Utilisateur'}</p>
                    </div>
                  </div>
                </button>
                <button
                  type="button"
                  className={`settings-link ${activeSection === 'preferences' ? 'active' : ''}`}
                  onClick={() => setActiveSection('preferences')}
                >
                  {SECTIONS.preferences}
                </button>
              </div>

              <div className="settings-category">
                <p className="settings-category-title">Autres</p>
                <button
                  type="button"
                  className={`settings-link ${activeSection === 'badges' ? 'active' : ''}`}
                  onClick={() => setActiveSection('badges')}
                >
                  {SECTIONS.badges}
                </button>
                <button
                  type="button"
                  className={`settings-link ${activeSection === 'import' ? 'active' : ''}`}
                  onClick={() => setActiveSection('import')}
                >
                  {SECTIONS.import}
                </button>
              </div>

              {canAccessAdministration && (
                <div className="settings-category">
                  <p className="settings-category-title">{SECTIONS.administration}</p>
                  {isAdmin && (
                    <>
                      <button
                        type="button"
                        className={`settings-link ${activeSection === 'administration_expeditions' ? 'active' : ''}`}
                        onClick={() => setActiveSection('administration_expeditions')}
                      >
                        {SECTIONS.expeditions}
                      </button>
                      <button
                        type="button"
                        className={`settings-link ${activeSection === 'administration_invisible_betails' ? 'active' : ''}`}
                        onClick={() => setActiveSection('administration_invisible_betails')}
                      >
                        {SECTIONS.invisibleBetails}
                      </button>
                    </>
                  )}
                  <button
                    type="button"
                    className={`settings-link settings-link--with-badge ${activeSection === 'administration_signalements' ? 'active' : ''}`}
                    onClick={() => setActiveSection('administration_signalements')}
                  >
                    <span>{SECTIONS.reports}</span>
                    {pendingReportsCount > 0 ? (
                      <span className="settings-link-badge" aria-label={`${pendingReportsCount} signalements en attente`}>
                        {pendingReportsBadgeCount}
                      </span>
                    ) : null}
                  </button>
                </div>
              )}
            </div>
            <p className="settings-sidebar-version" title="Version marketing • commit">
              {versionLabel}
            </p>
          </aside>

          <section className="settings-content">
            {activeSection === 'account' && (
              <div className="settings-section">
                <h3 className="settings-section-title">Compte</h3>
                <div className="settings-list">
                  <Settings_ChangePassword user={user} />
                  <Settings_ChangeEmail user={user} />
                  <Settings_ChangeAvatar user={user} profile={profile} />
                  <div className="settings-item settings-item--disabled">
                    <div>
                      <p className="settings-item-title">Signaler un bug</p>
                      <p className="settings-item-subtitle">Rapportez un problème ou un dysfonctionnement.</p>
                    </div>
                    <button type="button" className="settings-action" disabled>Signaler</button>
                  </div>
                  <div className="settings-item">
                    <div>
                      <p className="settings-item-title">ID utilisateur</p>
                      <p className="settings-item-subtitle mono">{user?.id || '—'}</p>
                    </div>
                    <button type="button" className="settings-action" onClick={handleCopyId}>
                      {copiedId ? 'Copié !' : 'Copier'}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {activeSection === 'preferences' && (
              <div className="settings-section">
                <h3 className="settings-section-title">Préférences</h3>
                <div className="settings-list">
                  <div className="settings-item settings-theme-item">
                    <div>
                      <p className="settings-item-title">Thème</p>
                      <p className="settings-item-subtitle">Choisissez l’ambiance visuelle de l’interface.</p>
                    </div>
                    <select
                      className="settings-select"
                      value={theme}
                      onChange={(event) => setTheme(event.target.value)}
                      aria-label="Sélecteur de thème"
                    >
                      <option value="dark">Sombre</option>
                      <option value="pastel">Rose pastel</option>
                      <option value="galactic">Galactique bleu</option>
                      <option value="multicolor">Multicolore</option>
                      <option value="light">Clair</option>
                    </select>
                  </div>
                  <div className="settings-toggle">
                    <div>
                      <p className="settings-item-title">Ferme publique</p>
                      <p className="settings-item-subtitle">
                        {farmId
                          ? 'Rendez votre ferme visible dans la communauté.'
                          : 'Associez une ferme pour configurer cette option.'}
                      </p>
                    </div>
                    <label className={`settings-switch ${savingFarm ? 'is-busy' : ''}`}>
                      <input
                        type="checkbox"
                        onChange={handleFarmVisibilityToggle}
                        checked={farmVisible}
                        disabled={!farmId || savingFarm || loadingPreferences}
                      />
                      <span className="settings-slider" />
                    </label>
                  </div>
                  <div className="settings-toggle">
                    <div>
                      <p className="settings-item-title">Recevoir du bétail</p>
                      <p className="settings-item-subtitle">Autorisez les dons et transferts de bétail.</p>
                    </div>
                    <label className="settings-switch">
                      <input type="checkbox" disabled />
                      <span className="settings-slider" />
                    </label>
                  </div>
                  <div className="settings-toggle">
                    <div>
                      <p className="settings-item-title">Recevoir des demandes d’amis</p>
                      <p className="settings-item-subtitle">Activez les invitations sociales.</p>
                    </div>
                    <label className={`settings-switch ${savingFriendRequests ? 'is-busy' : ''}`}>
                      <input
                        type="checkbox"
                        onChange={handleFriendRequestsToggle}
                        checked={friendRequestsEnabled}
                        disabled={savingFriendRequests || loadingPreferences}
                      />
                      <span className="settings-slider" />
                    </label>
                  </div>
                  <div className="settings-toggle">
                    <div>
                      <p className="settings-item-title">Newsletters</p>
                      <p className="settings-item-subtitle">Recevez les dernières nouveautés par e-mail.</p>
                    </div>
                    <label className={`settings-switch ${savingNewsletter ? 'is-busy' : ''}`}>
                      <input
                        type="checkbox"
                        onChange={handleNewsletterToggle}
                        checked={newsletterEnabled}
                        disabled={savingNewsletter || loadingPreferences}
                      />
                      <span className="settings-slider" />
                    </label>
                  </div>
                </div>
              </div>
            )}

            {activeSection === 'badges' && (
              <div className="settings-section">
                <h3 className="settings-section-title">Badges</h3>
                <div className="settings-list">
                  <div className="settings-item">
                    <div>
                      <p className="settings-item-title">Gestion des badges</p>
                      <p className="settings-item-subtitle">Badges de fermes et de bétails.</p>
                    </div>
                    <button type="button" className="settings-action">Gérer</button>
                  </div>
                  <div className="settings-item">
                    <div>
                      <p className="settings-item-title">Boutique</p>
                      <p className="settings-item-subtitle">Accédez aux packs et récompenses.</p>
                    </div>
                    <button
                      type="button"
                      className="settings-action"
                      onClick={() => {
                        onClose?.();
                        navigate('/boutique');
                      }}
                    >
                      Ouvrir
                    </button>
                  </div>
                </div>
              </div>
            )}

            {activeSection === 'import' && (
              <div className="settings-section">
                <h3 className="settings-section-title">Importer</h3>
                <div className="settings-list">
                  <div className="settings-item">
                    <div>
                      <p className="settings-item-title">Importer le design d’une ferme</p>
                      <p className="settings-item-subtitle">Ajoutez un modèle de ferme depuis un fichier externe.</p>
                    </div>
                    <button type="button" className="settings-action">Importer</button>
                  </div>
                </div>
              </div>
            )}

            {isAdmin && activeSection === 'administration_expeditions' && (
              <Settings_AdminShippingPanel isActive={activeSection === 'administration_expeditions'} isAdmin={isAdmin} />
            )}

            {isAdmin && activeSection === 'administration_invisible_betails' && (
              <Settings_AdminInvisibleBetailsPanel
                isActive={activeSection === 'administration_invisible_betails'}
                isAdmin={isAdmin}
              />
            )}

            {canAccessAdministration && activeSection === 'administration_signalements' && (
              <Settings_ReportsPanel
                isActive={activeSection === 'administration_signalements'}
                canAccessAdministration={canAccessAdministration}
                currentUserId={user?.id || null}
              />
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

export default SettingsModal;
