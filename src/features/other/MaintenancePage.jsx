import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import './MaintenancePage.css';
import logoIco from '../../assets/logo_ico.png';
import { supabase } from '../authentification/supabaseClient';
import { resolveWaitingSoundUrl } from './waitingSoundOptions';
import { createSafeAudio, playAudioSafely } from '../utils/safeAudio';

const DEFAULT_CONFIG = {
  enabled: false,
  page_variant: 'maintenance',
  title: 'La ferme passe en atelier',
  message: 'Nous préparons une version plus stable et plus rapide. Merci pour votre patience.',
  eta_text: '',
  music_url: '',
};

function MaintenancePage() {
  const navigate = useNavigate();
  const audioRef = useRef(null);
  const [musicEnabled, setMusicEnabled] = useState(true);
  const [isAudioPlaying, setIsAudioPlaying] = useState(false);
  const [statusTick, setStatusTick] = useState(0);
  const now = new Date();
  const dateLabel = now.toLocaleDateString('fr-FR', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  });

  const configQuery = useQuery({
    queryKey: ['maintenance', 'public-config'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('site_maintenance_config')
        .select('enabled,page_variant,title,message,eta_text,music_url')
        .eq('id', true)
        .maybeSingle();

      if (error) throw error;
      return data || null;
    },
    staleTime: 30_000,
    gcTime: 300_000,
    retry: 1,
    refetchOnWindowFocus: false,
  });

  const config = useMemo(() => {
    const row = configQuery.data || {};
    return {
      enabled: Boolean(row.enabled),
      pageVariant: String(row.page_variant || DEFAULT_CONFIG.page_variant).toLowerCase() === 'waiting' ? 'waiting' : 'maintenance',
      title: String(row.title || DEFAULT_CONFIG.title).trim() || DEFAULT_CONFIG.title,
      message: String(row.message || DEFAULT_CONFIG.message).trim() || DEFAULT_CONFIG.message,
      etaText: String(row.eta_text || '').trim(),
      musicUrl: String(row.music_url || '').trim(),
    };
  }, [configQuery.data]);

  useEffect(() => {
    if (!configQuery.isFetched) return;
    if (config.enabled) return;
    navigate('/', { replace: true });
  }, [config.enabled, configQuery.isFetched, navigate]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setStatusTick((value) => value + 1);
    }, 2600);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (audioRef.current) {
      try {
        audioRef.current.pause();
      } catch {
        // noop
      }
      audioRef.current = null;
    }

    setMusicEnabled(true);
    setIsAudioPlaying(false);
  }, [config.musicUrl]);

  const resolvedMusicUrl = resolveWaitingSoundUrl(config.musicUrl);

  const tryStartAudio = async () => {
    const audio = audioRef.current;
    if (!audio || !resolvedMusicUrl || !musicEnabled) return false;
    try {
      await audio.play();
      setIsAudioPlaying(true);
      return true;
    } catch {
      setIsAudioPlaying(false);
      return false;
    }
  };

  useEffect(() => {
    if (audioRef.current) {
      try {
        audioRef.current.pause();
      } catch {
        // noop
      }
      audioRef.current = null;
    }

    if (!resolvedMusicUrl) return;

    const audio = createSafeAudio(resolvedMusicUrl, { volume: 0.34, preload: 'auto' });
    audio.loop = true;
    audio.onpause = () => setIsAudioPlaying(false);
    audio.onplay = () => setIsAudioPlaying(true);
    audioRef.current = audio;

    if (musicEnabled) {
      void playAudioSafely(audio).then((ok) => {
        setIsAudioPlaying(ok);
      });
    }

    return () => {
      try {
        audio.pause();
      } catch {
        // noop
      }
      if (audioRef.current === audio) {
        audioRef.current = null;
      }
    };
  }, [musicEnabled, resolvedMusicUrl]);

  const isWaitingVariant = config.pageVariant === 'waiting';
  const waitingStatusLabels = [
    'Affiliation du bétail en cours',
    'Peinture des fermes en cours',
    'Gupnas en cours de plantation...',
    'Attribution des matricules...',
    'Milo se charge des bétails',
  ];
  const maintenanceStatusLabels = [
    'Intervention système en cours',
    'Vérification des modules critiques',
    'Milo en train de faire le café',
    'Ajout de nouvelles fonctionnalités...',
    'Optimisation de la base de données...',
  ];
  const statusLabel = isWaitingVariant
    ? waitingStatusLabels[statusTick % waitingStatusLabels.length]
    : maintenanceStatusLabels[statusTick % maintenanceStatusLabels.length];

  return (
    <main className={`maintenance-page ${isWaitingVariant ? 'is-waiting' : ''}`} role="main" aria-labelledby="maintenance-title">
      <div className="maintenance-page__mist maintenance-page__mist--a" aria-hidden="true" />
      <div className="maintenance-page__mist maintenance-page__mist--b" aria-hidden="true" />
      <div className="maintenance-page__mist maintenance-page__mist--c" aria-hidden="true" />
      <div className="maintenance-page__grain" aria-hidden="true" />

      <div className="maintenance-page__scene">
        <img className="maintenance-logo" src={logoIco} alt="FarmGestion" width="78" height="78" />
        <p className="maintenance-eyebrow">{isWaitingVariant ? 'FARMGESTION ARRIVE PROCHAINEMENT' : 'MAINTENANCE EN COURS'}</p>

        <h1 id="maintenance-title">{config.title}</h1>
        <p className="maintenance-subtitle">{config.message}</p>

        <div className="maintenance-signal-loader" aria-hidden="true">
          <span className="maintenance-ring maintenance-ring--a" />
          <span className="maintenance-ring maintenance-ring--b" />
          <span className="maintenance-ring maintenance-ring--c" />
          <span className="maintenance-signal-core" />
        </div>

        <div className="maintenance-progress" aria-hidden="true">
          <span className="maintenance-progress__bar" />
        </div>

        <p className="maintenance-status-message">{statusLabel}</p>

        <div className="maintenance-meta">
          <p>
            <strong>État :</strong> {isWaitingVariant ? 'Indisponible' : 'Maintenance en cours'}
          </p>
          {config.etaText ? (
            <p>
              <strong>Retour estimé :</strong> {config.etaText}
            </p>
          ) : null}
          <p>
            <strong>Mise à jour :</strong> {dateLabel}
          </p>
        </div>

        {resolvedMusicUrl ? (
          <div className="maintenance-audio-wrap">
            <button
              type="button"
              className="maintenance-audio-btn maintenance-audio-btn--discrete"
              onClick={async () => {
                const audio = audioRef.current;
                if (!audio) return;

                if (isAudioPlaying) {
                  audio.pause();
                  setMusicEnabled(false);
                  setIsAudioPlaying(false);
                  return;
                }

                setMusicEnabled(true);
                const ok = await playAudioSafely(audio);
                setIsAudioPlaying(ok);
              }}
            >
              <span className="maintenance-audio-btn__icon" aria-hidden="true">{isAudioPlaying ? '❚❚' : '▶'}</span>
              <span>Musique</span>
            </button>
          </div>
        ) : null}
      </div>
    </main>
  );
}

export default MaintenancePage;
