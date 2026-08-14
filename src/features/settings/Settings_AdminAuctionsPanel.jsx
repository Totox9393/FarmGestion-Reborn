import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ban, Gavel, Timer, Sparkles } from 'lucide-react';
import { supabase } from '../authentification/supabaseClient';
import './Settings_AdminAuctionsPanel.css';

const AUCTION_CONFIG_QUERY_KEY = ['settings', 'admin', 'auctions-config'];
const ACTIVE_AUCTION_QUERY_KEY = ['settings', 'admin', 'active-auction-snapshot'];
const WINNER_ANNOUNCEMENT_QUERY_KEY = ['settings', 'admin', 'winner-announcement'];

const clampInt = (value, min, max, fallback) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.round(parsed)));
};

const emptyFeedback = { type: '', message: '' };

const formatCountdown = (milliseconds) => {
  const secondsTotal = Math.max(0, Math.floor(milliseconds / 1000));
  const hours = Math.floor(secondsTotal / 3600);
  const minutes = Math.floor((secondsTotal % 3600) / 60);
  const seconds = secondsTotal % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
};

const getStatusDetails = (session, now) => {
  if (!session) return { label: 'Aucune session', countdownLabel: '', countdown: '' };
  const status = String(session.status || '');
  const details = {
    filling: { label: 'Sélection des bétails', countdownLabel: 'Fin du remplissage', target: session.fill_deadline_at },
    ready_delay: { label: 'Ouverture en attente', countdownLabel: 'Ouverture dans', target: session.open_at },
    open: { label: 'Enchères ouvertes', countdownLabel: 'Clôture dans', target: session.end_at },
  }[status] || { label: status || 'Inconnu', countdownLabel: '', target: null };
  const targetTime = new Date(details.target || 0).getTime();
  return {
    ...details,
    countdown: details.target && Number.isFinite(targetTime) ? formatCountdown(targetTime - now) : '',
  };
};

const normalizeSnapshot = (payload) => {
  if (!payload) return { session: null, slots: [] };
  if (payload.session !== undefined && Array.isArray(payload.slots)) return payload;
  if (Array.isArray(payload) && payload.length > 0) return normalizeSnapshot(payload[0]);
  if (payload.data && typeof payload.data === 'object') return normalizeSnapshot(payload.data);
  return { session: null, slots: [] };
};

