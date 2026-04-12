import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import './MaintenancePage.css';
import logoIco from '../../assets/logo_ico.png';
import { supabase } from '../authentification/supabaseClient';

const DEFAULT_CONFIG = {
  page_variant: 'maintenance',
  title: 'La ferme passe en atelier',
  message: 'Nous preparons une version plus stable et plus rapide. Merci pour votre patience.',
  eta_text: '',
  music_url: '',
};

function MaintenancePage() {
  const [musicEnabled, setMusicEnabled] = useState(false);
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
        .select('page_variant,title,message,eta_text,music_url')
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
      pageVariant: String(row.page_variant || DEFAULT_CONFIG.page_variant).toLowerCase() === 'waiting' ? 'waiting' : 'maintenance',
      title: String(row.title || DEFAULT_CONFIG.title).trim() || DEFAULT_CONFIG.title,
      message: String(row.message || DEFAULT_CONFIG.message).trim() || DEFAULT_CONFIG.message,
      etaText: String(row.eta_text || '').trim(),
      musicUrl: String(row.music_url || '').trim(),
    };
  }, [configQuery.data]);

  const isWaitingVariant = config.pageVariant === 'waiting';

  return (
    <main className={`maintenance-page ${isWaitingVariant ? 'is-waiting' : ''}`} role="main" aria-labelledby="maintenance-title">
      <div className="maintenance-page__sky" aria-hidden="true">
        <span className="maintenance-page__blob maintenance-page__blob--a" />
        <span className="maintenance-page__blob maintenance-page__blob--b" />
        <span className="maintenance-page__blob maintenance-page__blob--c" />
      </div>

      {isWaitingVariant ? <div className="maintenance-page__veil" aria-hidden="true" /> : null}

      <section className="maintenance-card">
        <img className="maintenance-logo" src={logoIco} alt="FarmGestion" width="62" height="62" />
        <p className="maintenance-brand">FarmGestion</p>

        <div className="maintenance-hex-loader" aria-hidden="true">
          <span className="maintenance-hex-loader__pulse" />
          <span className="maintenance-hex-loader__hex maintenance-hex-loader__hex--outer" />
          <span className="maintenance-hex-loader__hex maintenance-hex-loader__hex--mid" />
          <span className="maintenance-hex-loader__hex maintenance-hex-loader__hex--core" />
        </div>

        <p className="maintenance-kicker">{isWaitingVariant ? 'Acces prive temporaire' : 'Mode maintenance'}</p>
        <h1 id="maintenance-title">{config.title}</h1>
        <p className="maintenance-subtitle">{config.message}</p>

        <div className="maintenance-pulse" aria-hidden="true">
          <span className="maintenance-pulse__dot" />
          <span className="maintenance-pulse__text">{isWaitingVariant ? 'Signal de lancement en attente' : 'Intervention en cours'}</span>
        </div>

        <div className="maintenance-progress" aria-hidden="true">
          <span className="maintenance-progress__bar" />
        </div>

        <div className="maintenance-meta">
          <p>
            <strong>Etat:</strong> {isWaitingVariant ? 'ouverture reservee' : 'indisponible temporairement'}
          </p>
          {config.etaText ? (
            <p>
              <strong>Retour estime:</strong> {config.etaText}
            </p>
          ) : null}
          <p>
            <strong>Mise a jour:</strong> {dateLabel}
          </p>
        </div>

        {config.musicUrl ? (
          <div className="maintenance-audio-wrap">
            <button
              type="button"
              className="maintenance-audio-btn"
              onClick={() => setMusicEnabled((value) => !value)}
            >
              {musicEnabled ? 'Couper la musique' : 'Activer la musique'}
            </button>
            {musicEnabled ? <audio src={config.musicUrl} autoPlay loop controls className="maintenance-audio" /> : null}
          </div>
        ) : null}
      </section>
    </main>
  );
}

export default MaintenancePage;
