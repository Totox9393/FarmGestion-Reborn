import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../authentification/supabaseClient';

const MAINTENANCE_QUERY_KEY = ['settings', 'admin', 'maintenance-config'];

const DEFAULT_CONFIG = {
  enabled: false,
  page_variant: 'maintenance',
  title: 'La ferme passe en atelier',
  message: 'Nous preparons une version plus stable et plus rapide. Merci pour votre patience.',
  eta_text: '',
  music_url: '',
};

const TITLE_PRESETS = [
  'La ferme passe en atelier',
  'Le portail de la ferme sommeille',
  'Signal brouille, ouverture imminente',
  'Les ecuries se preparent dans l\'ombre',
  'Le mystere de FarmGestion s\'eveille',
];

const MESSAGE_PRESETS = [
  'Nous preparons une version plus stable et plus rapide. Merci pour votre patience.',
  'Les lumieres de la ferme clignotent encore. Revenez dans quelques instants.',
  'Les enclos se calibrent en silence. Une surprise arrive bientot.',
  'L\'acces public reste ferme pour le moment. Le signal reviendra tres vite.',
  'Une phase de preparation est en cours. Merci de patienter pendant le reveil du domaine.',
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

  const configQuery = useQuery({
    queryKey: MAINTENANCE_QUERY_KEY,
    enabled: Boolean(isActive && isAdmin),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('site_maintenance_config')
        .select('enabled,page_variant,title,message,eta_text,music_url,updated_at')
        .eq('id', true)
        .maybeSingle();

      if (error) throw error;
      return {
        ...normalizeConfigFromRow(data || DEFAULT_CONFIG),
        updated_at: data?.updated_at || null,
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

  const saveMutation = useMutation({
    mutationFn: async (nextDraft) => {
      const payload = {
        action: 'save',
        enabled: Boolean(nextDraft.enabled),
        page_variant: nextDraft.page_variant === 'waiting' ? 'waiting' : 'maintenance',
        title: toSafeText(nextDraft.title, DEFAULT_CONFIG.title).slice(0, 160),
        message: toSafeText(nextDraft.message, DEFAULT_CONFIG.message).slice(0, 700),
        eta_text: toSafeText(nextDraft.eta_text).slice(0, 140),
        music_url: toSafeText(nextDraft.music_url).slice(0, 800),
      };

      const { data, error } = await supabase.functions.invoke('save-maintenance-config', {
        body: payload,
      });

      if (error) throw error;
      if (!data?.success) {
        throw new Error(data?.error || 'Echec de synchronisation maintenance');
      }

      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: MAINTENANCE_QUERY_KEY });
      setFeedback({ type: 'success', message: 'Configuration maintenance enregistree.' });
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
        throw new Error(data?.error || 'Test de synchronisation Cloudflare echoue');
      }
      return data;
    },
    onSuccess: () => {
      setFeedback({ type: 'success', message: 'Test synchro Cloudflare reussi.' });
    },
    onError: (error) => {
      setFeedback({
        type: 'error',
        message: error?.message || 'Test synchro Cloudflare en echec.',
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

  if (!isAdmin) {
    return null;
  }

  return (
    <div className="settings-section">
      <h3 className="settings-section-title">Maintenance</h3>

      <div className="settings-list">
        <div className="settings-toggle">
          <div>
            <p className="settings-item-title">Maintenance active</p>
            <p className="settings-item-subtitle">
              Active le mode maintenance pour les contenus relies a la page /maintenance.
            </p>
          </div>
          <label className="settings-switch">
            <input
              type="checkbox"
              checked={draft.enabled}
              onChange={(event) => {
                const checked = event.target.checked;
                setDraft((prev) => ({ ...prev, enabled: checked }));
              }}
              disabled={saveMutation.isPending || configQuery.isLoading}
            />
            <span className="settings-slider" />
          </label>
        </div>

        <div className="settings-item settings-item--column settings-maintenance-mode">
          <div>
            <p className="settings-item-title">Style de page publique</p>
            <p className="settings-item-subtitle">
              Choisis entre une ambience de lancement mysterieux (waiting-page) ou une maintenance classique.
            </p>
          </div>
          <div className="settings-maintenance-radio-group" role="radiogroup" aria-label="Style de la page publique">
            <label className="settings-maintenance-radio">
              <input
                type="radio"
                name="maintenance-page-variant"
                checked={draft.page_variant === 'waiting'}
                onChange={() => setDraft((prev) => ({ ...prev, page_variant: 'waiting' }))}
                disabled={saveMutation.isPending || configQuery.isLoading}
              />
              <span>Waiting-page (mysterieux)</span>
            </label>
            <label className="settings-maintenance-radio">
              <input
                type="radio"
                name="maintenance-page-variant"
                checked={draft.page_variant === 'maintenance'}
                onChange={() => setDraft((prev) => ({ ...prev, page_variant: 'maintenance' }))}
                disabled={saveMutation.isPending || configQuery.isLoading}
              />
              <span>Maintenance (classique)</span>
            </label>
          </div>
        </div>

        <div className="settings-item settings-item--column settings-maintenance-editor">
          <label className="settings-admin-badge-label" htmlFor="maintenance-title-preset">
            Titre predefini (combobox)
            <select
              id="maintenance-title-preset"
              className="settings-admin-badge-input"
              value={titlePresetValue}
              onChange={(event) => {
                const next = event.target.value;
                if (next === '__custom__') return;
                setDraft((prev) => ({ ...prev, title: next }));
              }}
              disabled={saveMutation.isPending || configQuery.isLoading}
            >
              {TITLE_PRESETS.map((preset) => (
                <option key={preset} value={preset}>{preset}</option>
              ))}
              <option value="__custom__">Personnalise</option>
            </select>
          </label>

          <label className="settings-admin-badge-label" htmlFor="maintenance-title">
            Titre principal
            <input
              id="maintenance-title"
              className="settings-admin-badge-input"
              type="text"
              maxLength={160}
              value={draft.title}
              onChange={(event) => setDraft((prev) => ({ ...prev, title: event.target.value }))}
              placeholder="La ferme passe en atelier"
              disabled={saveMutation.isPending || configQuery.isLoading}
            />
          </label>

          <label className="settings-admin-badge-label" htmlFor="maintenance-message-preset">
            Message predefini (combobox)
            <select
              id="maintenance-message-preset"
              className="settings-admin-badge-input"
              value={messagePresetValue}
              onChange={(event) => {
                const next = event.target.value;
                if (next === '__custom__') return;
                setDraft((prev) => ({ ...prev, message: next }));
              }}
              disabled={saveMutation.isPending || configQuery.isLoading}
            >
              {MESSAGE_PRESETS.map((preset) => (
                <option key={preset} value={preset}>{preset}</option>
              ))}
              <option value="__custom__">Personnalise</option>
            </select>
          </label>

          <label className="settings-admin-badge-label" htmlFor="maintenance-message">
            Message maintenance
            <textarea
              id="maintenance-message"
              className="settings-admin-badge-input settings-admin-surprise-description-input"
              maxLength={700}
              value={draft.message}
              onChange={(event) => setDraft((prev) => ({ ...prev, message: event.target.value }))}
              placeholder="Texte principal affiche aux visiteurs."
              disabled={saveMutation.isPending || configQuery.isLoading}
            />
          </label>

          <div className="settings-maintenance-grid">
            <label className="settings-admin-badge-label" htmlFor="maintenance-eta">
              Temps estime (optionnel)
              <input
                id="maintenance-eta"
                className="settings-admin-badge-input"
                type="text"
                maxLength={140}
                value={draft.eta_text}
                onChange={(event) => setDraft((prev) => ({ ...prev, eta_text: event.target.value }))}
                placeholder="Ex: Retour estime vers 19h30"
                disabled={saveMutation.isPending || configQuery.isLoading}
              />
            </label>

            <label className="settings-admin-badge-label" htmlFor="maintenance-music-url">
              URL musique (optionnel)
              <input
                id="maintenance-music-url"
                className="settings-admin-badge-input"
                type="url"
                maxLength={800}
                value={draft.music_url}
                onChange={(event) => setDraft((prev) => ({ ...prev, music_url: event.target.value }))}
                placeholder="https://.../maintenance.mp3"
                disabled={saveMutation.isPending || configQuery.isLoading}
              />
            </label>
          </div>

          <div className="settings-maintenance-actions">
            <button
              type="button"
              className="settings-action"
              onClick={() => syncTestMutation.mutate()}
              disabled={saveMutation.isPending || syncTestMutation.isPending || configQuery.isLoading}
            >
              {syncTestMutation.isPending ? 'Test en cours...' : 'Test synchro'}
            </button>
            <button
              type="button"
              className="settings-action"
              onClick={() => configQuery.refetch()}
              disabled={saveMutation.isPending || syncTestMutation.isPending || configQuery.isFetching}
            >
              Recharger
            </button>
            <button
              type="button"
              className="settings-action settings-action--primary"
              onClick={() => saveMutation.mutate(draft)}
              disabled={saveMutation.isPending || syncTestMutation.isPending || configQuery.isLoading}
            >
              {saveMutation.isPending ? 'Enregistrement...' : 'Enregistrer'}
            </button>
          </div>

          <p className="settings-item-subtitle">Derniere mise a jour: {updatedLabel}</p>

          {feedback.message ? (
            <p className={`settings-maintenance-feedback ${feedback.type === 'error' ? 'is-error' : 'is-success'}`}>
              {feedback.message}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export default Settings_MaintenancePanel;
