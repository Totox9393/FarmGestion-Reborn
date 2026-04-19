import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { RefreshCcw } from 'lucide-react';
import { supabase } from '../authentification/supabaseClient';

const PAGE_SIZE = 8;
const SEARCH_DEBOUNCE_MS = 280;
const ADMIN_INVISIBLE_BETAILS_QUERY_KEY = ['settings', 'admin', 'invisible-betails'];

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

const formatInvisibleDate = (isoValue) => {
  const date = new Date(isoValue);
  if (Number.isNaN(date.getTime())) return 'Date inconnue';
  return new Intl.DateTimeFormat('fr-FR', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
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

const buildOwnerClause = (ownerIds) => {
  if (!ownerIds.length) return '';
  return `,owner_id.in.(${ownerIds.join(',')})`;
};

const fetchAdminBetailsPage = async ({ page, searchTerm }) => {
  const safePage = Number.isInteger(page) && page >= 0 ? page : 0;
  const normalizedSearch = normalizeSearchTerm(searchTerm);
  const normalizedNeedle = normalizedSearch.toLowerCase();
  const searchPattern = normalizedSearch ? `%${normalizedSearch.replace(/\s+/g, '%')}%` : '';
  const isSearchMode = Boolean(normalizedSearch);

  let ownerIdsFilter = [];
  if (normalizedSearch) {
    ownerIdsFilter = await fetchMatchingOwnerIds(normalizedSearch);
  }

  const from = safePage * PAGE_SIZE;
  const to = from + PAGE_SIZE;

  let query = supabase
    .from('betails')
    .select('id, name, matricule, avatar_url, owner_id, visible, invisible_at, invisible_reason')
    .range(from, to);

  if (isSearchMode && searchPattern) {
    const ownerClause = buildOwnerClause(ownerIdsFilter);
    query = query.or(`name.ilike.${searchPattern},matricule.ilike.${searchPattern}${ownerClause}`);
    query = query.order('name', { ascending: true });
  } else {
    query = query
      .eq('visible', false)
      .order('invisible_at', { ascending: false });
  }

  const { data, error } = await query;
  if (error) {
    throw error;
  }

  const rows = Array.isArray(data) ? data : [];
  const hasNextPage = rows.length > PAGE_SIZE;
  const currentRows = rows.slice(0, PAGE_SIZE);

  const ownerIds = Array.from(new Set(currentRows.map((row) => row?.owner_id).filter(Boolean)));

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

  const mappedItems = currentRows.map((row) => {
    const ownerId = row?.owner_id || null;
    const owner = ownerById.get(ownerId) || (ownerId ? ownerId.slice(0, 8) : 'Sans propriétaire');

    return {
      betailId: row?.id,
      name: row?.name || 'Bétail inconnu',
      matricule: row?.matricule || 'â€”',
      avatarUrl: row?.avatar_url || '',
      owner,
      isVisible: Boolean(row?.visible ?? true),
      invisibleAt: row?.invisible_at,
      invisibleReason: row?.invisible_reason || 'Aucune raison précisée',
      isKnownBetail: Boolean(row?.id),
    };
  });

  const items = normalizedNeedle
    ? mappedItems.filter((item) => {
      if (!item.isKnownBetail) return false;
      const searchable = `${item.name} ${item.matricule} ${item.owner} ${item.invisibleReason}`.toLowerCase();
      return searchable.includes(normalizedNeedle);
    })
    : mappedItems;

  return {
    items,
    hasNextPage,
  };
};

function Settings_AdminInvisibleBetailsPanel({ isActive, isAdmin }) {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(0);
  const [searchInput, setSearchInput] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [confirmDeleteBetailId, setConfirmDeleteBetailId] = useState(null);
  const [refreshSpinTick, setRefreshSpinTick] = useState(0);
  const [feedback, setFeedback] = useState({ type: '', message: '' });

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setPage(0);
      setSearchTerm(normalizeSearchTerm(searchInput));
      setConfirmDeleteBetailId(null);
    }, SEARCH_DEBOUNCE_MS);

    return () => window.clearTimeout(timeoutId);
  }, [searchInput]);

  const invisibleBetailsQuery = useQuery({
    queryKey: [...ADMIN_INVISIBLE_BETAILS_QUERY_KEY, page, searchTerm],
    queryFn: () => fetchAdminBetailsPage({ page, searchTerm }),
    enabled: Boolean(isActive && isAdmin),
    staleTime: 30_000,
    gcTime: 300_000,
    retry: 1,
    placeholderData: (previousData) => previousData,
    refetchOnWindowFocus: false,
  });

  const setVisibilityMutation = useMutation({
    mutationFn: async ({ betailId, nextVisible, reason }) => {
      const { data, error } = await supabase.rpc('admin_set_betail_visibility_reborn', {
        p_betail_id: betailId,
        p_visible: nextVisible,
        p_invisible_reason: nextVisible ? null : reason || 'moderation_manual',
      });

      if (error) throw error;

      const result = Array.isArray(data) ? data[0] : data;
      if (!result?.success) {
        const reasonCode = String(result?.reason || 'UNKNOWN');
        throw new Error(`admin_set_betail_visibility_reborn_failed:${reasonCode}`);
      }

      return {
        betailId,
        nextVisible,
        removedBadges: Number(result?.removed_badges || 0),
        removedShipping: Number(result?.removed_shipping || 0),
      };
    },
    onSuccess: ({ nextVisible, removedBadges, removedShipping }) => {
      queryClient.invalidateQueries({ queryKey: ['settings', 'admin'] });
      const message = nextVisible
        ? removedShipping > 0
          ? 'Betail restaure, visible de nouveau, et historique expedition annule.'
          : 'Betail restaure et visible de nouveau.'
        : removedBadges > 0
          ? `Betail rendu invisible. ${removedBadges} badge(s) retire(s) de l\'inventaire.`
          : 'Betail rendu invisible.';
      setFeedback({ type: 'success', message });
      setConfirmDeleteBetailId(null);
    },
    onError: (error) => {
      const rawMessage = String(error?.message || '').toLowerCase();
      const message = rawMessage.includes('admin_set_betail_visibility_reborn')
        ? 'Fonction SQL admin_set_betail_visibility_reborn absente ou signature differente.'
        : (error?.message || 'Impossible de modifier la visibilite de ce betail.');
      setFeedback({
        type: 'error',
        message,
      });
    },
  });

  const hardDeleteMutation = useMutation({
    mutationFn: async ({ betailId }) => {
      const { data, error } = await supabase.rpc('admin_delete_betail_reborn', {
        p_betail_id: betailId,
      });

      if (error) throw error;

      const result = Array.isArray(data) ? data[0] : data;
      if (!result?.success) {
        const reason = String(result?.reason || 'UNKNOWN');
        throw new Error(`admin_delete_betail_reborn_failed:${reason}`);
      }

      return {
        betailId,
        removedBadges: Number(result?.removed_badges || 0),
      };
    },
    onSuccess: ({ removedBadges }) => {
      queryClient.invalidateQueries({ queryKey: ['settings', 'admin'] });
      const suffix = removedBadges > 0 ? ` (${removedBadges} badge(s) retire(s) de l'inventaire).` : '.';
      setFeedback({ type: 'success', message: `Betail supprime definitivement du registre${suffix}` });
      setConfirmDeleteBetailId(null);
    },
    onError: (error) => {
      const rawMessage = String(error?.message || '').toLowerCase();
      const message = rawMessage.includes('admin_delete_betail_reborn')
        ? 'Fonction SQL admin_delete_betail_reborn absente ou signature differente.'
        : (error?.message || 'Impossible de supprimer definitivement ce betail.');
      setFeedback({
        type: 'error',
        message,
      });
      setConfirmDeleteBetailId(null);
    },
  });

  const isMutating = setVisibilityMutation.isPending || hardDeleteMutation.isPending;
  const rows = invisibleBetailsQuery.data?.items || [];
  const hasNextPage = Boolean(invisibleBetailsQuery.data?.hasNextPage);
  const isSearching = Boolean(searchTerm);

  const emptyLabel = useMemo(() => {
    if (searchTerm) return 'Aucun betail correspondant a cette recherche.';
    return 'Aucun betail invisible pour le moment.';
  }, [searchTerm]);

  const handleRestore = (row) => {
    if (!row?.betailId) return;
    setConfirmDeleteBetailId(null);
    setVisibilityMutation.mutate({
      betailId: row.betailId,
      nextVisible: true,
    });
  };

  const handleHide = (row) => {
    if (!row?.betailId) return;
    setConfirmDeleteBetailId(null);
    setVisibilityMutation.mutate({
      betailId: row.betailId,
      nextVisible: false,
      reason: 'Rendu invisible manuellement depuis admin',
    });
  };

  const handleHardDelete = (row) => {
    if (!row?.betailId) return;

    if (confirmDeleteBetailId !== row.betailId) {
      setConfirmDeleteBetailId(row.betailId);
      return;
    }

    hardDeleteMutation.mutate({ betailId: row.betailId });
  };

  const handleRefresh = async () => {
    setFeedback({ type: '', message: '' });
    setConfirmDeleteBetailId(null);
    setRefreshSpinTick((value) => value + 1);
    await invisibleBetailsQuery.refetch();
  };

  return (
    <div className="settings-section">
      <h3 className="settings-section-title">Betails invisibles</h3>
      <div className="settings-admin-toolbar">
        <input
          type="search"
          className="settings-admin-search"
          placeholder="Rechercher un betail (nom/matricule), visible ou invisible..."
          value={searchInput}
          onChange={(event) => setSearchInput(event.target.value)}
          aria-label="Recherche des betails"
        />
        <button
          type="button"
          className="settings-admin-refresh-icon-btn"
          onClick={handleRefresh}
          aria-label="Rafraichir la liste des betails"
          disabled={invisibleBetailsQuery.isFetching || isMutating}
        >
          <RefreshCcw
            key={`invisible-refresh-${refreshSpinTick}`}
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

      {invisibleBetailsQuery.isLoading ? (
        <p className="settings-item-subtitle">
          {isSearching ? 'Recherche des betails...' : 'Chargement des betails invisibles...'}
        </p>
      ) : invisibleBetailsQuery.isError ? (
        <p className="settings-admin-feedback is-error">
          {invisibleBetailsQuery.error?.message || 'Impossible de charger les betails.'}
        </p>
      ) : rows.length === 0 ? (
        <p className="settings-item-subtitle">{emptyLabel}</p>
      ) : (
        <div className="settings-admin-shipping-list">
          {rows.map((row) => (
            <article key={row.betailId} className="settings-admin-shipping-row">
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
                  {row.isVisible ? (
                    <p className="settings-admin-shipping-meta">Statut: Visible</p>
                  ) : (
                    <>
                      <p className="settings-admin-shipping-meta">
                        Invisible depuis le {formatInvisibleDate(row.invisibleAt)}
                      </p>
                      <p className="settings-admin-shipping-meta">Raison: {row.invisibleReason}</p>
                    </>
                  )}
                </div>
              </div>

              <div className="settings-admin-shipping-actions">
                {row.isVisible ? (
                  <button
                    type="button"
                    className="settings-admin-btn settings-admin-btn--delete-hard"
                    onClick={() => handleHide(row)}
                    disabled={isMutating}
                  >
                    Rendre invisible
                  </button>
                ) : (
                  <button
                    type="button"
                    className="settings-admin-btn settings-admin-btn--restore"
                    onClick={() => handleRestore(row)}
                    disabled={isMutating}
                  >
                    Restaurer
                  </button>
                )}
                <button
                  type="button"
                  className="settings-admin-btn settings-admin-btn--delete-hard"
                  onClick={() => handleHardDelete(row)}
                  disabled={isMutating}
                >
                  {confirmDeleteBetailId === row.betailId ? 'Confirmer?' : 'Supprimer'}
                </button>
              </div>
            </article>
          ))}
        </div>
      )}

      <div className="settings-admin-pagination">
        <button
          type="button"
          className="settings-action"
          onClick={() => setPage((value) => Math.max(0, value - 1))}
          disabled={page === 0 || invisibleBetailsQuery.isLoading || isMutating}
        >
          Précédent
        </button>
        <span className="settings-item-subtitle">Page {page + 1}</span>
        <button
          type="button"
          className="settings-action"
          onClick={() => setPage((value) => value + 1)}
          disabled={!hasNextPage || invisibleBetailsQuery.isLoading || isMutating}
        >
          Suivant
        </button>
      </div>
    </div>
  );
}

export default Settings_AdminInvisibleBetailsPanel;
