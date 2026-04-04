import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { RefreshCcw } from 'lucide-react';
import { supabase } from '../authentification/supabaseClient';
import { createSafeAudio, playAudioSafely } from '../utils/safeAudio';
import cancelConfirmedSound from '../../assets/sounds/00111 - WAV_111_GUESS_BNK_SE_COMMON.wav';

const PAGE_SIZE = 8;
const SEARCH_DEBOUNCE_MS = 280;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const ADMIN_SHIPPING_QUERY_KEY = ['settings', 'admin', 'shipping-expeditions'];

const normalizeSearchTerm = (value) =>
  String(value || '')
    .replace(/[(),]/g, ' ')
    .replace(/[%_]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);

const toAvatarFallback = (name) => {
  const safe = String(name || '').trim();
  if (!safe) return '?';
  return safe.slice(0, 1).toUpperCase();
};

const formatShippingDate = (isoValue) => {
  const date = new Date(isoValue);
  if (Number.isNaN(date.getTime())) return 'Date invalide';
  return new Intl.DateTimeFormat('fr-FR', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
};

const getRemainingDays = (isoValue) => {
  const date = new Date(isoValue);
  if (Number.isNaN(date.getTime())) return null;
  return Math.max(0, Math.ceil((date.getTime() - Date.now()) / MS_PER_DAY));
};

const formatRemainingLabel = (remainingDays) => {
  if (!Number.isFinite(remainingDays)) return 'Inconnu';
  if (remainingDays <= 0) return 'Aujourd\'hui';
  if (remainingDays === 1) return '1 jour';
  return `${remainingDays} jours`;
};

const toDateInputValue = (isoValue) => {
  if (!isoValue) return '';
  const date = new Date(isoValue);
  if (Number.isNaN(date.getTime())) return '';
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const toNoonIso = (dateValue) => {
  if (!dateValue) return null;
  const localDate = new Date(`${dateValue}T12:00:00`);
  if (Number.isNaN(localDate.getTime())) return null;
  return localDate.toISOString();
};

const buildOwnerClause = (ownerIds) => {
  if (!ownerIds.length) return '';
  return `,owner_id.in.(${ownerIds.join(',')})`;
};

const extractBetailRow = (shippingRow) => {
  if (Array.isArray(shippingRow?.betails)) {
    return shippingRow.betails[0] || null;
  }
  return shippingRow?.betails || null;
};

const fetchMatchingOwnerIds = async (normalizedSearch) => {
  if (!normalizedSearch) return [];

  const { data, error } = await supabase
    .from('users_profiles')
    .select('id')
    .ilike('username', `%${normalizedSearch}%`)
    .limit(100);

  if (error || !Array.isArray(data)) return [];
  return Array.from(new Set(data.map((row) => row?.id).filter(Boolean)));
};

const fetchAdminShippingPage = async ({ page, searchTerm }) => {
  const safePage = Number.isInteger(page) && page >= 0 ? page : 0;
  const normalizedSearch = normalizeSearchTerm(searchTerm);
  const normalizedNeedle = normalizedSearch.toLowerCase();
  const searchPattern = normalizedSearch ? `%${normalizedSearch.replace(/\s+/g, '%')}%` : '';

  let ownerIdsFilter = [];
  if (normalizedSearch) {
    ownerIdsFilter = await fetchMatchingOwnerIds(normalizedSearch);
  }

  const from = safePage * PAGE_SIZE;
  const to = from + PAGE_SIZE;

  let query = supabase
    .from('shipping')
    .select('id, betail_id, scheduled_for, status, betails(id, name, matricule, avatar_url, owner_id)')
    .eq('status', 'scheduled')
    .gte('scheduled_for', new Date().toISOString())
    .order('scheduled_for', { ascending: true })
    .range(from, to);

  if (searchPattern) {
    const ownerClause = buildOwnerClause(ownerIdsFilter);
    query = query.or(`name.ilike.${searchPattern},matricule.ilike.${searchPattern}${ownerClause}`, {
      foreignTable: 'betails',
    });
  }

  const { data, error } = await query;
  if (error) {
    throw error;
  }

  const rows = Array.isArray(data) ? data : [];
  const hasNextPage = rows.length > PAGE_SIZE;
  const currentRows = rows.slice(0, PAGE_SIZE);

  const ownerIds = Array.from(
    new Set(
      currentRows
        .map((shippingRow) => extractBetailRow(shippingRow)?.owner_id)
        .filter(Boolean),
    ),
  );

  let ownerById = new Map();
  if (ownerIds.length) {
    const { data: ownerRows, error: ownerError } = await supabase
      .from('users_profiles')
      .select('id, username')
      .in('id', ownerIds);

    if (!ownerError) {
      ownerById = new Map((ownerRows || []).map((row) => [row.id, row.username || 'Inconnu']));
    }
  }

  const mappedItems = currentRows.map((shippingRow) => {
    const betail = extractBetailRow(shippingRow);
    const remainingDays = getRemainingDays(shippingRow?.scheduled_for);
    const ownerId = betail?.owner_id || null;
    const ownerLabel = ownerById.get(ownerId) || (ownerId ? ownerId.slice(0, 8) : 'Sans propriétaire');

    return {
      shippingId: shippingRow?.id,
      betailId: shippingRow?.betail_id || null,
      name: betail?.name || 'Bétail inconnu',
      matricule: betail?.matricule || '—',
      avatarUrl: betail?.avatar_url || '',
      owner: ownerLabel,
      scheduledFor: shippingRow?.scheduled_for,
      remainingDays,
      isKnownBetail: Boolean(betail),
    };
  });

  const items = normalizedNeedle
    ? mappedItems.filter((item) => {
      if (!item.isKnownBetail) return false;
      const searchable = `${item.name} ${item.matricule} ${item.owner}`.toLowerCase();
      return searchable.includes(normalizedNeedle);
    })
    : mappedItems;

  return {
    items,
    hasNextPage,
  };
};

function Settings_AdminShippingPanel({ isActive, isAdmin }) {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(0);
  const [searchInput, setSearchInput] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [editingShippingId, setEditingShippingId] = useState(null);
  const [confirmCancelShippingId, setConfirmCancelShippingId] = useState(null);
  const [editingDate, setEditingDate] = useState('');
  const [refreshSpinTick, setRefreshSpinTick] = useState(0);
  const [feedback, setFeedback] = useState({ type: '', message: '' });

  const playCancelConfirmedSound = () => {
    try {
      const audio = createSafeAudio(cancelConfirmedSound, { volume: 0.75 });
      void playAudioSafely(audio);
    } catch {
      // Sound playback can fail silently on some browsers/user-gesture policies.
    }
  };

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setPage(0);
      setSearchTerm(normalizeSearchTerm(searchInput));
      setConfirmCancelShippingId(null);
    }, SEARCH_DEBOUNCE_MS);

    return () => window.clearTimeout(timeoutId);
  }, [searchInput]);

  const expeditionsQuery = useQuery({
    queryKey: [...ADMIN_SHIPPING_QUERY_KEY, page, searchTerm],
    queryFn: () => fetchAdminShippingPage({ page, searchTerm }),
    enabled: Boolean(isActive && isAdmin),
    staleTime: 30_000,
    gcTime: 300_000,
    retry: 1,
    placeholderData: (previousData) => previousData,
    refetchOnWindowFocus: false,
  });

  const updateDateMutation = useMutation({
    mutationFn: async ({ shippingId, nextDate }) => {
      const nextIso = toNoonIso(nextDate);
      if (!nextIso) {
        throw new Error('Date invalide');
      }

      const { error } = await supabase
        .from('shipping')
        .update({
          scheduled_for: nextIso,
          updated_at: new Date().toISOString(),
        })
        .eq('id', shippingId);

      if (error) throw error;
      return { shippingId };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ADMIN_SHIPPING_QUERY_KEY });
      setFeedback({ type: 'success', message: 'Date d’expédition mise à jour.' });
      setEditingShippingId(null);
      setEditingDate('');
    },
    onError: (error) => {
      setFeedback({
        type: 'error',
        message: error?.message || 'Impossible de modifier la date d’expédition.',
      });
    },
  });

  const cancelShippingMutation = useMutation({
    mutationFn: async ({ shippingId }) => {
      const { error } = await supabase
        .from('shipping')
        .delete()
        .eq('id', shippingId);
      if (error) throw error;
      return { shippingId };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ADMIN_SHIPPING_QUERY_KEY });
      setFeedback({ type: 'success', message: 'Expédition annulée.' });
      playCancelConfirmedSound();
      setEditingShippingId(null);
      setConfirmCancelShippingId(null);
      setEditingDate('');
    },
    onError: (error) => {
      setFeedback({
        type: 'error',
        message: error?.message || 'Impossible d’annuler cette expédition.',
      });
      setConfirmCancelShippingId(null);
    },
  });

  const isMutating = updateDateMutation.isPending || cancelShippingMutation.isPending;
  const rows = expeditionsQuery.data?.items || [];
  const hasNextPage = Boolean(expeditionsQuery.data?.hasNextPage);

  const emptyLabel = useMemo(() => {
    if (searchTerm) return 'Aucune expédition trouvée pour cette recherche.';
    return 'Aucune expédition future programmée.';
  }, [searchTerm]);

  const handleUpdateClick = (row) => {
    if (!row?.shippingId) return;
    setConfirmCancelShippingId(null);

    if (editingShippingId !== row.shippingId) {
      setEditingShippingId(row.shippingId);
      setEditingDate(toDateInputValue(row.scheduledFor));
      setFeedback({ type: '', message: '' });
      return;
    }

    if (!editingDate) {
      setFeedback({ type: 'error', message: 'Sélectionne une date avant de valider.' });
      return;
    }

    updateDateMutation.mutate({ shippingId: row.shippingId, nextDate: editingDate });
  };

  const handleCancelShipping = (row) => {
    if (!row?.shippingId) return;

    if (confirmCancelShippingId !== row.shippingId) {
      setConfirmCancelShippingId(row.shippingId);
      return;
    }

    cancelShippingMutation.mutate({ shippingId: row.shippingId });
  };

  const handleRefresh = async () => {
    setFeedback({ type: '', message: '' });
    setConfirmCancelShippingId(null);
    setRefreshSpinTick((value) => value + 1);
    await expeditionsQuery.refetch();
  };

  return (
    <div className="settings-section">
      <h3 className="settings-section-title">Expeditions</h3>
      <div className="settings-admin-toolbar">
        <input
          type="search"
          className="settings-admin-search"
          placeholder="Rechercher par nom, matricule ou owner..."
          value={searchInput}
          onChange={(event) => setSearchInput(event.target.value)}
          aria-label="Recherche des expéditions"
        />
        <button
          type="button"
          className="settings-admin-refresh-icon-btn"
          onClick={handleRefresh}
          aria-label="Rafraîchir les expéditions"
          disabled={expeditionsQuery.isFetching || isMutating}
        >
          <RefreshCcw
            key={`shipping-refresh-${refreshSpinTick}`}
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

      {expeditionsQuery.isLoading ? (
        <p className="settings-item-subtitle">Chargement des expéditions...</p>
      ) : expeditionsQuery.isError ? (
        <p className="settings-admin-feedback is-error">
          {expeditionsQuery.error?.message || 'Impossible de charger les expéditions.'}
        </p>
      ) : rows.length === 0 ? (
        <p className="settings-item-subtitle">{emptyLabel}</p>
      ) : (
        <div className="settings-admin-shipping-list">
          {rows.map((row) => {
            const isEditing = editingShippingId === row.shippingId;
            return (
              <article key={row.shippingId} className="settings-admin-shipping-row">
                <div className="settings-admin-shipping-main">
                  <div className="settings-admin-shipping-avatar" aria-hidden="true">
                    {row.avatarUrl ? (
                      <img src={row.avatarUrl} alt="" loading="lazy" decoding="async" />
                    ) : (
                      <span>{toAvatarFallback(row.name)}</span>
                    )}
                  </div>

                  <div className="settings-admin-shipping-info">
                    <p className="settings-admin-shipping-title">{row.name}</p>
                    <p className="settings-admin-shipping-meta">
                      Matricule: {row.matricule} · Owner: {row.owner}
                    </p>
                    <p className="settings-admin-shipping-meta">
                      Prévu le {formatShippingDate(row.scheduledFor)} · Reste: {formatRemainingLabel(row.remainingDays)}
                    </p>

                    {isEditing ? (
                      <div className="settings-admin-edit-box">
                        <input
                          type="date"
                          className="settings-admin-date-input"
                          value={editingDate}
                          onChange={(event) => setEditingDate(event.target.value)}
                          min={toDateInputValue(new Date().toISOString())}
                          disabled={isMutating}
                          aria-label={`Nouvelle date pour ${row.name}`}
                        />
                      </div>
                    ) : null}
                  </div>
                </div>

                <div className="settings-admin-shipping-actions">
                  <button
                    type="button"
                    className="settings-admin-btn settings-admin-btn--modify"
                    onClick={() => handleUpdateClick(row)}
                    disabled={isMutating}
                  >
                    {isEditing ? 'Valider' : 'Modifier'}
                  </button>
                  <button
                    type="button"
                    className="settings-admin-btn settings-admin-btn--cancel"
                    onClick={() => handleCancelShipping(row)}
                    disabled={isMutating}
                  >
                    {confirmCancelShippingId === row.shippingId ? 'Confirmer?' : 'Annuler'}
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}

      <div className="settings-admin-pagination">
        <button
          type="button"
          className="settings-action"
          onClick={() => setPage((value) => Math.max(0, value - 1))}
          disabled={page === 0 || expeditionsQuery.isLoading || isMutating}
        >
          Précédent
        </button>
        <span className="settings-item-subtitle">Page {page + 1}</span>
        <button
          type="button"
          className="settings-action"
          onClick={() => setPage((value) => value + 1)}
          disabled={!hasNextPage || expeditionsQuery.isLoading || isMutating}
        >
          Suivant
        </button>
      </div>
    </div>
  );
}

export default Settings_AdminShippingPanel;
