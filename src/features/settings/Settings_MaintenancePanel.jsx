import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../authentification/supabaseClient';
import { createSafeAudio, playAudioSafely } from '../utils/safeAudio';
import maintenanceOffSound from '../../assets/sounds/CH1_GRP1_00000005.wav';
import maintenanceOnSound from '../../assets/sounds/CH1_GRP1_00000006.wav';
import { WAITING_SOUND_OPTIONS, isWaitingSoundKey, resolveWaitingSoundUrl } from '../other/waitingSoundOptions';

const MAINTENANCE_QUERY_KEY = ['settings', 'admin', 'maintenance-config'];

const DEFAULT_CONFIG = {
  enabled: false,
  page_variant: 'maintenance',
  title: 'La ferme passe en atelier',
  message: 'Nous préparons une version plus stable et plus rapide. Merci pour votre patience.',
  eta_text: '',
  music_url: '',
};

const TITLE_PRESETS = [
  'FarmGestion arrive prochainement',
  'Milo s’occupe de la maintenance',
  'Les mères optimisent la ferme',
  'Pas d\'expedition pour le moment !',
  'Isabella fait du tri dans les stocks',
];

const MESSAGE_PRESETS = [
  'Nous préparons une version plus stable et plus rapide. Merci pour votre patience.',
  'Milo et Isabella travaillent dur pour remettre la ferme en ligne au plus vite.',
  'Soeur Krone est en pleine inspection de sécurité. Revenez bientôt !',
  'Les bétails sont en train de se faire une beauté. La ferme rouvrira ses portes dès qu\'ils seront prêts.',
  'Les fermes sont en alerte rouge, Isabella et Milo font tout leur possible pour régler le problème',
];

const toSafeText = (value, fallback = '') => String(value ?? fallback).trim();

const normalizeConfigFromRow = (row) => ({
  enabled: Boolean(row?.enabled),
  page_variant: String(row?.page_variant || 'maintenance').toLowerCase() === 'waiting' ? 'waiting' : 'maintenance',
  title: toSafeText(row?.title, DEFAULT_CONFIG.title),
  message: toSafeText(row?.message, DEFAULT_CONFIG.message),
  eta_text: toSafeText(row?.eta_text),
  music_url: toSafeText(row?.music_url),
});