function Settings_AdminAuctionsPanel({ isActive, isAdmin, currentUserId }) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState(null);
  const [launchForm, setLaunchForm] = useState({
    slotsCount: 2,
    openDelayMinutes: 60,
    durationHours: 8,
  });
  const [feedback, setFeedback] = useState(emptyFeedback);
  const [nowTick, setNowTick] = useState(() => Date.now());

  const configQuery = useQuery({
    queryKey: AUCTION_CONFIG_QUERY_KEY,
    enabled: Boolean(isActive && isAdmin),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('auction_config_reborn')
        .select('*')
        .eq('id', true)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    staleTime: 15_000,
    gcTime: 300_000,
    retry: 1,
    refetchOnWindowFocus: false,
  });

  const activeSessionQuery = useQuery({
    queryKey: ACTIVE_AUCTION_QUERY_KEY,
    enabled: Boolean(isActive && isAdmin),
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_active_auction_snapshot_reborn');
      if (error) throw error;
      return normalizeSnapshot(data);
    },
    staleTime: 5_000,
    refetchInterval: 10_000,
  });

  const winnerAnnouncementQuery = useQuery({
    queryKey: WINNER_ANNOUNCEMENT_QUERY_KEY,
    enabled: Boolean(isActive && isAdmin),
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_latest_auction_winner_announcement_reborn');
      if (error) throw error;
      return data || { active: false };
    },
    refetchInterval: 10_000,
  });

  useEffect(() => {
    if (!configQuery.data) return;
    setDraft({
      enabled: Boolean(configQuery.data.enabled),
      weekly_sessions_target: Number(configQuery.data.weekly_sessions_target || 4),
      homepage_messages_enabled: Boolean(configQuery.data.homepage_messages_enabled ?? true),
      fill_timeout_hours: Number(configQuery.data.fill_timeout_hours || 12),
      open_delay_minutes: Number(configQuery.data.open_delay_minutes || 60),
      duration_hours: Number(configQuery.data.duration_hours || 8),
      winner_announcement_enabled: Boolean(configQuery.data.winner_announcement_enabled ?? true),
      winner_announcement_minutes: Number(configQuery.data.winner_announcement_minutes || 60),
      slot_min: Number(configQuery.data.slot_min || 2),
      slot_max: Number(configQuery.data.slot_max || 5),
    });

    setLaunchForm((current) => ({
      slotsCount: clampInt(current.slotsCount, Number(configQuery.data.slot_min || 2), Number(configQuery.data.slot_max || 5), Number(configQuery.data.slot_min || 2)),
      openDelayMinutes: clampInt(current.openDelayMinutes, 1, 1440, Number(configQuery.data.open_delay_minutes || 60)),
      durationHours: clampInt(current.durationHours, 1, 72, Number(configQuery.data.duration_hours || 8)),
    }));
  }, [configQuery.data]);

  useEffect(() => {
    if (!isActive || !isAdmin) return undefined;
    const timerId = window.setInterval(() => setNowTick(Date.now()), 1000);
    return () => window.clearInterval(timerId);
  }, [isActive, isAdmin]);

  useEffect(() => {
    if (!isActive || !isAdmin) return undefined;
    const channel = supabase
      .channel('settings-admin-auctions-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'auction_sessions_reborn' }, () => {
        queryClient.invalidateQueries({ queryKey: ACTIVE_AUCTION_QUERY_KEY });
        queryClient.invalidateQueries({ queryKey: WINNER_ANNOUNCEMENT_QUERY_KEY });
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'auction_slots_reborn' }, () => {
        queryClient.invalidateQueries({ queryKey: ACTIVE_AUCTION_QUERY_KEY });
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [isActive, isAdmin, queryClient]);

  const saveConfigMutation = useMutation({
    mutationFn: async (nextDraft) => {
      const payload = {
        enabled: Boolean(nextDraft.enabled),
        weekly_sessions_target: clampInt(nextDraft.weekly_sessions_target, 0, 7, 4),
        homepage_messages_enabled: Boolean(nextDraft.homepage_messages_enabled),
        fill_timeout_hours: clampInt(nextDraft.fill_timeout_hours, 1, 72, 12),
        open_delay_minutes: clampInt(nextDraft.open_delay_minutes, 1, 1440, 60),
        duration_hours: clampInt(nextDraft.duration_hours, 1, 72, 8),
        winner_announcement_enabled: Boolean(nextDraft.winner_announcement_enabled),
        winner_announcement_minutes: clampInt(nextDraft.winner_announcement_minutes, 1, 1440, 60),
        updated_at: new Date().toISOString(),
      };

      if (currentUserId) {
        payload.updated_by = currentUserId;
      }

      const { data, error } = await supabase
        .from('auction_config_reborn')
        .update(payload)
        .eq('id', true)
        .select('*')
        .maybeSingle();

      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      setFeedback({ type: 'success', message: 'Configuration des enchères sauvegardée.' });
      queryClient.setQueryData(AUCTION_CONFIG_QUERY_KEY, data);
      queryClient.invalidateQueries({ queryKey: WINNER_ANNOUNCEMENT_QUERY_KEY });
      queryClient.invalidateQueries({ queryKey: ['home', 'auction-winner-announcement'] });
    },
    onError: (error) => {
      setFeedback({ type: 'error', message: error?.message || 'Impossible de sauvegarder la configuration.' });
    },
  });

  const launchSessionMutation = useMutation({
    mutationFn: async ({ slotsCount, openDelayMinutes, durationHours }) => {
      const { data, error } = await supabase.rpc('admin_launch_auction_session_reborn', {
        p_slots_count: clampInt(slotsCount, 2, 5, 2),
        p_open_delay_minutes: clampInt(openDelayMinutes, 1, 1440, 60),
        p_duration_hours: clampInt(durationHours, 1, 72, 8),
      });
      if (error) throw error;
      if (!data?.success) {
        throw new Error(String(data?.reason || 'UNKNOWN'));
      }
      return data;
    },
    onSuccess: (data) => {
      const sessionId = String(data?.session_id || '').trim();
      setFeedback({
        type: 'success',
        message: sessionId
          ? `Session lancée (${sessionId.slice(0, 8)}...).`
          : 'Session lancée avec succès.',
      });
      queryClient.invalidateQueries({ queryKey: ['auctions'] });
      queryClient.invalidateQueries({ queryKey: ACTIVE_AUCTION_QUERY_KEY });
    },
    onError: (error) => {
      const reason = String(error?.message || 'UNKNOWN').toUpperCase();
      if (reason.includes('ACTIVE_SESSION_EXISTS')) {
        setFeedback({ type: 'error', message: 'Une session active existe déjà.' });
        return;
      }
      setFeedback({ type: 'error', message: `Lancement impossible (${reason.toLowerCase()}).` });
    },
  });

  const forceOpenMutation = useMutation({
    mutationFn: async ({ sessionId }) => {
      const { data, error } = await supabase.rpc('admin_force_open_auction_session_reborn', {
        p_session_id: sessionId,
      });
      if (error) throw error;
      if (!data?.success) throw new Error(String(data?.reason || 'UNKNOWN'));
      return data;
    },
    onSuccess: () => {
      setFeedback({ type: 'success', message: 'La période de remplissage a été clôturée et les enchères sont ouvertes.' });
      queryClient.invalidateQueries({ queryKey: ['auctions'] });
      queryClient.invalidateQueries({ queryKey: ACTIVE_AUCTION_QUERY_KEY });
    },
    onError: (error) => {
      const reason = String(error?.message || 'UNKNOWN').toUpperCase();
      setFeedback({ type: 'error', message: `Ouverture forcée impossible (${reason.toLowerCase()}).` });
    },
  });

  const forceCloseMutation = useMutation({
    mutationFn: async ({ sessionId }) => {
      const { data, error } = await supabase.rpc('admin_force_close_auction_session_reborn', {
        p_session_id: sessionId,
      });
      if (error) throw error;
      if (!data?.success) throw new Error(String(data?.reason || 'UNKNOWN'));
      return data;
    },
    onSuccess: () => {
      setFeedback({ type: 'success', message: 'Les enchères ont été clôturées immédiatement.' });
      queryClient.invalidateQueries({ queryKey: ['auctions'] });
      queryClient.invalidateQueries({ queryKey: ACTIVE_AUCTION_QUERY_KEY });
    },
    onError: (error) => {
      const reason = String(error?.message || 'UNKNOWN').toUpperCase();
      setFeedback({ type: 'error', message: `Clôture forcée impossible (${reason.toLowerCase()}).` });
    },
  });

  const cancelSessionMutation = useMutation({
    mutationFn: async ({ sessionId }) => {
      const { data, error } = await supabase.rpc('admin_cancel_auction_session_reborn', {
        p_session_id: sessionId,
      });
      if (error) throw error;
      if (!data?.success) throw new Error(String(data?.reason || 'UNKNOWN'));
      return data;
    },
    onSuccess: () => {
      setFeedback({ type: 'success', message: 'Session annulée : aucun bétail ni argent n’a été transféré.' });
      queryClient.invalidateQueries({ queryKey: ['auctions'] });
      queryClient.invalidateQueries({ queryKey: ACTIVE_AUCTION_QUERY_KEY });
    },
    onError: (error) => {
      const reason = String(error?.message || 'UNKNOWN').toUpperCase();
      setFeedback({ type: 'error', message: `Annulation impossible (${reason.toLowerCase()}).` });
    },
  });

  const hideWinnerAnnouncementMutation = useMutation({
    mutationFn: async (sessionId) => {
      const { error } = await supabase
        .from('auction_config_reborn')
        .update({ hidden_winner_session_id: sessionId, updated_at: new Date().toISOString() })
        .eq('id', true);
      if (error) throw error;
    },
    onSuccess: () => {
      setFeedback({ type: 'success', message: 'Le bandeau du dernier gagnant a été masqué.' });
      queryClient.invalidateQueries({ queryKey: WINNER_ANNOUNCEMENT_QUERY_KEY });
      queryClient.invalidateQueries({ queryKey: ['home', 'auction-winner-announcement'] });
    },
    onError: (error) => setFeedback({ type: 'error', message: error?.message || 'Impossible de masquer le bandeau.' }),
  });

  const activeSession = activeSessionQuery.data?.session || null;
  const activeStatus = getStatusDetails(activeSession, nowTick);
  const winnerAnnouncement = winnerAnnouncementQuery.data?.active ? winnerAnnouncementQuery.data : null;

  const isBusy =
    saveConfigMutation.isPending ||
    launchSessionMutation.isPending ||
    forceOpenMutation.isPending ||
    forceCloseMutation.isPending ||
    cancelSessionMutation.isPending ||
    hideWinnerAnnouncementMutation.isPending;

  const canSave = useMemo(() => {
    if (!draft) return false;
    return true;
  }, [draft]);

  if (!isActive || !isAdmin) return null;

  return (
    <div className="settings-section settings-admin-auctions">
      <h3 className="settings-section-title">Administration - Enchères</h3>
      <div className="settings-list">
        {winnerAnnouncement ? (
          <div className="settings-item settings-item--stacked settings-admin-auctions__winner-alert">
            <div>
              <p className="settings-item-title">Bandeau gagnant actuellement visible</p>
              <p className="settings-item-subtitle">
                {winnerAnnouncement.winner_username} · {winnerAnnouncement.betail_name} · {Number(winnerAnnouncement.winning_amount || 0).toLocaleString('fr-FR')} 💸
              </p>
            </div>
            <button
              type="button"
              className="settings-action settings-admin-auctions__cancel"
              disabled={hideWinnerAnnouncementMutation.isPending}
              onClick={() => hideWinnerAnnouncementMutation.mutate(winnerAnnouncement.session_id)}
            >
              Masquer maintenant
            </button>
          </div>
        ) : null}

        <div className="settings-item settings-item--stacked settings-admin-auctions__active-section">
          <div>
            <p className="settings-item-title">Session active: contrôle rapide</p>
            <p className="settings-item-subtitle">Contrôle l’ouverture, la clôture ou l’annulation complète de la session.</p>
          </div>

          {activeSession ? (
            <>
              <div className="settings-admin-auctions__live-card">
                <span className="settings-admin-auctions__live-dot" aria-hidden="true" />
                <div>
                  <span className="settings-admin-auctions__live-label">Session en cours</span>
                  <strong>{activeStatus.label}</strong>
                </div>
                <div className="settings-admin-auctions__countdown">
                  <span>{activeStatus.countdownLabel}</span>
                  <strong>{activeStatus.countdown || '--:--:--'}</strong>
                </div>
                <span className="settings-admin-auctions__slots">{Number(activeSession.slots_count || 0)} slots</span>
              </div>
              <div className="settings-admin-auctions__actions-row">
                {(activeSession.status === 'filling' || activeSession.status === 'ready_delay') ? (
                  <button
                    type="button"
                    className="settings-action settings-admin-auctions__force-open"
                    disabled={isBusy}
                    onClick={() => {
                      setFeedback(emptyFeedback);
                      forceOpenMutation.mutate({ sessionId: activeSession.id });
                    }}
                  >
                    Forcer l'ouverture des enchères
                  </button>
                ) : null}

                {activeSession.status === 'open' ? (
                  <button
                    type="button"
                    className="settings-action settings-admin-auctions__force-close"
                    disabled={isBusy}
                    onClick={() => {
                      setFeedback(emptyFeedback);
                      forceCloseMutation.mutate({ sessionId: activeSession.id });
                    }}
                  >
                    Clôturer les enchères maintenant
                  </button>
                ) : null}

                <button
                  type="button"
                  className="settings-action settings-admin-auctions__cancel"
                  disabled={isBusy}
                  onClick={() => {
                    const confirmed = window.confirm('Annuler entièrement cette session ? Tous les bétails seront rendus et aucun argent ne sera débité.');
                    if (!confirmed) return;
                    setFeedback(emptyFeedback);
                    cancelSessionMutation.mutate({ sessionId: activeSession.id });
                  }}
                >
                  <Ban size={14} />
                  Annuler la session
                </button>
              </div>
            </>
          ) : (
            <p className="settings-item-subtitle">Aucune session active en ce moment.</p>
          )}
        </div>

        <div className="settings-item settings-item--stacked">
          <div className="settings-item-row">
            <div>
              <p className="settings-item-title">Roulement automatique</p>
              <p className="settings-item-subtitle">Active ou désactive la génération auto des sessions.</p>
            </div>
            <label className={`settings-switch ${isBusy ? 'is-busy' : ''}`}>
              <input
                type="checkbox"
                checked={Boolean(draft?.enabled)}
                onChange={(event) => {
                  setDraft((current) => (current ? { ...current, enabled: event.target.checked } : current));
                }}
                disabled={!draft || isBusy}
              />
              <span className="settings-slider" />
            </label>
          </div>

          <div className="settings-admin-auctions__grid">
            <label className="settings-admin-auctions__field">
              Fréquence hebdo (0-7)
              <input
                type="number"
                min={0}
                max={7}
                value={draft?.weekly_sessions_target ?? 4}
                onChange={(event) => {
                  const next = clampInt(event.target.value, 0, 7, 4);
                  setDraft((current) => (current ? { ...current, weekly_sessions_target: next } : current));
                }}
                disabled={!draft || isBusy}
              />
            </label>

            <label className="settings-admin-auctions__field settings-admin-auctions__field--switch">
              <span>Bandeau enchères sur l’accueil</span>
              <label className={`settings-switch ${isBusy ? 'is-busy' : ''}`}>
                <input
                  type="checkbox"
                  checked={Boolean(draft?.homepage_messages_enabled)}
                  onChange={(event) => {
                    setDraft((current) => (current ? { ...current, homepage_messages_enabled: event.target.checked } : current));
                  }}
                  disabled={!draft || isBusy}
                />
                <span className="settings-slider" />
              </label>
            </label>

            <label className="settings-admin-auctions__field">
              Temps de remplissage (heures)
              <input
                type="number"
                min={1}
                max={72}
                value={draft?.fill_timeout_hours ?? 12}
                onChange={(event) => {
                  const next = clampInt(event.target.value, 1, 72, 12);
                  setDraft((current) => (current ? { ...current, fill_timeout_hours: next } : current));
                }}
                disabled={!draft || isBusy}
              />
            </label>

            <label className="settings-admin-auctions__field">
              Délai avant ouverture auto (minutes)
              <input
                type="number"
                min={1}
                max={1440}
                value={draft?.open_delay_minutes ?? 60}
                onChange={(event) => {
                  const next = clampInt(event.target.value, 1, 1440, 60);
                  setDraft((current) => (current ? { ...current, open_delay_minutes: next } : current));
                }}
                disabled={!draft || isBusy}
              />
            </label>

            <label className="settings-admin-auctions__field">
              Durée des enchères auto (heures)
              <input
                type="number"
                min={1}
                max={72}
                value={draft?.duration_hours ?? 8}
                onChange={(event) => {
                  const next = clampInt(event.target.value, 1, 72, 8);
                  setDraft((current) => (current ? { ...current, duration_hours: next } : current));
                }}
                disabled={!draft || isBusy}
              />
            </label>

            <label className="settings-admin-auctions__field settings-admin-auctions__field--switch">
              <span>Afficher le dernier gagnant</span>
              <label className={`settings-switch ${isBusy ? 'is-busy' : ''}`}>
                <input
                  type="checkbox"
                  checked={Boolean(draft?.winner_announcement_enabled)}
                  onChange={(event) => setDraft((current) => (current ? { ...current, winner_announcement_enabled: event.target.checked } : current))}
                  disabled={!draft || isBusy}
                />
                <span className="settings-slider" />
              </label>
            </label>

            <label className="settings-admin-auctions__field">
              Durée du bandeau gagnant (minutes)
              <input
                type="number"
                min={1}
                max={1440}
                value={draft?.winner_announcement_minutes ?? 60}
                onChange={(event) => {
                  const next = clampInt(event.target.value, 1, 1440, 60);
                  setDraft((current) => (current ? { ...current, winner_announcement_minutes: next } : current));
                }}
                disabled={!draft || isBusy}
              />
            </label>
          </div>

          <button
            type="button"
            className="settings-action settings-action--primary settings-admin-auctions__save"
            disabled={!canSave || isBusy}
            onClick={() => {
              if (!draft) return;
              setFeedback(emptyFeedback);
              saveConfigMutation.mutate(draft);
            }}
          >
            <Sparkles size={14} />
            Sauvegarder la config
          </button>
        </div>

        <div className="settings-item settings-item--stacked">
          <div>
            <p className="settings-item-title">Lancer une session manuelle</p>
            <p className="settings-item-subtitle">Choisis slots et délais pour la session forcée.</p>
          </div>

          <div className="settings-admin-auctions__grid">
            <label className="settings-admin-auctions__field">
              Nombre de slots
              <input
                type="number"
                min={draft?.slot_min ?? 2}
                max={draft?.slot_max ?? 5}
                value={launchForm.slotsCount}
                onChange={(event) => {
                  const next = clampInt(event.target.value, draft?.slot_min ?? 2, draft?.slot_max ?? 5, draft?.slot_min ?? 2);
                  setLaunchForm((current) => ({ ...current, slotsCount: next }));
                }}
                disabled={!draft || isBusy}
              />
            </label>

            <label className="settings-admin-auctions__field">
              Délai ouverture (minutes)
              <input
                type="number"
                min={1}
                max={1440}
                value={launchForm.openDelayMinutes}
                onChange={(event) => {
                  const next = clampInt(event.target.value, 1, 1440, draft?.open_delay_minutes ?? 60);
                  setLaunchForm((current) => ({ ...current, openDelayMinutes: next }));
                }}
                disabled={!draft || isBusy}
              />
            </label>

            <label className="settings-admin-auctions__field">
              Durée session (heures)
              <input
                type="number"
                min={1}
                max={72}
                value={launchForm.durationHours}
                onChange={(event) => {
                  const next = clampInt(event.target.value, 1, 72, draft?.duration_hours ?? 8);
                  setLaunchForm((current) => ({ ...current, durationHours: next }));
                }}
                disabled={!draft || isBusy}
              />
            </label>
          </div>

          <button
            type="button"
            className="settings-action settings-admin-auctions__launch"
            disabled={!draft || isBusy}
            onClick={() => {
              setFeedback(emptyFeedback);
              launchSessionMutation.mutate(launchForm);
            }}
          >
            <Gavel size={14} />
            Lancer la session
          </button>
        </div>

        <div className="settings-item settings-item--stacked">
          <div className="settings-item-row">
            <div>
              <p className="settings-item-title">Rappels</p>
              <p className="settings-item-subtitle">Le cron doit exécuter auction_tick_reborn pour le roulement automatique.</p>
            </div>
            <Timer size={16} aria-hidden="true" />
          </div>
          {feedback.message ? (
            <p className={`settings-admin-auctions__feedback ${feedback.type === 'error' ? 'is-error' : 'is-success'}`}>
              {feedback.message}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export default Settings_AdminAuctionsPanel;
