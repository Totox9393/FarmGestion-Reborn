import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { RefreshCcw } from 'lucide-react';
import { supabase } from '../authentification/supabaseClient';
import defaultBetailAvatar from '../../assets/defaut_profile.png';

const PAGE_SIZE = 8;
const SEARCH_DEBOUNCE_MS = 280;
const ADMIN_REPORTS_QUERY_KEY = ['settings', 'admin', 'reports'];
const HISTORY_STATUSES = ['done', 'rejected'];
const DEFAULT_AVATAR_PREVIEW_SIZE = 220;
const DEFAULT_AVATAR_OUTPUT_SIZE = 512;
const DEFAULT_AVATAR_ZOOM = 1.15;
const DEFAULT_AVATAR_OFFSET = { x: 0, y: 12 };
const MODERATION_ACTIONS = {
  REPLACE_PHOTO: 'replace_photo',
  REMOVE_COMMENT: 'remove_comment',
  HIDE_BETAIL: 'hide_betail',
};

const REASON_LABELS = {
  photo_inappropriee: 'Photo inappropriée',
  nom_inapproprie: 'Nom inapproprié',
  description_inappropriee: 'Description inappropriée',
  informations_personnelles: 'Infos personnelles',
  fraude_manipulation: 'Fraude / manipulation',
  harcelement: 'Harcèlement',
  autre: 'Autre',
};

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

const formatReportDate = (isoValue) => {
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

const getReasonLabel = (reasonCode) => REASON_LABELS[reasonCode] || 'Motif inconnu';

const getStatusLabel = (status) => {
  if (status === 'done') return 'Traite';
  if (status === 'rejected') return 'Rejete';
  return 'En attente';
};

const getRetentionLabel = (updatedAtIso) => {
  const updatedAt = new Date(updatedAtIso || '');
  if (Number.isNaN(updatedAt.getTime())) return 'Suppression auto: inconnue';

  const expiryDate = new Date(updatedAt.getTime());
  expiryDate.setMonth(expiryDate.getMonth() + 6);

  const diffMs = expiryDate.getTime() - Date.now();
  const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays <= 0) return 'Suppression auto imminente';

  const months = Math.floor(diffDays / 30);
  const days = diffDays % 30;

  if (months <= 0) {
    if (days <= 1) return 'Se supprimera dans 1 jour';
    return `Se supprimera dans ${days} jours`;
  }

  if (days <= 0) {
    if (months === 1) return 'Se supprimera dans 1 mois';
    return `Se supprimera dans ${months} mois`;
  }

  if (months === 1) return `Se supprimera dans 1 mois et ${days} jours`;
  return `Se supprimera dans ${months} mois et ${days} jours`;
};

const toPreviewText = (value, maxLength = 95) => {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (raw.length <= maxLength) return raw;
  return `${raw.slice(0, maxLength).trimEnd()}...`;
};

const loadImageFromUrl = async (src) => {
  const image = new Image();
  image.crossOrigin = 'anonymous';
  image.src = src;

  await new Promise((resolve, reject) => {
    image.onload = resolve;
    image.onerror = reject;
  });

  return image;
};

const createModerationDefaultAvatarBlob = async () => {
  const image = await loadImageFromUrl(defaultBetailAvatar);
  const canvas = document.createElement('canvas');
  canvas.width = DEFAULT_AVATAR_OUTPUT_SIZE;
  canvas.height = DEFAULT_AVATAR_OUTPUT_SIZE;

  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('Canvas indisponible pour le cadrage de la photo standard.');
  }

  const baseScale = Math.max(
    DEFAULT_AVATAR_PREVIEW_SIZE / image.naturalWidth,
    DEFAULT_AVATAR_PREVIEW_SIZE / image.naturalHeight,
  );
  const scaleRatio = DEFAULT_AVATAR_OUTPUT_SIZE / DEFAULT_AVATAR_PREVIEW_SIZE;

  context.clearRect(0, 0, DEFAULT_AVATAR_OUTPUT_SIZE, DEFAULT_AVATAR_OUTPUT_SIZE);
  context.save();
  context.beginPath();
  context.arc(
    DEFAULT_AVATAR_OUTPUT_SIZE / 2,
    DEFAULT_AVATAR_OUTPUT_SIZE / 2,
    DEFAULT_AVATAR_OUTPUT_SIZE / 2,
    0,
    Math.PI * 2,
  );
  context.closePath();
  context.clip();

  context.translate(
    DEFAULT_AVATAR_OUTPUT_SIZE / 2 + DEFAULT_AVATAR_OFFSET.x * scaleRatio,
    DEFAULT_AVATAR_OUTPUT_SIZE / 2 + DEFAULT_AVATAR_OFFSET.y * scaleRatio,
  );
  context.scale(baseScale * DEFAULT_AVATAR_ZOOM * scaleRatio, baseScale * DEFAULT_AVATAR_ZOOM * scaleRatio);
  context.drawImage(image, -image.naturalWidth / 2, -image.naturalHeight / 2);
  context.restore();

  const blob = await new Promise((resolve) => {
    canvas.toBlob((fileBlob) => resolve(fileBlob), 'image/png');
  });

  if (!blob) {
    throw new Error('Impossible de generer la photo standard cadree.');
  }

  return blob;
};

