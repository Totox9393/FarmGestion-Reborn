import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../authentification/supabaseClient';
import { createSafeAudio, playAudioSafely } from '../utils/safeAudio';
import maintenanceOffSound from '../../assets/sounds/CH1_GRP1_00000005.wav';
import maintenanceOnSound from '../../assets/sounds/CH1_GRP1_00000006.wav';
import { WAITING_SOUND_OPTIONS, isWaitingSoundKey, resolveWaitingSoundUrl } from '../other/waitingSoundOptions';

const MAINTENANCE_QUERY_KEY = ['settings', 'admin', 'maintenance-config'];
const MAINTENANCE_ALLOWLIST_QUERY_KEY = ['settings', 'admin', 'maintenance-allowlist'];

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

const extractTraceValue = (raw, key) => {
  const lines = String(raw || '').split(/\r?\n/);
  const match = lines.find((line) => line.toLowerCase().startsWith(`${String(key || '').toLowerCase()}=`));
  if (!match) return '';
  const [, value] = match.split('=');
  return String(value || '').trim();
};

const normalizeMaybeIp = (value) => {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const first = raw.split(',')[0]?.trim() || '';
  return first;
};

const getIpVersion = (value) => {
  const ip = normalizeMaybeIp(value);
  if (!ip) return null;
  if (ip.includes(':')) return 6;
  if (ip.includes('.')) return 4;
  return null;
};

const parseIpv4ToInt = (value) => {
  const ip = normalizeMaybeIp(value);
  const parts = ip.split('.');
  if (parts.length !== 4) return null;

  let acc = 0;
  for (const part of parts) {
    if (!/^\d+$/.test(part)) return null;
    const n = Number(part);
    if (!Number.isInteger(n) || n < 0 || n > 255) return null;
    acc = (acc << 8) + n;
  }
  return acc >>> 0;
};

const parseIpv6ToHextets = (value) => {
  const base = normalizeMaybeIp(value).toLowerCase();
  if (!base || !base.includes(':')) return null;

  const splitDouble = base.split('::');
  if (splitDouble.length > 2) return null;
  const [leftRaw, rightRaw] = splitDouble;

  const parseSide = (side) => {
    if (!side) return [];
    const parts = side.split(':');
    const out = [];
    for (const part of parts) {
      if (!part) return null;
      if (!/^[0-9a-f]{1,4}$/i.test(part)) return null;
      out.push(parseInt(part, 16));
    }
    return out;
  };

  const left = parseSide(leftRaw || '');
  if (!left) return null;
  const right = parseSide(rightRaw || '');
  if (!right) return null;

  if (base.includes('::')) {
    const missing = 8 - (left.length + right.length);
    if (missing < 1) return null;
    return [...left, ...new Array(missing).fill(0), ...right];
  }

  if (left.length !== 8) return null;
  return left;
};

const parseIpv6ToBigInt = (value) => {
  const hextets = parseIpv6ToHextets(value);
  if (!hextets || hextets.length !== 8) return null;
  return hextets.reduce((acc, part) => (acc << 16n) + BigInt(part), 0n);
};

const isIpCoveredByEntry = (ip, entryValue) => {
  const requester = normalizeMaybeIp(ip);
  const entry = normalizeMaybeIp(entryValue);
  if (!requester || !entry) return false;

  const [entryBase, entryPrefixRaw] = entry.split('/');
  const requesterVersion = getIpVersion(requester);
  const entryVersion = getIpVersion(entryBase);
  if (!requesterVersion || !entryVersion || requesterVersion !== entryVersion) return false;

  if (entryPrefixRaw === undefined) {
    return requester.toLowerCase() === entryBase.toLowerCase();
  }

  const prefix = Number(entryPrefixRaw);
  if (!Number.isInteger(prefix)) return false;

  if (requesterVersion === 4) {
    if (prefix < 0 || prefix > 32) return false;
    const requesterInt = parseIpv4ToInt(requester);
    const entryInt = parseIpv4ToInt(entryBase);
    if (requesterInt === null || entryInt === null) return false;
    const mask = prefix === 0 ? 0 : ((0xffffffff << (32 - prefix)) >>> 0);
    return (requesterInt & mask) === (entryInt & mask);
  }

  if (prefix < 0 || prefix > 128) return false;
  const requesterBig = parseIpv6ToBigInt(requester);
  const entryBig = parseIpv6ToBigInt(entryBase);
  if (requesterBig === null || entryBig === null) return false;
  if (prefix === 0) return true;
  const shift = BigInt(128 - prefix);
  return (requesterBig >> shift) === (entryBig >> shift);
};

