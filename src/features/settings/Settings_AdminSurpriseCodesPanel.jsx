import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { RefreshCcw } from 'lucide-react';
import { supabase } from '../authentification/supabaseClient';
import { getBadgeImageUrl } from '../badges';
import { buildSurpriseLink } from '../authentification/surpriseCode';

const ADMIN_SURPRISE_CODES_QUERY_KEY = ['settings', 'admin', 'surprise-codes'];

const toDateInputValue = (isoValue) => {
  if (!isoValue) return '';
  const date = new Date(isoValue);
  if (Number.isNaN(date.getTime())) return '';
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const toNoonIso = (dateValue, endOfDay = false) => {
  if (!dateValue) return null;
  const time = endOfDay ? '23:59:59' : '00:00:00';
  const date = new Date(`${dateValue}T${time}`);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
};

const toSafeInt = (value, fallback = 0) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, Math.round(parsed));
};

const normalizeCodeInput = (value) =>
  String(value || '')
    .trim()
    .replace(/\s+/g, '_')
    .toUpperCase()
    .slice(0, 64);

const normalizeLabel = (value) => String(value || '').trim().slice(0, 120);
const normalizeDescription = (value) => String(value || '').trim().slice(0, 420);

const toArray = (value) => (Array.isArray(value) ? value : []);

