import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Moon, Sun } from 'lucide-react';
import { supabase } from '../authentification/supabaseClient';
import {
  MAX_BADGE_SLOTS,
  equipFarmBadgeReborn,
  fetchUserBadgesEquipsReborn,
  fetchUserBadgesInventoryReborn,
  unequipFarmBadgeReborn,
} from '../badges';
import Settings_ChangePassword from './Settings_ChangePassword';
import Settings_ChangeEmail from './Settings_ChangeEmail';
import Settings_ChangeAvatar from './Settings_ChangeAvatar';
import Settings_ClaimSurpriseCode from './Settings_ClaimSurpriseCode';
import Settings_AdminShippingPanel from './Settings_AdminShippingPanel';
import Settings_AdminInvisibleBetailsPanel from './Settings_AdminInvisibleBetailsPanel';
import Settings_ReportsPanel from './Settings_ReportsPanel';
import Settings_AdminBadgesPanel from './Settings_AdminBadgesPanel';
import Settings_AdminSurpriseCodesPanel from './Settings_AdminSurpriseCodesPanel';
import Settings_MaintenancePanel from './Settings_MaintenancePanel';
import {
  applyLocalThemePreference,
  getLocalThemePreference,
  normalizeThemeValue,
  saveUserThemePreference,
} from './themePreferences';
import { getFullVersionLabel } from '../utils/appVersion';
import './SettingsModal.css';