const uploadModerationDefaultAvatar = async () => {
  const blob = await createModerationDefaultAvatarBlob();
  const suffix = Math.random().toString(36).slice(2, 8);
  const filePath = `moderation/default-${Date.now()}-${suffix}.png`;

  const { error: uploadError } = await supabase
    .storage
    .from('betails')
    .upload(filePath, blob, {
      cacheControl: '3600',
      upsert: true,
      contentType: 'image/png',
    });

  if (uploadError) {
    throw uploadError;
  }

  const { data } = supabase.storage.from('betails').getPublicUrl(filePath);
  const publicUrl = data?.publicUrl || '';
  if (!publicUrl) {
    throw new Error('Impossible de recuperer l\'URL de la photo standard.');
  }

  return publicUrl;
};

const fetchMatchingUserIds = async (normalizedSearch) => {
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

const fetchMatchingBetailIds = async (normalizedSearch, matchingOwnerIds) => {
  if (!normalizedSearch) return [];

  const searchPattern = `%${normalizedSearch.replace(/\s+/g, '%')}%`;
  const ownerClause = buildOwnerClause(matchingOwnerIds);

  const { data, error } = await supabase
    .from('betails')
    .select('id')
    .or(`name.ilike.${searchPattern},matricule.ilike.${searchPattern}${ownerClause}`)
    .limit(150);

  if (error || !Array.isArray(data)) return [];
  return Array.from(new Set(data.map((row) => row?.id).filter(Boolean)));
};

const fetchReportsPage = async ({ page, searchTerm, view }) => {
  const safePage = Number.isInteger(page) && page >= 0 ? page : 0;
  const normalizedSearch = normalizeSearchTerm(searchTerm);
  const searchPattern = normalizedSearch ? `%${normalizedSearch.replace(/\s+/g, '%')}%` : '';
  const isHistoryView = view === 'history';

  let matchingUserIds = [];
  let matchingBetailIds = [];

  if (normalizedSearch) {
    matchingUserIds = await fetchMatchingUserIds(normalizedSearch);
    matchingBetailIds = await fetchMatchingBetailIds(normalizedSearch, matchingUserIds);
  }

  const from = safePage * PAGE_SIZE;
  const to = from + PAGE_SIZE;

  let query = supabase
    .from('betails_reports')
    .select('id, betail_id, reporter_id, reason_code, reason_details, status, created_at, handled_at, updated_at, handled_by, betail_snapshot_comment')
    .range(from, to);

  if (isHistoryView) {
    query = query
      .in('status', HISTORY_STATUSES)
      .order('handled_at', { ascending: false, nullsFirst: false })
      .order('updated_at', { ascending: false });
  } else {
    query = query
      .eq('status', 'pending')
      .order('created_at', { ascending: false });
  }

  if (searchPattern) {
    const clauses = [
      `reason_code.ilike.${searchPattern}`,
      `reason_details.ilike.${searchPattern}`,
      `betail_snapshot_comment.ilike.${searchPattern}`,
    ];

    if (matchingUserIds.length) {
      clauses.push(`reporter_id.in.(${matchingUserIds.join(',')})`);
    }

    if (matchingBetailIds.length) {
      clauses.push(`betail_id.in.(${matchingBetailIds.join(',')})`);
    }

    query = query.or(clauses.join(','));
  }

  const { data: reportsData, error: reportsError } = await query;
  if (reportsError) {
    throw reportsError;
  }

  const reportRows = Array.isArray(reportsData) ? reportsData : [];
  const hasNextPage = reportRows.length > PAGE_SIZE;
  const currentRows = reportRows.slice(0, PAGE_SIZE);

  const betailIds = Array.from(new Set(currentRows.map((row) => row?.betail_id).filter(Boolean)));
  const reporterIds = Array.from(new Set(currentRows.map((row) => row?.reporter_id).filter(Boolean)));
  const handledByIds = Array.from(new Set(currentRows.map((row) => row?.handled_by).filter(Boolean)));

  const { data: betailsData, error: betailsError } = betailIds.length
    ? await supabase
      .from('betails')
      .select('id, name, matricule, avatar_url, owner_id, farm_id, comments')
      .in('id', betailIds)
    : { data: [], error: null };

  if (betailsError) {
    throw betailsError;
  }

  const betailById = new Map((betailsData || []).map((row) => [row.id, row]));
  const farmIds = Array.from(new Set((betailsData || []).map((row) => row?.farm_id).filter(Boolean)));

  const { data: farmsData } = farmIds.length
    ? await supabase
      .from('farms_list')
      .select('id, name, proprietaire')
      .in('id', farmIds)
    : { data: [] };

  const farmById = new Map((farmsData || []).map((row) => [row.id, row]));
  const farmOwnerIds = Array.from(new Set((farmsData || []).map((row) => row?.proprietaire).filter(Boolean)));

  const peopleIds = Array.from(new Set([...reporterIds, ...farmOwnerIds, ...handledByIds]));
  const { data: usersData } = peopleIds.length
    ? await supabase
      .from('users_profiles')
      .select('id, username')
      .in('id', peopleIds)
    : { data: [] };

  const userById = new Map((usersData || []).map((row) => [row.id, row?.username || 'Inconnu']));

  const items = currentRows.map((row) => {
    const betail = betailById.get(row.betail_id);
    const farm = farmById.get(betail?.farm_id);
    const farmOwner = farm?.proprietaire ? (userById.get(farm.proprietaire) || farm.proprietaire.slice(0, 8)) : '';
    const ownershipLabel = farm?.name
      ? `${farm.name} · ${farmOwner || 'Owner inconnu'}`
      : 'Registre public';
    const reporterName = row?.reporter_id
      ? (userById.get(row.reporter_id) || row.reporter_id.slice(0, 8))
      : 'Inconnu';
    const handledByName = row?.handled_by
      ? (userById.get(row.handled_by) || row.handled_by.slice(0, 8))
      : 'Inconnu';

    return {
      reportId: row?.id,
      betailId: row?.betail_id || null,
      betailName: betail?.name || 'Bétail supprimé',
      betailMatricule: betail?.matricule || '—',
      avatarUrl: betail?.avatar_url || '',
      ownershipLabel,
      reporterName,
      reasonCode: row?.reason_code || '',
      status: row?.status || 'pending',
      reasonDetails: row?.reason_details || '',
      snapshotComment: row?.betail_snapshot_comment || '',
      liveComment: betail?.comments || '',
      createdAt: row?.created_at || null,
      handledAt: row?.handled_at || null,
      updatedAt: row?.updated_at || null,
      handledByName,
      isKnownBetail: Boolean(betail?.id),
    };
  });

  return {
    items,
    hasNextPage,
  };
};

function Settings_ReportsPanel({ isActive, canAccessAdministration, currentUserId }) {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(0);
  const [activeView, setActiveView] = useState('pending');
  const [searchInput, setSearchInput] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [confirmRejectId, setConfirmRejectId] = useState(null);
  const [refreshSpinTick, setRefreshSpinTick] = useState(0);
  const [actionMenuReportId, setActionMenuReportId] = useState(null);
  const [expandedReportId, setExpandedReportId] = useState(null);
  const [feedback, setFeedback] = useState({ type: '', message: '' });

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setPage(0);
      setSearchTerm(normalizeSearchTerm(searchInput));
      setConfirmRejectId(null);
      setActionMenuReportId(null);
      setExpandedReportId(null);
    }, SEARCH_DEBOUNCE_MS);

    return () => window.clearTimeout(timeoutId);
  }, [searchInput]);

  const pendingReportsQuery = useQuery({
    queryKey: [...ADMIN_REPORTS_QUERY_KEY, 'pending', page, searchTerm],
    queryFn: () => fetchReportsPage({ page, searchTerm, view: 'pending' }),
    enabled: Boolean(isActive && canAccessAdministration && activeView === 'pending'),
    staleTime: 30_000,
    gcTime: 300_000,
    retry: 1,
    placeholderData: (previousData) => previousData,
    refetchOnWindowFocus: false,
  });

  const historyReportsQuery = useQuery({
    queryKey: [...ADMIN_REPORTS_QUERY_KEY, 'history', page, searchTerm],
    queryFn: () => fetchReportsPage({ page, searchTerm, view: 'history' }),
    enabled: Boolean(isActive && canAccessAdministration && activeView === 'history'),
    staleTime: 30_000,
    gcTime: 300_000,
    retry: 1,
    placeholderData: (previousData) => previousData,
    refetchOnWindowFocus: false,
  });

  const rejectMutation = useMutation({
    mutationFn: async ({ reportId }) => {
      const payload = {
        status: 'rejected',
        handled_by: currentUserId || null,
        handled_at: new Date().toISOString(),
      };

      const { error } = await supabase
        .from('betails_reports')
        .update(payload)
        .eq('id', reportId)
        .eq('status', 'pending');

      if (error) throw error;
      return { reportId };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ADMIN_REPORTS_QUERY_KEY });
      setFeedback({ type: 'success', message: 'Signalement rejeté.' });
      setConfirmRejectId(null);
      setActionMenuReportId(null);
    },
    onError: (error) => {
      setFeedback({
        type: 'error',
        message: error?.message || 'Impossible de rejeter ce signalement.',
      });
      setConfirmRejectId(null);
    },
  });

  const moderationActionMutation = useMutation({
    mutationFn: async ({ reportId, betailId, reasonCode, actionType }) => {
      if (!reportId || !betailId) {
        throw new Error('Betail introuvable pour cette action.');
      }

      const nowIso = new Date().toISOString();
      let betailPayload = null;

      if (actionType === MODERATION_ACTIONS.REPLACE_PHOTO) {
        const standardAvatarUrl = await uploadModerationDefaultAvatar();
        betailPayload = {
          avatar_url: standardAvatarUrl,
        };
      } else if (actionType === MODERATION_ACTIONS.REMOVE_COMMENT) {
        betailPayload = {
          comments: null,
        };
      } else if (actionType === MODERATION_ACTIONS.HIDE_BETAIL) {
        betailPayload = {
          visible: false,
          invisible_at: nowIso,
          invisible_reason: `signalement_${reasonCode || 'moderation'}`,
        };
      } else {
        throw new Error('Action de moderation inconnue.');
      }

      const { error: betailError } = await supabase
        .from('betails')
        .update(betailPayload)
        .eq('id', betailId);

      if (betailError) {
        throw betailError;
      }

      const reportPayload = {
        status: 'done',
        handled_by: currentUserId || null,
        handled_at: nowIso,
      };

      const { error: reportError } = await supabase
        .from('betails_reports')
        .update(reportPayload)
        .eq('id', reportId)
        .eq('status', 'pending');

      if (reportError) {
        throw reportError;
      }

      return { actionType };
    },
    onSuccess: ({ actionType }) => {
      queryClient.invalidateQueries({ queryKey: ADMIN_REPORTS_QUERY_KEY });
      queryClient.invalidateQueries({ queryKey: ['betails'] });

      const successMessage = actionType === MODERATION_ACTIONS.REPLACE_PHOTO
        ? 'Photo remplacee par la photo standard. Signalement marque comme traite.'
        : actionType === MODERATION_ACTIONS.REMOVE_COMMENT
          ? 'Commentaire supprime. Signalement marque comme traite.'
          : 'Betail rendu invisible. Signalement marque comme traite.';

      setFeedback({ type: 'success', message: successMessage });
      setActionMenuReportId(null);
      setConfirmRejectId(null);
    },
    onError: (error) => {
      setFeedback({
        type: 'error',
        message: error?.message || 'Impossible d\'executer cette action de moderation.',
      });
    },
  });

  const isMutating = rejectMutation.isPending || moderationActionMutation.isPending;
  const activeQuery = activeView === 'history' ? historyReportsQuery : pendingReportsQuery;
  const rows = activeQuery.data?.items || [];
  const hasNextPage = Boolean(activeQuery.data?.hasNextPage);

  const emptyLabel = useMemo(() => {
    if (searchTerm) return 'Aucun signalement trouve pour cette recherche.';
    if (activeView === 'history') return 'Aucun signalement traite/rejete pour le moment.';
    return 'Aucun signalement en attente.';
  }, [activeView, searchTerm]);

  const handleReject = (row) => {
    if (!row?.reportId) return;

    if (confirmRejectId !== row.reportId) {
      setConfirmRejectId(row.reportId);
      return;
    }

    rejectMutation.mutate({ reportId: row.reportId });
  };

  const handleOpenActionMenu = (row) => {
    if (!row?.reportId) return;
    setConfirmRejectId(null);
    setActionMenuReportId((value) => (value === row.reportId ? null : row.reportId));
  };

  const handleModerationAction = (row, actionType) => {
    moderationActionMutation.mutate({
      reportId: row?.reportId,
      betailId: row?.betailId,
      reasonCode: row?.reasonCode,
      actionType,
    });
  };

  const handleToggleExpand = (reportId) => {
    setExpandedReportId((value) => (value === reportId ? null : reportId));
  };

  const handleSwitchView = (view) => {
    if (view === activeView) return;
    setActiveView(view);
    setPage(0);
    setExpandedReportId(null);
    setConfirmRejectId(null);
    setActionMenuReportId(null);
    setFeedback({ type: '', message: '' });
  };

  const handleRefresh = async () => {
    setFeedback({ type: '', message: '' });
    setConfirmRejectId(null);
    setActionMenuReportId(null);
    setRefreshSpinTick((value) => value + 1);

    await activeQuery.refetch();
  };

  return (
    <div className="settings-section">
      <h3 className="settings-section-title">Signalements</h3>
      <div className="settings-admin-view-switch" role="tablist" aria-label="Vues signalements">
        <button
          type="button"
          className={`settings-admin-view-btn ${activeView === 'pending' ? 'active' : ''}`}
          onClick={() => handleSwitchView('pending')}
          role="tab"
          aria-selected={activeView === 'pending'}
        >
          En attente
        </button>
        <button
          type="button"
          className={`settings-admin-view-btn ${activeView === 'history' ? 'active' : ''}`}
          onClick={() => handleSwitchView('history')}
          role="tab"
          aria-selected={activeView === 'history'}
        >
          Historique traite/rejete
        </button>
      </div>
      <div className="settings-admin-toolbar">
        <input
          type="search"
          className="settings-admin-search"
          placeholder="Rechercher par bétail, owner, reporteur ou motif..."
          value={searchInput}
          onChange={(event) => setSearchInput(event.target.value)}
          aria-label="Recherche des signalements"
        />
        <button
          type="button"
          className="settings-admin-refresh-icon-btn"
          onClick={handleRefresh}
          aria-label="Rafraîchir les signalements"
          disabled={activeQuery.isFetching || isMutating}
        >
          <RefreshCcw
            key={`reports-refresh-${refreshSpinTick}`}
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

      {activeQuery.isLoading ? (
        <p className="settings-item-subtitle">Chargement des signalements...</p>
      ) : activeQuery.isError ? (
        <p className="settings-admin-feedback is-error">
          {activeQuery.error?.message || 'Impossible de charger les signalements.'}
        </p>
      ) : rows.length === 0 ? (
        <p className="settings-item-subtitle">{emptyLabel}</p>
      ) : (
        <div className="settings-admin-shipping-list">
          {rows.map((row) => {
            const isExpanded = expandedReportId === row.reportId;
            const reasonText = row.reasonDetails || '';
            const commentText = row.snapshotComment || row.liveComment || '';
            const reasonDisplay = isExpanded ? reasonText : toPreviewText(reasonText, 120);
            const commentDisplay = isExpanded ? commentText : toPreviewText(commentText, 140);

            return (
              <article
                key={row.reportId}
                className={`settings-admin-shipping-row settings-admin-report-row ${isExpanded ? 'is-expanded' : ''}`}
                onClick={() => handleToggleExpand(row.reportId)}
                role="button"
                tabIndex={0}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    handleToggleExpand(row.reportId);
                  }
                }}
                aria-expanded={isExpanded}
              >
              <div className="settings-admin-shipping-main">
                <div className="settings-admin-shipping-avatar" aria-hidden="true">
                  {row.avatarUrl ? (
                    <img src={row.avatarUrl} alt="" loading="lazy" decoding="async" />
                  ) : (
                    <span>{toAvatarFallback(row.betailName)}</span>
                  )}
                </div>

                <div className="settings-admin-shipping-info">
                  <p className="settings-admin-shipping-title">{row.betailName}</p>
                  <p className="settings-admin-shipping-meta settings-admin-report-owner-line">
                    Matricule: {row.betailMatricule} · <span className="settings-admin-report-owner">{row.ownershipLabel}</span>
                  </p>
                  <p className="settings-admin-shipping-meta">
                    Signalé par: {row.reporterName} · Le {formatReportDate(row.createdAt)}
                  </p>
                  {activeView === 'history' ? (
                    <p className="settings-admin-shipping-meta">
                      Traite le {formatReportDate(row.handledAt || row.updatedAt)} · Par {row.handledByName}
                    </p>
                  ) : null}
                  <p className="settings-admin-report-reason">Motif: {getReasonLabel(row.reasonCode)}</p>
                  {activeView === 'history' ? (
                    <p className="settings-admin-report-retention">{getRetentionLabel(row.updatedAt)}</p>
                  ) : null}
                  {reasonText ? (
                    <p className="settings-admin-shipping-meta">
                      Précision: {reasonDisplay}
                    </p>
                  ) : null}
                  {commentText ? (
                    <p className="settings-admin-report-comment">
                      Commentaire: {commentDisplay}
                    </p>
                  ) : null}
                  <p className="settings-admin-report-hint">
                    {isExpanded ? 'Cliquer pour réduire' : 'Cliquer pour voir tout le signalement'}
                  </p>
                </div>
              </div>

              <div className="settings-admin-shipping-actions">
                {activeView === 'pending' ? (
                  <>
                    {actionMenuReportId === row.reportId ? (
                      <div
                        className="settings-admin-report-actions-menu"
                        onClick={(event) => event.stopPropagation()}
                        role="group"
                        aria-label={`Actions de moderation pour ${row.betailName}`}
                      >
                        <button
                          type="button"
                          className="settings-admin-btn settings-admin-btn--moderation"
                          onClick={() => handleModerationAction(row, MODERATION_ACTIONS.REPLACE_PHOTO)}
                          disabled={isMutating}
                        >
                          Photo standard
                        </button>
                        <button
                          type="button"
                          className="settings-admin-btn settings-admin-btn--moderation"
                          onClick={() => handleModerationAction(row, MODERATION_ACTIONS.REMOVE_COMMENT)}
                          disabled={isMutating}
                        >
                          Supprimer commentaire
                        </button>
                        <button
                          type="button"
                          className="settings-admin-btn settings-admin-btn--moderation settings-admin-btn--moderation-warning"
                          onClick={() => handleModerationAction(row, MODERATION_ACTIONS.HIDE_BETAIL)}
                          disabled={isMutating}
                        >
                          Rendre invisible
                        </button>
                        <button
                          type="button"
                          className="settings-admin-btn settings-admin-btn--moderation-cancel"
                          onClick={() => setActionMenuReportId(null)}
                          disabled={isMutating}
                        >
                          Fermer
                        </button>
                      </div>
                    ) : (
                      <>
                        <button
                          type="button"
                          className="settings-admin-btn settings-admin-btn--act"
                          onClick={(event) => {
                            event.stopPropagation();
                            handleOpenActionMenu(row);
                          }}
                          disabled={isMutating}
                        >
                          Agir
                        </button>
                        <button
                          type="button"
                          className="settings-admin-btn settings-admin-btn--reject"
                          onClick={(event) => {
                            event.stopPropagation();
                            handleReject(row);
                          }}
                          disabled={isMutating}
                        >
                          {confirmRejectId === row.reportId ? 'Confirmer?' : 'Rejeter'}
                        </button>
                      </>
                    )}
                  </>
                ) : (
                  <span className={`settings-admin-status-badge is-${row.status}`}>
                    {getStatusLabel(row.status)}
                  </span>
                )}
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
          disabled={page === 0 || activeQuery.isLoading || isMutating}
        >
          Précédent
        </button>
        <span className="settings-item-subtitle">Page {page + 1}</span>
        <button
          type="button"
          className="settings-action"
          onClick={() => setPage((value) => value + 1)}
          disabled={!hasNextPage || activeQuery.isLoading || isMutating}
        >
          Suivant
        </button>
      </div>
    </div>
  );
}

export default Settings_ReportsPanel;