const readBrowserCloudflareIp = async () => {
  const host = String(window.location.hostname || '').toLowerCase();
  const isLocalHost = host === 'localhost' || host === '127.0.0.1' || host === '::1';
  if (isLocalHost) {
    return {
      ip: '',
      version: '',
      error: 'Controle Cloudflare indisponible en localhost. Ouvre ce panel sur le domaine public.',
    };
  }

  try {
    const response = await fetch('/cdn-cgi/trace', {
      cache: 'no-store',
      headers: { Accept: 'text/plain' },
    });
    if (!response.ok) {
      throw new Error('Trace HTTP non disponible');
    }

    const raw = await response.text();
    const ip = extractTraceValue(raw, 'ip');
    const version = ip.includes(':') ? 'IPv6' : ip ? 'IPv4' : '';
    return {
      ip,
      version,
      error: ip ? '' : 'IP Cloudflare introuvable dans /cdn-cgi/trace.',
    };
  } catch {
    return {
      ip: '',
      version: '',
      error: 'Impossible de verifier l\'IP Cloudflare navigateur (/cdn-cgi/trace).',
    };
  }
};

const invokeMaintenanceFunction = async (payload) => {
  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  if (sessionError) {
    throw new Error(sessionError.message || 'Impossible de verifier la session utilisateur.');
  }

  const accessToken = sessionData?.session?.access_token;
  if (!accessToken) {
    throw new Error('Session expirée. Reconnecte-toi puis réessaie.');
  }

  const { data, error } = await supabase.functions.invoke('save-maintenance-config', {
    body: payload,
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (error) {
    let details = '';
    const context = error?.context;
    if (context && typeof context.json === 'function') {
      try {
        const body = await context.json();
        details = String(body?.error || body?.message || '');
      } catch {
        // noop
      }
    }

    throw new Error(details || error.message || 'Erreur Edge Function');
  }
  return data;
};

function Settings_MaintenancePanel({ isActive, isAdmin }) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState(DEFAULT_CONFIG);
  const [feedback, setFeedback] = useState({ type: '', message: '' });
  const [allowlistInput, setAllowlistInput] = useState('');
  const [allowlistComment, setAllowlistComment] = useState('');
  const [browserProbe, setBrowserProbe] = useState({
    loading: false,
    ip: '',
    version: '',
    error: '',
  });
  const previousCloudflareStatusRef = useRef(null);
  const previewAudioRef = useRef(null);
  const [isPreviewPlaying, setIsPreviewPlaying] = useState(false);

  const maintenanceOnAudio = useMemo(() => createSafeAudio(maintenanceOnSound, { preload: 'auto', volume: 0.78 }), []);
  const maintenanceOffAudio = useMemo(() => createSafeAudio(maintenanceOffSound, { preload: 'auto', volume: 0.78 }), []);

  const configQuery = useQuery({
    queryKey: MAINTENANCE_QUERY_KEY,
    enabled: Boolean(isActive && isAdmin),
    queryFn: async () => {
      const data = await invokeMaintenanceFunction({ action: 'status' });
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

  const allowlistQuery = useQuery({
    queryKey: MAINTENANCE_ALLOWLIST_QUERY_KEY,
    enabled: Boolean(isActive && isAdmin),
    queryFn: async () => {
      const data = await invokeMaintenanceFunction({ action: 'allowlist_status' });
      if (!data?.success) {
        throw new Error(data?.error || 'Impossible de charger la liste des IP autorisées');
      }

      return {
        list_id: String(data?.allowlist?.list_id || ''),
        list_name: String(data?.allowlist?.list_name || ''),
        requester_ip: String(data?.allowlist?.requester_ip || ''),
        requester_allowed: Boolean(data?.allowlist?.requester_allowed),
        total: Number(data?.allowlist?.total || 0),
        items: Array.isArray(data?.allowlist?.items)
          ? data.allowlist.items.map((item) => ({
            id: String(item?.id || ''),
            value: String(item?.value || ''),
            comment: String(item?.comment || ''),
            modified_on: String(item?.modified_on || ''),
          })).filter((item) => item.id && item.value)
          : [],
      };
    },
    staleTime: 12_000,
    gcTime: 240_000,
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

      const data = await invokeMaintenanceFunction(payload);
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
      const data = await invokeMaintenanceFunction({ action: 'sync_test' });
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

  const allowlistAddMutation = useMutation({
    mutationFn: async ({ ip, comment }) => {
      const data = await invokeMaintenanceFunction({
        action: 'allowlist_add',
        ip: String(ip || '').trim(),
        comment: String(comment || '').trim(),
      });
      if (!data?.success) {
        throw new Error(data?.error || 'Impossible d\'ajouter cette IP');
      }
      return data;
    },
    onSuccess: () => {
      setAllowlistInput('');
      setAllowlistComment('');
      queryClient.invalidateQueries({ queryKey: MAINTENANCE_ALLOWLIST_QUERY_KEY });
      setFeedback({ type: 'success', message: 'IP autorisée ajoutée.' });
    },
    onError: (error) => {
      setFeedback({ type: 'error', message: error?.message || 'Ajout IP impossible.' });
    },
  });

  const allowlistAddMyIpMutation = useMutation({
    mutationFn: async () => {
      const data = await invokeMaintenanceFunction({
        action: 'allowlist_add_my_ip',
      });
      if (!data?.success) {
        throw new Error(data?.error || 'Impossible d\'ajouter ton IP actuelle');
      }
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: MAINTENANCE_ALLOWLIST_QUERY_KEY });
      setFeedback({ type: 'success', message: 'Ton IP actuelle a été ajoutée à la liste.' });
    },
    onError: (error) => {
      setFeedback({ type: 'error', message: error?.message || 'Ajout auto IP impossible.' });
    },
  });

  const allowlistRemoveMutation = useMutation({
    mutationFn: async ({ itemId }) => {
      const data = await invokeMaintenanceFunction({
        action: 'allowlist_remove',
        item_id: String(itemId || '').trim(),
      });
      if (!data?.success) {
        throw new Error(data?.error || 'Impossible de supprimer cette IP');
      }
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: MAINTENANCE_ALLOWLIST_QUERY_KEY });
      setFeedback({ type: 'success', message: 'IP retirée de la liste autorisée.' });
    },
    onError: (error) => {
      setFeedback({ type: 'error', message: error?.message || 'Suppression IP impossible.' });
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
  const isAllowlistBusy = allowlistAddMutation.isPending || allowlistAddMyIpMutation.isPending || allowlistRemoveMutation.isPending;
  const allowlistItems = allowlistQuery.data?.items || [];
  const requesterIp = String(allowlistQuery.data?.requester_ip || '').trim();
  const requesterAllowed = Boolean(allowlistQuery.data?.requester_allowed);
  const allowlistTotal = Number(allowlistQuery.data?.total || allowlistItems.length || 0);
  const selectedSoundUrl = resolveWaitingSoundUrl(draft.music_url);

  const browserAllowed = useMemo(() => {
    if (!browserProbe.ip) return false;
    return allowlistItems.some((item) => isIpCoveredByEntry(browserProbe.ip, String(item?.value || '')));
  }, [allowlistItems, browserProbe.ip]);

  const precheckAllowed = browserProbe.ip ? browserAllowed : requesterAllowed;
  const precheckLoading = allowlistQuery.isLoading || browserProbe.loading;

  const refreshBrowserProbe = useCallback(async () => {
    setBrowserProbe((prev) => ({ ...prev, loading: true, error: '' }));
    const next = await readBrowserCloudflareIp();
    setBrowserProbe({
      loading: false,
      ip: String(next?.ip || ''),
      version: String(next?.version || ''),
      error: String(next?.error || ''),
    });
  }, []);

  const handleAddAllowlistIp = () => {
    const candidate = String(allowlistInput || '').trim();
    if (!candidate) {
      setFeedback({ type: 'error', message: 'Saisis une IP ou un CIDR avant d\'ajouter.' });
      return;
    }
    allowlistAddMutation.mutate({ ip: candidate, comment: allowlistComment });
  };

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

  useEffect(() => {
    if (!isActive || !isAdmin) return;
    void refreshBrowserProbe();
  }, [isActive, isAdmin, refreshBrowserProbe]);

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

        <section className="settings-maintenance-card settings-maintenance-allowlist-card">
          <div className="settings-maintenance-status-head">
            <div>
              <p className="settings-item-title">IPs autorisées (bypass maintenance)</p>
              <p className="settings-item-subtitle">Verification prioritaire via IP Cloudflare navigateur (IPv4 ou IPv6), avec fallback Supabase.</p>
            </div>
            <span className={`settings-maintenance-pill ${precheckLoading ? 'is-off' : precheckAllowed ? 'is-on' : 'is-off'}`}>
              <span className={`settings-maintenance-dot ${precheckLoading ? 'is-off' : precheckAllowed ? 'is-on' : 'is-off'}`} aria-hidden="true" />
              {precheckLoading
                ? 'VERIFICATION EN COURS...'
                : precheckAllowed
                  ? 'ACCES APPAREIL OK'
                  : 'ACCES APPAREIL NON AUTORISE'}
            </span>
          </div>

          <div className="settings-maintenance-meta">
            <p className="settings-item-subtitle">Total IPs autorisées: {allowlistTotal}</p>
            {browserProbe.ip ? (
              <p className="settings-item-subtitle mono">
                IP navigateur (Cloudflare): {browserProbe.ip}{browserProbe.version ? ` (${browserProbe.version})` : ''}
              </p>
            ) : null}
            {!browserProbe.ip && browserProbe.error ? <p className="settings-item-subtitle">{browserProbe.error}</p> : null}
            {browserProbe.ip ? (
              <p className="settings-item-subtitle">
                Resultat matching liste (navigateur): {browserAllowed ? 'Autorise' : 'Non autorise'}
              </p>
            ) : null}
            {requesterIp ? <p className="settings-item-subtitle mono">IP vue par Supabase: {requesterIp}</p> : null}
            <p className="settings-item-subtitle">Note: l'IP Supabase peut differer de l'IP Cloudflare du navigateur selon le chemin reseau.</p>
            {allowlistQuery.data?.list_id ? <p className="settings-item-subtitle mono">List ID: {allowlistQuery.data.list_id}</p> : null}
          </div>

          <div className="settings-maintenance-allowlist-editor">
            <input
              className="settings-admin-badge-input"
              type="text"
              value={allowlistInput}
              onChange={(event) => setAllowlistInput(event.target.value)}
              placeholder="Ex: 31.36.183.232 ou 31.36.183.0/24"
              disabled={allowlistQuery.isLoading || isAllowlistBusy}
            />
            <input
              className="settings-admin-badge-input"
              type="text"
              value={allowlistComment}
              onChange={(event) => setAllowlistComment(event.target.value)}
              placeholder="Commentaire optionnel"
              disabled={allowlistQuery.isLoading || isAllowlistBusy}
            />
            <div className="settings-maintenance-actions">
              <button
                type="button"
                className="settings-action"
                onClick={() => {
                  void allowlistQuery.refetch();
                  void refreshBrowserProbe();
                }}
                disabled={allowlistQuery.isLoading || isAllowlistBusy}
              >
                Rafraîchir la liste
              </button>
              <button
                type="button"
                className="settings-action"
                onClick={() => allowlistAddMyIpMutation.mutate()}
                disabled={allowlistQuery.isLoading || isAllowlistBusy}
              >
                {allowlistAddMyIpMutation.isPending ? 'Ajout en cours...' : 'Ajouter mon IP actuelle'}
              </button>
              <button
                type="button"
                className="settings-action settings-action--primary"
                onClick={handleAddAllowlistIp}
                disabled={allowlistQuery.isLoading || isAllowlistBusy}
              >
                {allowlistAddMutation.isPending ? 'Ajout en cours...' : 'Ajouter IP'}
              </button>
            </div>
          </div>

          {allowlistQuery.isLoading ? (
            <p className="settings-item-subtitle">Chargement des IPs autorisées...</p>
          ) : allowlistQuery.isError ? (
            <p className="settings-maintenance-feedback is-error">
              {allowlistQuery.error?.message || 'Impossible de charger la liste IP autorisée.'}
            </p>
          ) : allowlistItems.length === 0 ? (
            <p className="settings-item-subtitle">Aucune IP autorisée pour le moment.</p>
          ) : (
            <div className="settings-maintenance-allowlist-list">
              {allowlistItems.map((item) => (
                <article key={item.id} className="settings-maintenance-allowlist-item">
                  <div className="settings-maintenance-allowlist-texts">
                    <p className="settings-maintenance-allowlist-ip mono">{item.value}</p>
                    {item.comment ? <p className="settings-item-subtitle">{item.comment}</p> : null}
                  </div>
                  <button
                    type="button"
                    className="settings-action settings-action--danger"
                    onClick={() => allowlistRemoveMutation.mutate({ itemId: item.id })}
                    disabled={isAllowlistBusy}
                  >
                    Retirer
                  </button>
                </article>
              ))}
            </div>
          )}
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