const formatDateLabel = (isoValue, options) => {
  if (!isoValue) return '-';
  const date = new Date(isoValue);
  if (Number.isNaN(date.getTime())) return '-';
  return new Intl.DateTimeFormat('fr-FR', options || {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(date);
};

const getUsageLimit = (row) => {
  if (row?.max_total_uses) return Number(row.max_total_uses);
  if (row?.single_global_use) return 1;
  return null;
};

const getUsageRatio = (usageCount, usageLimit) => {
  if (!usageLimit || usageLimit <= 0) return null;
  return Math.max(0, Math.min(100, (Number(usageCount || 0) / usageLimit) * 100));
};

const getValidityRatio = (validFrom, validUntil) => {
  if (!validUntil) return null;
  const start = new Date(validFrom).getTime();
  const end = new Date(validUntil).getTime();
  const now = Date.now();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
  if (now <= start) return 0;
  if (now >= end) return 100;
  return Math.max(0, Math.min(100, ((now - start) / (end - start)) * 100));
};

const fetchBadgeChoices = async () => {
  const { data, error } = await supabase
    .from('badges_catalog_reborn')
    .select('id,name,filename,rarity,is_active')
    .eq('is_active', true)
    .order('rarity', { ascending: false })
    .order('name', { ascending: true });

  if (error) throw error;
  return Array.isArray(data) ? data : [];
};

const fetchSurpriseCodes = async () => {
  const fetchCodes = async () => {
    const withArray = await supabase
      .from('surprise_codes_reborn')
      .select('id,code,label,description,bonus_money,bonus_badge_id,bonus_badge_ids,valid_from,valid_until,is_enabled,single_global_use,max_total_uses,limit_per_account,limit_per_device,limit_per_ip,created_at')
      .order('created_at', { ascending: false });

    if (!withArray.error) return withArray;

    const message = String(withArray.error?.message || '').toLowerCase();
    const missingArrayColumn = withArray.error?.code === '42703' || message.includes('bonus_badge_ids');
    if (!missingArrayColumn) return withArray;

    return supabase
      .from('surprise_codes_reborn')
      .select('id,code,label,description,bonus_money,bonus_badge_id,valid_from,valid_until,is_enabled,single_global_use,max_total_uses,limit_per_account,limit_per_device,limit_per_ip,created_at')
      .order('created_at', { ascending: false });
  };

  const [{ data: codes, error: codesError }, { data: redemptions, error: redemptionsError }] = await Promise.all([
    fetchCodes(),
    supabase
      .from('surprise_code_redemptions_reborn')
      .select('code_id,created_at,awarded_money,awarded_badge_id,awarded_badge_ids'),
  ]);

  if (codesError) throw codesError;
  if (redemptionsError) throw redemptionsError;

  const statsByCodeId = (redemptions || []).reduce((acc, row) => {
    const codeId = String(row?.code_id || '').trim();
    if (!codeId) return acc;
    if (!acc[codeId]) {
      acc[codeId] = {
        usageCount: 0,
        distributedMoney: 0,
        distributedBadges: 0,
        lastUsedAt: null,
      };
    }

    acc[codeId].usageCount += 1;
    acc[codeId].distributedMoney += Math.max(0, Number(row?.awarded_money || 0));
    const awardedBadgeIds = toArray(row?.awarded_badge_ids).filter(Boolean);
    const badgeCount = awardedBadgeIds.length || (row?.awarded_badge_id ? 1 : 0);
    acc[codeId].distributedBadges += badgeCount;

    if (row?.created_at) {
      if (!acc[codeId].lastUsedAt || new Date(row.created_at).getTime() > new Date(acc[codeId].lastUsedAt).getTime()) {
        acc[codeId].lastUsedAt = row.created_at;
      }
    }

    return acc;
  }, {});

  return (codes || []).map((row) => ({
    ...row,
    bonus_badge_ids: toArray(row?.bonus_badge_ids),
    usageCount: statsByCodeId[row.id]?.usageCount || 0,
    distributedMoney: statsByCodeId[row.id]?.distributedMoney || 0,
    distributedBadges: statsByCodeId[row.id]?.distributedBadges || 0,
    lastUsedAt: statsByCodeId[row.id]?.lastUsedAt || null,
  }));
};

function Settings_AdminSurpriseCodesPanel({ isActive, isAdmin, currentUserId }) {
  const queryClient = useQueryClient();
  const [refreshSpinTick, setRefreshSpinTick] = useState(0);
  const [feedback, setFeedback] = useState({ type: '', message: '' });
  const [formCode, setFormCode] = useState('');
  const [formLabel, setFormLabel] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [formBonusMoney, setFormBonusMoney] = useState('0');
  const [formBadgeSearch, setFormBadgeSearch] = useState('');
  const [formSelectedBadgeIds, setFormSelectedBadgeIds] = useState([]);
  const [formValidFrom, setFormValidFrom] = useState(() => toDateInputValue(new Date().toISOString()));
  const [formValidUntil, setFormValidUntil] = useState('');
  const [formMode, setFormMode] = useState('multi_limited');
  const [formMaxUses, setFormMaxUses] = useState('');
  const [formLimitPerDevice, setFormLimitPerDevice] = useState(true);
  const [formLimitPerIp, setFormLimitPerIp] = useState(true);
  const [formEnabled, setFormEnabled] = useState(true);
  const [expandedCodeIds, setExpandedCodeIds] = useState([]);
  const [confirmDeleteCodeId, setConfirmDeleteCodeId] = useState('');
  const [copiedLinkKey, setCopiedLinkKey] = useState('');
  const copyResetTimeoutRef = useRef(null);

  const badgeChoicesQuery = useQuery({
    queryKey: [...ADMIN_SURPRISE_CODES_QUERY_KEY, 'badges'],
    queryFn: fetchBadgeChoices,
    enabled: Boolean(isActive && isAdmin),
    staleTime: 60_000,
    gcTime: 300_000,
    retry: 1,
    refetchOnWindowFocus: false,
  });

  const surpriseCodesQuery = useQuery({
    queryKey: ADMIN_SURPRISE_CODES_QUERY_KEY,
    queryFn: fetchSurpriseCodes,
    enabled: Boolean(isActive && isAdmin),
    staleTime: 20_000,
    gcTime: 300_000,
    retry: 1,
    refetchOnWindowFocus: false,
  });

  const createCodeMutation = useMutation({
    mutationFn: async () => {
      const code = normalizeCodeInput(formCode);
      const label = normalizeLabel(formLabel);
      const description = normalizeDescription(formDescription);
      const bonusMoney = toSafeInt(formBonusMoney, 0);
      const selectedBadgeIds = Array.from(new Set(formSelectedBadgeIds.map((id) => String(id || '').trim()).filter(Boolean)));
      const bonusBadgeId = selectedBadgeIds[0] || null;
      const validFromIso = toNoonIso(formValidFrom, false);
      const validUntilIso = formValidUntil ? toNoonIso(formValidUntil, true) : null;
      const singleGlobalUse = formMode === 'single_global';
      const maxTotalUses = singleGlobalUse
        ? 1
        : (formMaxUses.trim() ? Math.max(1, toSafeInt(formMaxUses, 1)) : null);

      if (!code || code.length < 3) {
        throw new Error('Le code doit contenir au moins 3 caractères.');
      }
      if (bonusMoney <= 0 && selectedBadgeIds.length === 0) {
        throw new Error('Choisis un badge et/ou un montant à offrir.');
      }
      if (!validFromIso) {
        throw new Error('La date de début est invalide.');
      }
      if (validUntilIso && new Date(validUntilIso).getTime() < new Date(validFromIso).getTime()) {
        throw new Error('La date de fin doit être postérieure à la date de début.');
      }

      const payload = {
        code,
        label: label || null,
        description: description || null,
        bonus_money: bonusMoney,
        bonus_badge_id: bonusBadgeId,
        bonus_badge_ids: selectedBadgeIds,
        valid_from: validFromIso,
        valid_until: validUntilIso,
        is_enabled: Boolean(formEnabled),
        single_global_use: singleGlobalUse,
        max_total_uses: maxTotalUses,
        limit_per_account: true,
        limit_per_device: singleGlobalUse ? false : Boolean(formLimitPerDevice),
        limit_per_ip: singleGlobalUse ? false : Boolean(formLimitPerIp),
        created_by: currentUserId || null,
        updated_by: currentUserId || null,
        updated_at: new Date().toISOString(),
      };

      const { error } = await supabase.from('surprise_codes_reborn').insert(payload);
      if (!error) return;

      const message = String(error?.message || '').toLowerCase();
      const missingArrayColumn = error?.code === '42703' || message.includes('bonus_badge_ids');
      if (!missingArrayColumn) throw error;

      const fallbackPayload = {
        ...payload,
        bonus_badge_id: bonusBadgeId,
      };
      delete fallbackPayload.bonus_badge_ids;

      const { error: fallbackError } = await supabase.from('surprise_codes_reborn').insert(fallbackPayload);
      if (fallbackError) throw fallbackError;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ADMIN_SURPRISE_CODES_QUERY_KEY });
      setFeedback({ type: 'success', message: 'Code surprise créé.' });
      setFormCode('');
      setFormLabel('');
      setFormDescription('');
      setFormBonusMoney('0');
      setFormBadgeSearch('');
      setFormSelectedBadgeIds([]);
      setFormValidFrom(toDateInputValue(new Date().toISOString()));
      setFormValidUntil('');
      setFormMode('multi_limited');
      setFormMaxUses('');
      setFormLimitPerDevice(true);
      setFormLimitPerIp(true);
      setFormEnabled(true);
    },
    onError: (error) => {
      setFeedback({ type: 'error', message: error?.message || 'Impossible de créer ce code.' });
    },
  });

  const toggleEnabledMutation = useMutation({
    mutationFn: async ({ codeId, nextEnabled }) => {
      const { error } = await supabase
        .from('surprise_codes_reborn')
        .update({
          is_enabled: nextEnabled,
          updated_by: currentUserId || null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', codeId);
      if (error) throw error;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ADMIN_SURPRISE_CODES_QUERY_KEY });
      setFeedback({
        type: 'success',
        message: variables.nextEnabled ? 'Code activé.' : 'Code désactivé.',
      });
    },
    onError: (error) => {
      setFeedback({ type: 'error', message: error?.message || 'Impossible de modifier ce code.' });
    },
  });

  const deleteCodeMutation = useMutation({
    mutationFn: async ({ codeId }) => {
      const { error } = await supabase
        .from('surprise_codes_reborn')
        .delete()
        .eq('id', codeId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ADMIN_SURPRISE_CODES_QUERY_KEY });
      setConfirmDeleteCodeId('');
      setFeedback({ type: 'success', message: 'Code supprimé.' });
    },
    onError: (error) => {
      setFeedback({ type: 'error', message: error?.message || 'Impossible de supprimer ce code.' });
    },
  });

  const rows = surpriseCodesQuery.data || [];
  const isMutating = createCodeMutation.isPending || toggleEnabledMutation.isPending || deleteCodeMutation.isPending;

  const globalStats = useMemo(() => {
    const totalUsages = rows.reduce((sum, row) => sum + Number(row.usageCount || 0), 0);
    const totalMoney = rows.reduce((sum, row) => sum + Number(row.distributedMoney || 0), 0);
    const totalBadges = rows.reduce((sum, row) => sum + Number(row.distributedBadges || 0), 0);
    const activeCodes = rows.filter((row) => row.is_enabled).length;
    return {
      totalUsages,
      totalMoney,
      totalBadges,
      activeCodes,
    };
  }, [rows]);

  const badgeById = useMemo(() => {
    const map = new Map();
    (badgeChoicesQuery.data || []).forEach((badge) => {
      map.set(badge.id, badge);
    });
    return map;
  }, [badgeChoicesQuery.data]);

  const filteredBadgeChoices = useMemo(() => {
    const needle = String(formBadgeSearch || '').trim().toLowerCase();
    const rows = badgeChoicesQuery.data || [];
    if (!needle) return rows.slice(0, 20);
    return rows
      .filter((badge) => {
        const haystack = `${badge.name || ''} ${badge.filename || ''} ${badge.rarity || ''}`.toLowerCase();
        return haystack.includes(needle);
      })
      .slice(0, 20);
  }, [badgeChoicesQuery.data, formBadgeSearch]);

  const selectedBadges = useMemo(() => {
    return formSelectedBadgeIds
      .map((badgeId) => badgeById.get(badgeId))
      .filter(Boolean);
  }, [badgeById, formSelectedBadgeIds]);

  const handleRefresh = async () => {
    setRefreshSpinTick((value) => value + 1);
    setFeedback({ type: '', message: '' });
    await Promise.all([badgeChoicesQuery.refetch(), surpriseCodesQuery.refetch()]);
  };

  const addBadgeToSelection = (badgeId) => {
    setFormSelectedBadgeIds((current) => {
      if (current.includes(badgeId)) return current;
      return [...current, badgeId];
    });
  };

  const removeBadgeFromSelection = (badgeId) => {
    setFormSelectedBadgeIds((current) => current.filter((id) => id !== badgeId));
  };

  const toggleExpandedCode = (codeId) => {
    setExpandedCodeIds((current) => {
      if (current.includes(codeId)) {
        return current.filter((id) => id !== codeId);
      }
      return [...current, codeId];
    });
  };

  useEffect(() => {
    return () => {
      if (copyResetTimeoutRef.current) {
        clearTimeout(copyResetTimeoutRef.current);
      }
    };
  }, []);

  const markCopiedState = (key) => {
    if (copyResetTimeoutRef.current) {
      clearTimeout(copyResetTimeoutRef.current);
    }
    setCopiedLinkKey(key);
    copyResetTimeoutRef.current = setTimeout(() => {
      setCopiedLinkKey('');
      copyResetTimeoutRef.current = null;
    }, 1200);
  };

  const copyCodeLink = async (codeValue, key) => {
    const link = buildSurpriseLink(codeValue);
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      markCopiedState(key);
    } catch {
      setFeedback({ type: 'error', message: 'Impossible de copier le lien.' });
    }
  };

  const previewLink = buildSurpriseLink(formCode);

  return (
    <div className="settings-section">
      <h3 className="settings-section-title">Codes surprise</h3>
      <div className="settings-admin-toolbar settings-admin-toolbar--badges">
        <div className="settings-admin-search-wrap">
          <p className="settings-item-subtitle">
            Configure les bonus de campagne (QR code + saisie manuelle PC). Le code est appliqué lors de l'inscription.
          </p>
          <div className="settings-admin-surprise-stats">
            <span className="settings-admin-surprise-stat-pill">Codes actifs: {globalStats.activeCodes}</span>
            <span className="settings-admin-surprise-stat-pill">Utilisations: {globalStats.totalUsages}</span>
            <span className="settings-admin-surprise-stat-pill">Argent distribué: {globalStats.totalMoney}</span>
            <span className="settings-admin-surprise-stat-pill">Badges distribués: {globalStats.totalBadges}</span>
          </div>
        </div>
        <button
          type="button"
          className="settings-admin-refresh-icon-btn"
          onClick={handleRefresh}
          aria-label="Rafraîchir les codes surprise"
          disabled={surpriseCodesQuery.isFetching || badgeChoicesQuery.isFetching || isMutating}
        >
          <RefreshCcw
            key={`surprise-codes-refresh-${refreshSpinTick}`}
            size={16}
            className={`settings-admin-refresh-icon ${refreshSpinTick > 0 ? 'is-spinning' : ''}`}
          />
        </button>
      </div>

      {feedback.message ? (
        <p className={`settings-admin-feedback ${feedback.type === 'error' ? 'is-error' : 'is-success'}`}>
          {feedback.message}
        </p>
      ) : null}

      <div className="settings-admin-badges-create">
        <h4 className="settings-item-title">Créer un code surprise</h4>
        <div className="settings-admin-badges-form-grid">
          <label className="settings-admin-badge-label">
            Code surprise
            <input
              type="text"
              className="settings-admin-badge-input"
              placeholder="Ex: ISABELLA2026"
              value={formCode}
              onChange={(event) => setFormCode(normalizeCodeInput(event.target.value))}
              disabled={createCodeMutation.isPending}
            />
            {previewLink ? (
              <span className="settings-admin-surprise-link-preview">
                <span>{previewLink}</span>
                <button
                  type="button"
                  className={`settings-action settings-action--tiny ${copiedLinkKey === 'preview' ? 'settings-action--copied' : ''}`}
                  onClick={() => copyCodeLink(formCode, 'preview')}
                  disabled={createCodeMutation.isPending}
                >
                  {copiedLinkKey === 'preview' ? 'Copié !' : 'Copier lien'}
                </button>
              </span>
            ) : null}
          </label>

          <label className="settings-admin-badge-label">
            Libellé campagne (optionnel)
            <input
              type="text"
              className="settings-admin-badge-input"
              placeholder="Ex: 1 an de FarmGestion"
              value={formLabel}
              onChange={(event) => setFormLabel(event.target.value)}
              disabled={createCodeMutation.isPending}
            />
          </label>

          <label className="settings-admin-badge-label settings-admin-surprise-description-field">
            Description interne (privée)
            <textarea
              className="settings-admin-badge-input settings-admin-surprise-description-input"
              placeholder="Ex: Lien de référence QR code situé à Toulouse"
              value={formDescription}
              onChange={(event) => setFormDescription(event.target.value)}
              disabled={createCodeMutation.isPending}
            />
          </label>

          <label className="settings-admin-badge-label">
            Bonus argent
            <input
              type="number"
              min="0"
              className="settings-admin-badge-input"
              value={formBonusMoney}
              onChange={(event) => setFormBonusMoney(event.target.value)}
              disabled={createCodeMutation.isPending}
            />
          </label>

          <div className="settings-admin-badge-label settings-admin-surprise-badges-field">
            Bonus badges (optionnel, plusieurs possibles)
            <input
              type="search"
              className="settings-admin-badge-input"
              placeholder="Tape un nom de badge..."
              value={formBadgeSearch}
              onChange={(event) => setFormBadgeSearch(event.target.value)}
              disabled={createCodeMutation.isPending || badgeChoicesQuery.isLoading}
            />
            <div className="settings-admin-surprise-badge-results">
              {filteredBadgeChoices.map((badge) => {
                const isSelected = formSelectedBadgeIds.includes(badge.id);
                return (
                  <button
                    key={badge.id}
                    type="button"
                    className={`settings-admin-surprise-badge-option ${isSelected ? 'is-selected' : ''}`}
                    onClick={() => (isSelected ? removeBadgeFromSelection(badge.id) : addBadgeToSelection(badge.id))}
                    disabled={createCodeMutation.isPending}
                  >
                    <img
                      src={getBadgeImageUrl(badge.filename, badge.rarity)}
                      alt={badge.name || badge.filename}
                      width={24}
                      height={24}
                    />
                    <span>{(badge.name || badge.filename) + ' - ' + (badge.rarity || 'inconnu')}</span>
                  </button>
                );
              })}
            </div>
            {selectedBadges.length ? (
              <div className="settings-admin-surprise-badge-selected">
                {selectedBadges.map((badge) => (
                  <button
                    key={`selected-${badge.id}`}
                    type="button"
                    className="settings-admin-surprise-badge-chip"
                    onClick={() => removeBadgeFromSelection(badge.id)}
                    disabled={createCodeMutation.isPending}
                  >
                    <img
                      src={getBadgeImageUrl(badge.filename, badge.rarity)}
                      alt={badge.name || badge.filename}
                      width={20}
                      height={20}
                    />
                    <span>{badge.name || badge.filename}</span>
                    <span aria-hidden="true">×</span>
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          <label className="settings-admin-badge-label">
            Valide du
            <input
              type="date"
              className="settings-admin-badge-input"
              value={formValidFrom}
              onChange={(event) => setFormValidFrom(event.target.value)}
              disabled={createCodeMutation.isPending}
            />
          </label>

          <label className="settings-admin-badge-label">
            Valide au (optionnel)
            <input
              type="date"
              className="settings-admin-badge-input"
              value={formValidUntil}
              onChange={(event) => setFormValidUntil(event.target.value)}
              disabled={createCodeMutation.isPending}
            />
          </label>

          <label className="settings-admin-badge-label">
            Mode d'utilisation
            <select
              className="settings-admin-badge-input"
              value={formMode}
              onChange={(event) => setFormMode(event.target.value)}
              disabled={createCodeMutation.isPending}
            >
              <option value="single_global">Usage unique global (1 seule personne)</option>
              <option value="multi_limited">Multi-usage limité (1 fois par compte)</option>
            </select>
          </label>

          <label className="settings-admin-badge-label">
            Limite totale (optionnel)
            <input
              type="number"
              min="1"
              className="settings-admin-badge-input"
              placeholder={formMode === 'single_global' ? 'Fixé à 1' : 'Ex: 250'}
              value={formMode === 'single_global' ? '1' : formMaxUses}
              onChange={(event) => setFormMaxUses(event.target.value)}
              disabled={createCodeMutation.isPending || formMode === 'single_global'}
            />
          </label>
        </div>

        <div className="settings-admin-badge-source-switch">
          <label className="settings-modal-checkbox-like">
            <input
              type="checkbox"
              checked={formEnabled}
              onChange={(event) => setFormEnabled(event.target.checked)}
              disabled={createCodeMutation.isPending}
            />
            <span>Code actif</span>
          </label>

          <label className="settings-modal-checkbox-like">
            <input
              type="checkbox"
              checked={formLimitPerDevice}
              onChange={(event) => setFormLimitPerDevice(event.target.checked)}
              disabled={createCodeMutation.isPending || formMode === 'single_global'}
            />
            <span>Limiter à 1 usage par appareil</span>
          </label>

          <label className="settings-modal-checkbox-like">
            <input
              type="checkbox"
              checked={formLimitPerIp}
              onChange={(event) => setFormLimitPerIp(event.target.checked)}
              disabled={createCodeMutation.isPending || formMode === 'single_global'}
            />
            <span>Limiter à 1 usage par IP</span>
          </label>
        </div>

        <div className="settings-admin-badges-create-actions">
          <button
            type="button"
            className="settings-action settings-action--primary"
            onClick={() => createCodeMutation.mutate()}
            disabled={createCodeMutation.isPending}
          >
            {createCodeMutation.isPending ? 'Création...' : 'Créer le code'}
          </button>
        </div>
      </div>

      {surpriseCodesQuery.isLoading ? (
        <p className="settings-item-subtitle">Chargement des codes surprise...</p>
      ) : surpriseCodesQuery.isError ? (
        <p className="settings-admin-feedback is-error">
          {surpriseCodesQuery.error?.message || 'Impossible de charger les codes surprise. As-tu appliqué la migration SQL ?'}
        </p>
      ) : !rows.length ? (
        <p className="settings-item-subtitle">Aucun code surprise configuré pour le moment.</p>
      ) : (
        <div className="settings-admin-surprise-codes-list">
          {rows.map((row) => {
            const isSingle = Boolean(row.single_global_use);
            const rowBadgeIds = [
              ...toArray(row.bonus_badge_ids),
              row.bonus_badge_id,
            ].filter(Boolean);
            const uniqueRowBadgeIds = Array.from(new Set(rowBadgeIds));
            const usageLimit = getUsageLimit(row);
            const totalLimitLabel = usageLimit ? String(usageLimit) : 'Illimité';
            const usageRatio = getUsageRatio(row.usageCount, usageLimit);
            const validityRatio = getValidityRatio(row.valid_from, row.valid_until);
            const nowTimestamp = Date.now();
            const validFromTimestamp = new Date(row.valid_from).getTime();
            const validUntilTimestamp = row.valid_until ? new Date(row.valid_until).getTime() : null;
            const isExpired = Number.isFinite(validUntilTimestamp) && validUntilTimestamp < nowTimestamp;
            const isNotStarted = Number.isFinite(validFromTimestamp) && validFromTimestamp > nowTimestamp;
            const isExhausted = usageLimit ? Number(row.usageCount || 0) >= usageLimit : false;
            const isCurrentlyUsable = row.is_enabled && !isExpired && !isNotStarted && !isExhausted;
            const isExpanded = expandedCodeIds.includes(row.id);
            const isDeleteConfirmOpen = confirmDeleteCodeId === row.id;
            const linkValue = buildSurpriseLink(row.code);
            const copyStateKey = `code-${row.id}`;
            const isLinkCopied = copiedLinkKey === copyStateKey;
            const badgeRows = uniqueRowBadgeIds
              .map((badgeId) => ({ badgeId, badge: badgeById.get(badgeId) }))
              .filter((entry) => Boolean(entry.badge));
            const previewBadges = badgeRows.slice(0, 3);
            const hiddenBadges = badgeRows.slice(3);
            const hiddenBadgeLabel = hiddenBadges
              .map((entry) => entry.badge?.name || entry.badge?.filename || entry.badgeId)
              .join(', ');
            const validityEndLabel = formatDateLabel(row.valid_until) === '-' ? '∞' : formatDateLabel(row.valid_until);

            return (
              <article key={row.id} className="settings-admin-surprise-card">
                <button
                  type="button"
                  className={`settings-admin-badge-delete-icon-btn ${isDeleteConfirmOpen ? 'is-active' : ''}`}
                  onClick={() => setConfirmDeleteCodeId((current) => (current === row.id ? '' : row.id))}
                  disabled={isMutating}
                  aria-label={isDeleteConfirmOpen ? 'Annuler suppression du code' : 'Supprimer le code'}
                  title={isDeleteConfirmOpen ? 'Annuler suppression du code' : 'Supprimer le code'}
                >
                  ×
                </button>

                <div className="settings-admin-surprise-card-head">
                  <div className="settings-admin-surprise-card-title-wrap">
                    <p className="settings-item-title">{row.code}</p>
                    <p className="settings-item-subtitle">{row.label || 'Sans libellé public'}</p>
                  </div>
                </div>

                <div className="settings-admin-surprise-chip-row">
                  <span className={`settings-admin-surprise-status ${isCurrentlyUsable ? 'is-live' : 'is-paused'}`}>
                    {isExpired ? 'Expiré' : isNotStarted ? 'Bientôt actif' : isCurrentlyUsable ? 'Actif' : 'Inactif'}
                  </span>
                  <span className="settings-admin-surprise-mode-chip">
                    {isSingle ? 'Unique global' : 'Multi limité'}
                  </span>
                </div>

                <div className="settings-admin-surprise-link-row">
                  <input
                    type="text"
                    className="settings-admin-badge-input"
                    readOnly
                    value={linkValue}
                    onFocus={(event) => event.target.select()}
                  />
                  <button
                    type="button"
                    className={`settings-admin-surprise-copy-btn ${isLinkCopied ? 'is-copied' : ''}`}
                    onClick={() => copyCodeLink(row.code, copyStateKey)}
                    disabled={isMutating}
                  >
                    {isLinkCopied ? 'Copié !' : 'Copier lien'}
                  </button>
                </div>

                <div className="settings-admin-surprise-reward-grid">
                  <div className="settings-admin-surprise-reward-item">
                    <span className="settings-admin-surprise-reward-label">Bonus argent</span>
                    <strong className="settings-admin-surprise-reward-value">
                      {Number(row.bonus_money || 0) > 0 ? `+${Number(row.bonus_money || 0)} 💸` : '0'}
                    </strong>
                  </div>

                  <div className="settings-admin-surprise-reward-item settings-admin-surprise-reward-item--badges">
                    <span className="settings-admin-surprise-reward-label">Bonus badges</span>
                    {previewBadges.length ? (
                      <div className="settings-admin-surprise-badge-stack">
                        {previewBadges.map(({ badgeId, badge }) => (
                          <img
                            key={`${row.id}-${badgeId}`}
                            src={getBadgeImageUrl(badge.filename, badge.rarity)}
                            alt={badge.name || badge.filename}
                            title={badge.name || badge.filename}
                            width={28}
                            height={28}
                          />
                        ))}
                        {hiddenBadges.length ? (
                          <span className="settings-admin-surprise-badge-overflow" title={hiddenBadgeLabel}>
                            +{hiddenBadges.length}
                            <span className="settings-admin-surprise-badge-overflow-popover">{hiddenBadgeLabel}</span>
                          </span>
                        ) : null}
                      </div>
                    ) : (
                      <strong className="settings-admin-surprise-reward-value">Aucun</strong>
                    )}
                  </div>
                </div>

                <div className="settings-admin-surprise-footer-row">
                  <p className="settings-item-subtitle settings-admin-surprise-distributed">
                    Distribué: {Number(row.distributedMoney || 0)} argent · {Number(row.distributedBadges || 0)} badges
                  </p>
                  <button
                    type="button"
                    className="settings-action settings-action--tiny"
                    onClick={() => toggleExpandedCode(row.id)}
                    disabled={isMutating}
                  >
                    {isExpanded ? 'Masquer détails' : 'Voir détails'}
                  </button>
                </div>

                {isExpanded ? (
                  <div className="settings-admin-surprise-details">
                    <p className="settings-item-subtitle">
                      Mode: {isSingle ? 'Usage unique global' : 'Multi limité'} · Anti-abus: compte={row.limit_per_account ? 'oui' : 'non'} · appareil={row.limit_per_device ? 'oui' : 'non'} · ip={row.limit_per_ip ? 'oui' : 'non'}
                    </p>
                    <p className="settings-item-subtitle">
                      Dernière utilisation: {row.lastUsedAt ? formatDateLabel(row.lastUsedAt, { dateStyle: 'short', timeStyle: 'short' }) : 'Jamais'}
                    </p>
                    <details className="settings-admin-surprise-description" open={Boolean(row.description)}>
                      <summary>Description interne</summary>
                      <p>{row.description || 'Aucune description interne renseignée.'}</p>
                    </details>
                  </div>
                ) : null}

                {isDeleteConfirmOpen ? (
                  <div className="settings-admin-badge-delete-confirm" role="alert">
                    <p className="settings-admin-badge-delete-confirm-text">Supprimer définitivement le code {row.code} ?</p>
                    <div className="settings-admin-badge-delete-confirm-actions">
                      <button
                        type="button"
                        className="settings-action settings-action--ghost settings-action--tiny"
                        onClick={() => setConfirmDeleteCodeId('')}
                        disabled={isMutating}
                      >
                        Annuler
                      </button>
                      <button
                        type="button"
                        className="settings-action settings-action--tiny"
                        onClick={() => deleteCodeMutation.mutate({ codeId: row.id })}
                        disabled={isMutating}
                      >
                        Confirmer
                      </button>
                    </div>
                  </div>
                ) : null}

                <div className="settings-admin-surprise-metrics-grid settings-admin-surprise-metrics-grid--bottom">
                  <div className="settings-admin-surprise-metric">
                    <div className="settings-admin-surprise-metric-line">
                      <span className="settings-admin-surprise-metric-label">Utilisation</span>
                      <strong>{row.usageCount}/{totalLimitLabel}</strong>
                    </div>
                    {usageRatio !== null ? (
                      <div className="settings-admin-surprise-meter">
                        <span style={{ width: `${usageRatio}%` }} />
                      </div>
                    ) : null}
                  </div>

                  <div className="settings-admin-surprise-metric">
                    <div className="settings-admin-surprise-metric-line settings-admin-surprise-metric-line--validity">
                      <span className="settings-admin-surprise-metric-label">Validité</span>
                      <strong
                        className="settings-admin-surprise-validity-text"
                        title={`${formatDateLabel(row.valid_from)} -> ${validityEndLabel}`}
                      >
                        {`${formatDateLabel(row.valid_from)} → ${validityEndLabel}`}
                      </strong>
                    </div>
                    {validityRatio !== null ? (
                      <div className="settings-admin-surprise-meter is-validity">
                        <span style={{ width: `${validityRatio}%` }} />
                      </div>
                    ) : null}
                  </div>
                </div>

                <div className="settings-admin-surprise-toggle-bottom">
                  <span className="settings-admin-surprise-toggle-label">Activer ou désactiver</span>
                  <label className={`settings-switch ${toggleEnabledMutation.isPending ? 'is-busy' : ''}`}>
                    <input
                      type="checkbox"
                      checked={Boolean(row.is_enabled)}
                      onChange={(event) => toggleEnabledMutation.mutate({ codeId: row.id, nextEnabled: event.target.checked })}
                      disabled={isMutating}
                    />
                    <span className="settings-slider" />
                  </label>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default Settings_AdminSurpriseCodesPanel;