function Settings_MaintenancePanel({ isActive, isAdmin }) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState(DEFAULT_CONFIG);
  const [feedback, setFeedback] = useState({ type: '', message: '' });
  const previousCloudflareStatusRef = useRef(null);
  const previewAudioRef = useRef(null);
  const [isPreviewPlaying, setIsPreviewPlaying] = useState(false);

  const maintenanceOnAudio = useMemo(() => createSafeAudio(maintenanceOnSound, { preload: 'auto', volume: 0.78 }), []);
  const maintenanceOffAudio = useMemo(() => createSafeAudio(maintenanceOffSound, { preload: 'auto', volume: 0.78 }), []);

  const configQuery = useQuery({
    queryKey: MAINTENANCE_QUERY_KEY,
    enabled: Boolean(isActive && isAdmin),
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke('save-maintenance-config', {
        body: { action: 'status' },
      });
      if (error) throw error;
      if (!data?.success) {
        throw new Error(data?.error || 'Impossible de charger le statut maintenance');
      }

      return {
        ...normalizeConfigFromRow(data?.config || DEFAULT_CONFIG),
        updated_at: data?.config?.updated_at || null,
        cloudflare_enabled: Boolean(data?.cloudflare?.enabled),
        cloudflare_rule_id: String(data?.cloudflare?.rule_id || ''),
      };
    },
    staleTime: 15_000,
    gcTime: 300_000,
    retry: 1,
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    if (!configQuery.data) return;
    setDraft(normalizeConfigFromRow(configQuery.data));
  }, [configQuery.data]);

  useEffect(() => () => {
    try {
      previewAudioRef.current?.pause();
    } catch {
      // noop
    }
  }, []);

  const saveMutation = useMutation({
    mutationFn: async (nextDraft) => {
      const payload = {
        action: 'save',
        enabled: Boolean(nextDraft.enabled),
        page_variant: nextDraft.page_variant === 'waiting' ? 'waiting' : 'maintenance',
        title: toSafeText(nextDraft.title, DEFAULT_CONFIG.title).slice(0, 160),
        message: toSafeText(nextDraft.message, DEFAULT_CONFIG.message).slice(0, 700),
        eta_text: toSafeText(nextDraft.eta_text).slice(0, 140),
        music_url: isWaitingSoundKey(nextDraft.music_url) ? nextDraft.music_url : '',
      };

      const { data, error } = await supabase.functions.invoke('save-maintenance-config', {
        body: payload,
      });

      if (error) throw error;
      if (!data?.success) {
        throw new Error(data?.error || 'Échec de synchronisation maintenance');
      }

      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: MAINTENANCE_QUERY_KEY });
      setFeedback({ type: 'success', message: 'Configuration maintenance enregistrée.' });
    },
    onError: (error) => {
      setFeedback({
        type: 'error',
        message: error?.message || 'Impossible de sauvegarder la maintenance.',
      });
    },
  });

  const syncTestMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke('save-maintenance-config', {
        body: { action: 'sync_test' },
      });
      if (error) throw error;
      if (!data?.success) {
        throw new Error(data?.error || 'Test de synchronisation Cloudflare échoué');
      }
      return data;
    },
    onSuccess: () => {
      setFeedback({ type: 'success', message: 'Test synchro Cloudflare réussi.' });
    },
    onError: (error) => {
      setFeedback({
        type: 'error',
        message: error?.message || 'Test synchro Cloudflare en échec.',
      });
    },
  });

  const titlePresetValue = useMemo(() => {
    if (TITLE_PRESETS.includes(draft.title)) return draft.title;
    return '__custom__';
  }, [draft.title]);

  const messagePresetValue = useMemo(() => {
    if (MESSAGE_PRESETS.includes(draft.message)) return draft.message;
    return '__custom__';
  }, [draft.message]);

  const updatedLabel = useMemo(() => {
    const value = configQuery.data?.updated_at;
    if (!value) return 'Jamais';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'Inconnue';
    return new Intl.DateTimeFormat('fr-FR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(date);
  }, [configQuery.data?.updated_at]);

  const cloudflareEnabled = Boolean(configQuery.data?.cloudflare_enabled);
  const cloudflareRuleId = String(configQuery.data?.cloudflare_rule_id || '').trim();
  const cloudflareLabel = cloudflareEnabled ? 'MAINTENANCE ACTIVE' : 'MAINTENANCE INACTIVE';
  const isBusy = saveMutation.isPending || syncTestMutation.isPending || configQuery.isFetching;
  const selectedSoundUrl = resolveWaitingSoundUrl(draft.music_url);

  useEffect(() => {
    if (!configQuery.isSuccess) return;

    const previous = previousCloudflareStatusRef.current;
    previousCloudflareStatusRef.current = cloudflareEnabled;
    if (previous === null || previous === cloudflareEnabled) return;

    if (cloudflareEnabled) {
      void playAudioSafely(maintenanceOnAudio);
      return;
    }
    void playAudioSafely(maintenanceOffAudio);
  }, [cloudflareEnabled, configQuery.isSuccess, maintenanceOffAudio, maintenanceOnAudio]);

  const handlePreviewSound = async () => {
    if (!selectedSoundUrl) {
      if (previewAudioRef.current) {
        previewAudioRef.current.pause();
      }
      setIsPreviewPlaying(false);
      return;
    }

    if (isPreviewPlaying && previewAudioRef.current) {
      previewAudioRef.current.pause();
      setIsPreviewPlaying(false);
      return;
    }

    const audio = createSafeAudio(selectedSoundUrl, { volume: 0.72, preload: 'auto' });
    audio.loop = false;
    audio.onended = () => setIsPreviewPlaying(false);
    previewAudioRef.current = audio;
    const ok = await playAudioSafely(audio);
    setIsPreviewPlaying(ok);
  };

  if (!isAdmin) {
    return null;
  }

  return (
    <div className="settings-section">
      <h3 className="settings-section-title">Maintenance</h3>

      <div className="settings-maintenance-layout">
        <section className="settings-maintenance-card settings-maintenance-status-card">
          <div className="settings-maintenance-status-head">
            <div>
              <p className="settings-item-title">État réel Cloudflare</p>
              <p className="settings-item-subtitle">Source de vérité récupérée en direct sur la règle.</p>
            </div>
            <span className={`settings-maintenance-pill ${cloudflareEnabled ? 'is-on' : 'is-off'}`}>
              <span className={`settings-maintenance-dot ${cloudflareEnabled ? 'is-on' : 'is-off'}`} aria-hidden="true" />
              {cloudflareLabel}
            </span>
          </div>
          <div className="settings-maintenance-meta">
            <p className="settings-item-subtitle">Dernière mise à jour: {updatedLabel}</p>
            {cloudflareRuleId ? <p className="settings-item-subtitle mono">Rule ID: {cloudflareRuleId}</p> : null}
          </div>
        </section>

        <section className="settings-maintenance-card">
          <div className="settings-maintenance-row">
            <div>
              <p className="settings-item-title">Activation maintenance</p>
              <p className="settings-item-subtitle">Allume ou coupe la redirection publique vers la page dédiée.</p>
            </div>
            <label className="settings-switch settings-maintenance-main-switch">
              <input
                type="checkbox"
                checked={draft.enabled}
                onChange={(event) => {
                  const checked = event.target.checked;
                  setDraft((prev) => ({ ...prev, enabled: checked }));
                }}
                disabled={isBusy || configQuery.isLoading}
              />
              <span className="settings-slider" />
            </label>
          </div>

          <div className="settings-maintenance-actions">
            <button
              type="button"
              className="settings-action"
              onClick={() => syncTestMutation.mutate()}
              disabled={isBusy || configQuery.isLoading}
            >
              {syncTestMutation.isPending ? 'Test en cours...' : 'Tester la synchro'}
            </button>
            <button
              type="button"
              className="settings-action"
              onClick={() => configQuery.refetch()}
              disabled={isBusy || configQuery.isLoading}
            >
              Rafraîchir l’état
            </button>
            <button
              type="button"
              className="settings-action settings-action--primary"
              onClick={() => saveMutation.mutate(draft)}
              disabled={isBusy || configQuery.isLoading}
            >
              {saveMutation.isPending ? 'Enregistrement...' : 'Enregistrer'}
            </button>
          </div>
        </section>

        <section className="settings-maintenance-card settings-maintenance-mode-card">
          <p className="settings-item-title">Style de page publique</p>
          <p className="settings-item-subtitle">Waiting-page pour une ambiance mystérieuse, maintenance pour un message technique.</p>
          <div className="settings-maintenance-radio-group" role="radiogroup" aria-label="Style de la page publique">
            <label className="settings-maintenance-radio">
              <input
                type="radio"
                name="maintenance-page-variant"
                checked={draft.page_variant === 'waiting'}
                onChange={() => setDraft((prev) => ({ ...prev, page_variant: 'waiting' }))}
                disabled={isBusy || configQuery.isLoading}
              />
              <span>Waiting-page (mystérieux)</span>
            </label>
            <label className="settings-maintenance-radio">
              <input
                type="radio"
                name="maintenance-page-variant"
                checked={draft.page_variant === 'maintenance'}
                onChange={() => setDraft((prev) => ({ ...prev, page_variant: 'maintenance' }))}
                disabled={isBusy || configQuery.isLoading}
              />
              <span>Maintenance (classique)</span>
            </label>
          </div>
        </section>

        <section className="settings-maintenance-card settings-maintenance-content-card">
          <p className="settings-item-title">Contenu affiché aux visiteurs</p>
          <p className="settings-item-subtitle">Choisis un preset puis ajuste le texte librement si besoin.</p>

          <div className="settings-maintenance-grid">
            <label className="settings-admin-badge-label" htmlFor="maintenance-title-preset">
              Titre prédéfini
              <select
                id="maintenance-title-preset"
                className="settings-admin-badge-input"
                value={titlePresetValue}
                onChange={(event) => {
                  const next = event.target.value;
                  if (next === '__custom__') return;
                  setDraft((prev) => ({ ...prev, title: next }));
                }}
                disabled={isBusy || configQuery.isLoading}
              >
                {TITLE_PRESETS.map((preset) => (
                  <option key={preset} value={preset}>{preset}</option>
                ))}
                <option value="__custom__">Personnalisé</option>
              </select>
            </label>

            <label className="settings-admin-badge-label" htmlFor="maintenance-message-preset">
              Message prédéfini
              <select
                id="maintenance-message-preset"
                className="settings-admin-badge-input"
                value={messagePresetValue}
                onChange={(event) => {
                  const next = event.target.value;
                  if (next === '__custom__') return;
                  setDraft((prev) => ({ ...prev, message: next }));
                }}
                disabled={isBusy || configQuery.isLoading}
              >
                {MESSAGE_PRESETS.map((preset) => (
                  <option key={preset} value={preset}>{preset}</option>
                ))}
                <option value="__custom__">Personnalisé</option>
              </select>
            </label>
          </div>

          <label className="settings-admin-badge-label" htmlFor="maintenance-title">
            Titre principal
            <input
              id="maintenance-title"
              className="settings-admin-badge-input"
              type="text"
              maxLength={160}
              value={draft.title}
              onChange={(event) => setDraft((prev) => ({ ...prev, title: event.target.value }))}
              placeholder="Le portail est scellé jusqu'au prochain signal"
              disabled={isBusy || configQuery.isLoading}
            />
          </label>

          <label className="settings-admin-badge-label" htmlFor="maintenance-message">
            Message principal
            <textarea
              id="maintenance-message"
              className="settings-admin-badge-input settings-admin-surprise-description-input"
              maxLength={700}
              value={draft.message}
              onChange={(event) => setDraft((prev) => ({ ...prev, message: event.target.value }))}
              placeholder="Message affiché aux visiteurs pendant la période privée."
              disabled={isBusy || configQuery.isLoading}
            />
          </label>

          <div className="settings-maintenance-grid">
            <label className="settings-admin-badge-label" htmlFor="maintenance-eta">
              Temps estimé (optionnel)
              <input
                id="maintenance-eta"
                className="settings-admin-badge-input"
                type="text"
                maxLength={140}
                value={draft.eta_text}
                onChange={(event) => setDraft((prev) => ({ ...prev, eta_text: event.target.value }))}
                placeholder="Ex: Retour estimé vers 19h30"
                disabled={isBusy || configQuery.isLoading}
              />
            </label>

            <label className="settings-admin-badge-label" htmlFor="maintenance-music-url">
              Son d'ambiance (optionnel)
              <div className="settings-maintenance-sound-row">
                <select
                  id="maintenance-music-url"
                  className="settings-admin-badge-input"
                  value={isWaitingSoundKey(draft.music_url) ? draft.music_url : ''}
                  onChange={(event) => {
                    const next = String(event.target.value || '');
                    setDraft((prev) => ({ ...prev, music_url: next }));
                    setIsPreviewPlaying(false);
                    if (previewAudioRef.current) previewAudioRef.current.pause();
                  }}
                  disabled={isBusy || configQuery.isLoading}
                >
                  {WAITING_SOUND_OPTIONS.map((option) => (
                    <option key={option.key || 'none'} value={option.key}>{option.label}</option>
                  ))}
                </select>
                <button
                  type="button"
                  className="settings-action"
                  onClick={handlePreviewSound}
                  disabled={!selectedSoundUrl || isBusy || configQuery.isLoading}
                >
                  {isPreviewPlaying ? 'Pause' : 'Préécouter'}
                </button>
              </div>
            </label>
          </div>
        </section>

        {feedback.message ? (
          <p className={`settings-maintenance-feedback ${feedback.type === 'error' ? 'is-error' : 'is-success'}`}>
            {feedback.message}
          </p>
        ) : null}
      </div>
    </div>
  );
}

export default Settings_MaintenancePanel;