const SECTIONS = {
  account: 'Compte',
  preferences: 'Préférences',
  badges: 'Badges',
  import: 'Importer',
  administration: 'Administration',
  adminBadges: 'Badges admin',
  adminSurpriseCodes: 'Codes surprise',
  maintenance: 'Maintenance',
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
  const versionLabel = getFullVersionLabel();
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
  const [badgePickerSlot, setBadgePickerSlot] = useState(null);
  const [isBadgePickerOpen, setIsBadgePickerOpen] = useState(false);
  const [ownedBadgesPage, setOwnedBadgesPage] = useState(0);
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
  const emitToast = (type, message) => {
    window.dispatchEvent(new CustomEvent('farmgestion-toast', { detail: { type, message } }));
  };

  const badgeInventoryQuery = useQuery({
    queryKey: ['settings', 'badges', 'inventory', user?.id || 'anon'],
    enabled: Boolean(isOpen && user?.id),
    queryFn: () => fetchUserBadgesInventoryReborn(user.id),
    staleTime: 30_000,
    gcTime: 300_000,
    retry: 1,
  });

  const badgeEquipsQuery = useQuery({
    queryKey: ['settings', 'badges', 'equips', user?.id || 'anon'],
    enabled: Boolean(isOpen && user?.id),
    queryFn: () => fetchUserBadgesEquipsReborn(user.id),
    staleTime: 20_000,
    gcTime: 300_000,
    retry: 1,
  });

  useEffect(() => {
    const handleSurpriseRedemption = (event) => {
      const redeemedUserId = String(event?.detail?.userId || '').trim();
      const currentUserId = String(user?.id || '').trim();

      if (!currentUserId || (redeemedUserId && redeemedUserId !== currentUserId)) {
        return;
      }

      queryClient.invalidateQueries({ queryKey: ['settings', 'badges', 'inventory', currentUserId] });
      queryClient.invalidateQueries({ queryKey: ['settings', 'badges', 'equips', currentUserId] });
      queryClient.invalidateQueries({ queryKey: ['farm', 'equips', farmId || null] });
    };

    window.addEventListener('farmgestion-surprise-redeemed', handleSurpriseRedemption);
    return () => window.removeEventListener('farmgestion-surprise-redeemed', handleSurpriseRedemption);
  }, [farmId, queryClient, user?.id]);

  const equipFarmBadgeMutation = useMutation({
    mutationFn: ({ badgeId, slot = null }) => equipFarmBadgeReborn({ badgeId, slot }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings', 'badges', 'equips', user?.id || 'anon'] });
      queryClient.invalidateQueries({ queryKey: ['settings', 'badges', 'inventory', user?.id || 'anon'] });
      queryClient.invalidateQueries({ queryKey: ['farm', 'equips', farmId || null] });
    },
  });

  const unequipFarmBadgeMutation = useMutation({
    mutationFn: ({ badgeId }) => unequipFarmBadgeReborn({ badgeId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings', 'badges', 'equips', user?.id || 'anon'] });
      queryClient.invalidateQueries({ queryKey: ['settings', 'badges', 'inventory', user?.id || 'anon'] });
      queryClient.invalidateQueries({ queryKey: ['farm', 'equips', farmId || null] });
    },
  });

  const inventoryBadges = badgeInventoryQuery.data || [];
  const equippedBadges = badgeEquipsQuery.data || [];
  const equippedBadgeIdSet = useMemo(
    () => new Set(equippedBadges.map((badge) => badge.id)),
    [equippedBadges],
  );
  const farmEquippedBadges = useMemo(
    () => equippedBadges.filter((badge) => Number(badge.farmId) === Number(farmId)),
    [equippedBadges, farmId],
  );
  const equippedBadgeById = useMemo(() => {
    const map = new Map();
    equippedBadges.forEach((badge) => {
      map.set(badge.id, badge);
    });
    return map;
  }, [equippedBadges]);
  const equippedBetailIds = useMemo(() => {
    const ids = new Set();
    equippedBadges.forEach((badge) => {
      const betailId = badge?.betailId;
      if (betailId !== null && betailId !== undefined && String(betailId).trim()) {
        ids.add(String(betailId));
      }
    });
    return Array.from(ids).sort((left, right) => String(left).localeCompare(String(right), 'fr'));
  }, [equippedBadges]);
  const equippedBetailsQuery = useQuery({
    queryKey: ['settings', 'badges', 'equipped-betails', user?.id || 'anon', equippedBetailIds],
    enabled: Boolean(isOpen && activeSection === 'badges' && equippedBetailIds.length),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('betails')
        .select('id,name,matricule')
        .in('id', equippedBetailIds);

      if (error) throw error;
      return data || [];
    },
    staleTime: 30_000,
    gcTime: 300_000,
    retry: 1,
  });
  const equippedBetailById = useMemo(() => {
    const map = new Map();
    (equippedBetailsQuery.data || []).forEach((betail) => {
      map.set(String(betail.id), {
        name: String(betail.name || 'Bétail'),
        matricule: String(betail.matricule || '-'),
      });
    });
    return map;
  }, [equippedBetailsQuery.data]);
  const farmEquippedBySlot = useMemo(() => {
    const map = new Map();
    farmEquippedBadges.forEach((badge) => {
      if (Number.isFinite(Number(badge.slot))) {
        map.set(Number(badge.slot), badge);
      }
    });
    return map;
  }, [farmEquippedBadges]);
  const freeInventoryBadges = useMemo(
    () => inventoryBadges.filter((badge) => !equippedBadgeIdSet.has(badge.id)),
    [inventoryBadges, equippedBadgeIdSet],
  );
  const ownedBadgesPageSize = 3;
  const ownedBadgesPages = useMemo(() => {
    const pages = [];
    for (let index = 0; index < inventoryBadges.length; index += ownedBadgesPageSize) {
      pages.push(inventoryBadges.slice(index, index + ownedBadgesPageSize));
    }
    return pages;
  }, [inventoryBadges]);
  const ownedBadgesPagesCount = ownedBadgesPages.length;
  const hasOwnedBadgesPrevPage = ownedBadgesPage > 0;
  const hasOwnedBadgesNextPage = ownedBadgesPage < ownedBadgesPagesCount - 1;
  const selectedSlotBadge = useMemo(() => {
    if (!Number.isFinite(Number(badgePickerSlot))) return null;
    return farmEquippedBySlot.get(Number(badgePickerSlot)) || null;
  }, [badgePickerSlot, farmEquippedBySlot]);
  const isBadgeMutationPending = equipFarmBadgeMutation.isPending || unequipFarmBadgeMutation.isPending;

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        if (isBadgePickerOpen) {
          setIsBadgePickerOpen(false);
          setBadgePickerSlot(null);
          return;
        }
        onClose?.();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, isBadgePickerOpen, onClose]);

  useEffect(() => {
    if (!isOpen) return;
    if (activeSection !== 'badges' && isBadgePickerOpen) {
      setIsBadgePickerOpen(false);
      setBadgePickerSlot(null);
    }
  }, [activeSection, isBadgePickerOpen, isOpen]);

  useEffect(() => {
    const maxPage = Math.max(ownedBadgesPagesCount - 1, 0);
    setOwnedBadgesPage((current) => Math.min(current, maxPage));
  }, [ownedBadgesPagesCount]);

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
    if (isAdmin) return;
    if (
      activeSection === 'administration_badges'
      || activeSection === 'administration_surprise_codes'
      || activeSection === 'administration_maintenance'
      || activeSection === 'administration_expeditions'
      || activeSection === 'administration_invisible_betails'
    ) {
      setActiveSection('account');
    }
  }, [activeSection, isAdmin]);

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

  const handleEquipFarmBadge = async (badgeId, slot = null) => {
    if (!badgeId || !farmId || equipFarmBadgeMutation.isPending) return;
    try {
      const result = await equipFarmBadgeMutation.mutateAsync({ badgeId, slot });
      if (!result?.success) {
        const reason = result?.reason || 'UNKNOWN';
        if (reason === 'NO_FREE_SLOT') {
          emitToast('error', 'Tous les slots ferme sont occupés.');
        } else if (reason === 'BADGE_ALREADY_EQUIPPED') {
          emitToast('error', 'Ce badge est déjà équipé ailleurs.');
        } else if (reason === 'BADGE_NOT_OWNED') {
          emitToast('error', 'Ce badge n’est pas dans ton inventaire.');
        } else {
          emitToast('error', 'Équipement ferme impossible pour le moment.');
        }
        return;
      }
      emitToast('success', 'Badge équipé sur la ferme.');
    } catch (error) {
      const message = String(error?.message || '').toLowerCase();
      if (error?.code === '42883' || message.includes('equip_farm_badge_reborn')) {
        emitToast('error', 'Fonction SQL equip_farm_badge_reborn absente.');
      } else {
        emitToast('error', 'Erreur pendant l’équipement de la ferme.');
      }
    }
  };

  const handleUnequipFarmBadge = async (badgeId) => {
    if (!badgeId || unequipFarmBadgeMutation.isPending) return;
    try {
      const result = await unequipFarmBadgeMutation.mutateAsync({ badgeId });
      if (!result?.success) {
        emitToast('error', 'Déséquipement ferme impossible pour le moment.');
        return;
      }
      emitToast('success', 'Badge retiré de la ferme.');
    } catch (error) {
      const message = String(error?.message || '').toLowerCase();
      if (error?.code === '42883' || message.includes('unequip_farm_badge_reborn')) {
        emitToast('error', 'Fonction SQL unequip_farm_badge_reborn absente.');
      } else {
        emitToast('error', 'Erreur pendant le déséquipement de la ferme.');
      }
    }
  };

  const openBadgePickerForSlot = (slot) => {
    if (!Number.isFinite(Number(slot))) return;
    setBadgePickerSlot(Number(slot));
    setIsBadgePickerOpen(true);
  };

  const closeBadgePicker = () => {
    setIsBadgePickerOpen(false);
    setBadgePickerSlot(null);
  };

  const handleEquipBadgeFromSlotPicker = async (badge) => {
    const slot = Number(badgePickerSlot);
    if (!Number.isFinite(slot) || !badge?.id || !farmId || isBadgeMutationPending) return;

    const currentlyEquipped = farmEquippedBySlot.get(slot);
    if (currentlyEquipped?.id === badge.id) {
      closeBadgePicker();
      return;
    }

    if (currentlyEquipped?.id) {
      try {
        const unequipResult = await unequipFarmBadgeMutation.mutateAsync({ badgeId: currentlyEquipped.id });
        if (!unequipResult?.success) {
          emitToast('error', 'Impossible de remplacer le badge sur ce slot.');
          return;
        }
      } catch {
        emitToast('error', 'Impossible de remplacer le badge sur ce slot.');
        return;
      }
    }

    await handleEquipFarmBadge(badge.id, slot);
    closeBadgePicker();
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
                        className={`settings-link ${activeSection === 'administration_badges' ? 'active' : ''}`}
                        onClick={() => setActiveSection('administration_badges')}
                      >
                        {SECTIONS.adminBadges}
                      </button>
                      <button
                        type="button"
                        className={`settings-link ${activeSection === 'administration_surprise_codes' ? 'active' : ''}`}
                        onClick={() => setActiveSection('administration_surprise_codes')}
                      >
                        {SECTIONS.adminSurpriseCodes}
                      </button>
                      <button
                        type="button"
                        className={`settings-link ${activeSection === 'administration_maintenance' ? 'active' : ''}`}
                        onClick={() => setActiveSection('administration_maintenance')}
                      >
                        {SECTIONS.maintenance}
                      </button>
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
                  <Settings_ClaimSurpriseCode />
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
                      <p className="settings-item-title">Inventaire badges</p>
                      <p className="settings-item-subtitle">
                        {badgeInventoryQuery.isLoading
                          ? 'Chargement de tes badges...'
                          : `${inventoryBadges.length} badge(s) possédé(s), ${equippedBadges.length} équipé(s).`}
                      </p>
                    </div>
                    <button
                      type="button"
                      className="settings-action"
                      onClick={() => {
                        queryClient.invalidateQueries({ queryKey: ['settings', 'badges', 'inventory', user?.id || 'anon'] });
                        queryClient.invalidateQueries({ queryKey: ['settings', 'badges', 'equips', user?.id || 'anon'] });
                      }}
                      disabled={badgeInventoryQuery.isLoading || badgeEquipsQuery.isLoading}
                    >
                      Rafraîchir
                    </button>
                  </div>
                  <div className="settings-item settings-item--column">
                    <div className="settings-badge-section-header">
                      <div>
                        <p className="settings-item-title">Badges équipés sur la ferme</p>
                        <p className="settings-item-subtitle">Clique sur un slot pour équiper ou changer un badge.</p>
                      </div>
                      <button
                        type="button"
                        className="settings-action settings-action--tiny"
                        onClick={() => {
                          if (!farmId) return;
                          onClose?.();
                          navigate(`/farm/${farmId}`);
                        }}
                        disabled={!farmId}
                      >
                        Voir ma ferme
                      </button>
                    </div>
                    <div className="settings-badge-slot-grid settings-badge-slot-grid--centered" role="list" aria-label="Slots badges de la ferme">
                      {Array.from({ length: MAX_BADGE_SLOTS }, (_, index) => {
                        const slot = index + 1;
                        const badge = farmEquippedBySlot.get(slot);
                        if (!badge) {
                          return (
                            <article
                              key={`farm-slot-empty-${slot}`}
                              className="settings-badge-slot-card is-empty is-clickable"
                              role="button"
                              tabIndex={0}
                              onClick={() => openBadgePickerForSlot(slot)}
                              onKeyDown={(event) => {
                                if (event.key === 'Enter' || event.key === ' ') {
                                  event.preventDefault();
                                  openBadgePickerForSlot(slot);
                                }
                              }}
                            >
                              <p className="settings-badge-slot-title">Slot {slot}</p>
                              <p className="settings-badge-slot-meta">Emplacement vide</p>
                              <p className="settings-badge-slot-hint">Cliquer pour équiper</p>
                            </article>
                          );
                        }

                        return (
                          <article
                            key={`farm-slot-${badge.id}`}
                            className={`settings-badge-slot-card is-${badge.rarity} is-clickable`}
                            role="button"
                            tabIndex={0}
                            onClick={() => openBadgePickerForSlot(slot)}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter' || event.key === ' ') {
                                event.preventDefault();
                                openBadgePickerForSlot(slot);
                              }
                            }}
                          >
                            {badge.imageUrl ? (
                              <img src={badge.imageUrl} alt={badge.filename} className="settings-badge-slot-image" loading="lazy" decoding="async" />
                            ) : (
                              <span className="settings-badge-slot-fallback" aria-hidden="true">?</span>
                            )}
                            <p className="settings-badge-slot-title">Slot {slot}</p>
                            <p className="settings-badge-slot-meta">{badge.name}</p>
                            <p className="settings-badge-slot-hint">Cliquer pour changer</p>
                            <button
                              type="button"
                              className="settings-action settings-action--tiny"
                              onClick={(event) => {
                                event.stopPropagation();
                                handleUnequipFarmBadge(badge.id);
                              }}
                              disabled={isBadgeMutationPending}
                            >
                              Retirer
                            </button>
                          </article>
                        );
                      })}
                    </div>
                  </div>
                  <div className="settings-item settings-item--column">
                    <div>
                      <p className="settings-item-title">Tous les badges possédés</p>
                      <p className="settings-item-subtitle">Passez votre souris sur un badge pour voir où il est équipé.</p>
                      <p className="settings-item-subtitle">Visible aussi depuis votre profil communautaire.</p>
                    </div>
                    {inventoryBadges.length ? (
                      <div className="settings-badge-owned-carousel" aria-label="Badges possédés">
                        <button
                          type="button"
                          className={`settings-badge-carousel-nav settings-badge-carousel-nav--prev ${hasOwnedBadgesPrevPage ? '' : 'is-hidden'}`}
                          onClick={() => setOwnedBadgesPage((page) => Math.max(page - 1, 0))}
                          aria-label="Badges précédents"
                          disabled={!hasOwnedBadgesPrevPage}
                        >
                          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                            <path
                              d="M14.5 6.5 9 12l5.5 5.5"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2.4"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            />
                          </svg>
                        </button>

                        <div className="settings-badge-owned-viewport" role="list" aria-label="Liste paginée des badges possédés">
                          <div
                            className="settings-badge-owned-track"
                            style={{ transform: `translateX(-${ownedBadgesPage * 100}%)` }}
                          >
                            {ownedBadgesPages.map((badgesPage, pageIndex) => (
                              <div key={`owned-badges-page-${pageIndex}`} className="settings-badge-owned-page">
                                <div className="settings-badge-owned-grid">
                                  {badgesPage.map((badge) => {
                                    const isEquipped = equippedBadgeIdSet.has(badge.id);
                                    const equipRecord = equippedBadgeById.get(badge.id) || null;
                                    const isEquippedOnBetail = Boolean(
                                      equipRecord?.betailId !== null
                                      && equipRecord?.betailId !== undefined
                                      && String(equipRecord?.betailId).trim(),
                                    );
                                    const equippedBetailInfo = equipRecord?.betailId
                                      ? equippedBetailById.get(String(equipRecord.betailId))
                                      : null;
                                    const equippedHoverLabel = isEquippedOnBetail
                                      ? (equippedBetailInfo
                                        ? `${equippedBetailInfo.name} • ${equippedBetailInfo.matricule}`
                                        : (equippedBetailsQuery.isLoading ? 'Chargement du bétail...' : 'Bétail équipé'))
                                      : 'Équipé sur la ferme';
                                    return (
                                      <article
                                        key={`owned-badge-${badge.id}`}
                                        className={`settings-badge-owned-card is-${badge.rarity} ${isEquipped ? 'is-equipped' : ''}`}
                                        role="listitem"
                                      >
                                        {badge.imageUrl ? (
                                          <img src={badge.imageUrl} alt={badge.filename} className="settings-badge-slot-image" loading="lazy" decoding="async" />
                                        ) : (
                                          <span className="settings-badge-slot-fallback" aria-hidden="true">?</span>
                                        )}
                                        <p className="settings-badge-slot-title">{badge.name}</p>
                                        <p className="settings-badge-slot-meta">{badge.rarityLabel}</p>
                                        <div className="settings-badge-owned-status-wrap">
                                          <p className="settings-badge-owned-status">{isEquipped ? 'Équipé' : 'Libre'}</p>
                                          {isEquipped ? <p className="settings-badge-owned-status-hover">{equippedHoverLabel}</p> : null}
                                        </div>
                                      </article>
                                    );
                                  })}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>

                        <button
                          type="button"
                          className={`settings-badge-carousel-nav settings-badge-carousel-nav--next ${hasOwnedBadgesNextPage ? '' : 'is-hidden'}`}
                          onClick={() => setOwnedBadgesPage((page) => Math.min(page + 1, Math.max(ownedBadgesPagesCount - 1, 0)))}
                          aria-label="Badges suivants"
                          disabled={!hasOwnedBadgesNextPage}
                        >
                          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                            <path
                              d="M9.5 6.5 15 12l-5.5 5.5"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2.4"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            />
                          </svg>
                        </button>
                      </div>
                    ) : (
                      <p className="settings-item-subtitle">Tu ne possèdes encore aucun badge.</p>
                    )}
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

            {isAdmin && activeSection === 'administration_badges' && (
              <Settings_AdminBadgesPanel
                isActive={activeSection === 'administration_badges'}
                isAdmin={isAdmin}
                currentUserId={user?.id || null}
              />
            )}

            {isAdmin && activeSection === 'administration_surprise_codes' && (
              <Settings_AdminSurpriseCodesPanel
                isActive={activeSection === 'administration_surprise_codes'}
                isAdmin={isAdmin}
                currentUserId={user?.id || null}
              />
            )}

            {isAdmin && activeSection === 'administration_maintenance' && (
              <Settings_MaintenancePanel
                isActive={activeSection === 'administration_maintenance'}
                isAdmin={isAdmin}
              />
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

        {isBadgePickerOpen ? (
          <div className="settings-badge-picker-backdrop" role="presentation" onMouseDown={closeBadgePicker}>
            <div
              className="settings-badge-picker-modal"
              role="dialog"
              aria-modal="true"
              aria-labelledby="settings-badge-picker-title"
              onMouseDown={(event) => event.stopPropagation()}
            >
              <p className="settings-badge-picker-kicker">Slot {badgePickerSlot || '-'}</p>
              <h4 id="settings-badge-picker-title" className="settings-badge-picker-title">
                {selectedSlotBadge ? 'Changer le badge du slot' : 'Équiper un badge'}
              </h4>
              <p className="settings-badge-picker-subtitle">
                {freeInventoryBadges.length
                  ? `${freeInventoryBadges.length} badge(s) libre(s) et équipable(s).`
                  : 'Aucun badge libre à équiper pour le moment.'}
              </p>

              {freeInventoryBadges.length ? (
                <div
                  className={`settings-badge-picker-grid${freeInventoryBadges.length > 8 ? ' is-scrollable' : ''}`}
                  role="list"
                  aria-label="Badges libres équipables"
                >
                  {freeInventoryBadges.map((badge) => (
                    <button
                      key={`slot-picker-${badge.id}`}
                      type="button"
                      className={`settings-badge-picker-card is-${badge.rarity}`}
                      onClick={() => handleEquipBadgeFromSlotPicker(badge)}
                      disabled={isBadgeMutationPending}
                    >
                      {badge.imageUrl ? (
                        <img src={badge.imageUrl} alt={badge.filename} className="settings-badge-slot-image" loading="lazy" decoding="async" />
                      ) : (
                        <span className="settings-badge-slot-fallback" aria-hidden="true">?</span>
                      )}
                      <span className="settings-badge-picker-name">{badge.name}</span>
                    </button>
                  ))}
                </div>
              ) : null}

              <div className="settings-badge-picker-actions">
                <button type="button" className="settings-action" onClick={closeBadgePicker} disabled={isBadgeMutationPending}>
                  Annuler
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export default SettingsModal;

