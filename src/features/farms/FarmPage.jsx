import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../authentification/supabaseClient';
import { useAuth } from '../authentification/AuthContext';
import { FarmDesignPreview } from '../utils/FarmDesign';
import badgesManifest from '../../assets/manifest.json';
import './FarmPage.css';

const ROTATION_STORAGE_KEY = 'farmgestion_farm_hex_rotate';
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const FARM_BACKGROUND_DARK_URL = SUPABASE_URL
  ? `${SUPABASE_URL}/storage/v1/object/public/ressources/fond_farm2.png`
  : '';
const FARM_BACKGROUND_LIGHT_URL = SUPABASE_URL
  ? `${SUPABASE_URL}/storage/v1/object/public/ressources/fond_farm3.png`
  : '';
const BADGES_BUCKET_URL = SUPABASE_URL ? `${SUPABASE_URL}/storage/v1/object/public/badges` : '';
const BADGE_RARITY_ORDER = {
  '4_legendary': 5,
  '3_epic': 4,
  '2_rare': 3,
  '1_common': 2,
  '0_auto': 1,
};
const BADGE_RARITY_LABELS = {
  '4_legendary': 'Légendaire',
  '3_epic': 'Épique',
  '2_rare': 'Rare',
  '1_common': 'Commun',
  '0_auto': 'Auto',
};
const BADGE_FOLDER_BY_FILE = Object.entries(badgesManifest || {}).reduce((acc, [folder, files]) => {
  if (!Array.isArray(files)) return acc;
  files.forEach((file) => {
    if (typeof file === 'string' && file.length) {
      acc[file] = folder;
    }
  });
  return acc;
}, {});

const normalizeEquippedBadges = (value) => {
  if (Array.isArray(value)) {
    return value.filter((item) => typeof item === 'string' && item.trim().length > 0);
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return [];
    try {
      const parsed = JSON.parse(trimmed);
      return Array.isArray(parsed)
        ? parsed.filter((item) => typeof item === 'string' && item.trim().length > 0)
        : [];
    } catch {
      return [];
    }
  }

  return [];
};

const fetchFarmById = async (farmId) => {
  const { data, error } = await supabase
    .from('farms_list')
    .select('id, name, proprietaire, state, visible, site_colors, center_style, creation_date, equipped_badges')
    .eq('id', farmId)
    .maybeSingle();
  if (error) throw error;
  return data ?? null;
};

const fetchUserFarmId = async (userId) => {
  const { data, error } = await supabase
    .from('users_profiles')
    .select('farm_id')
    .eq('id', userId)
    .maybeSingle();
  if (error) throw error;
  return data?.farm_id ?? null;
};

const fetchUsername = async (userId) => {
  const { data, error } = await supabase
    .from('users_profiles')
    .select('username')
    .eq('id', userId)
    .maybeSingle();
  if (error) throw error;
  return data?.username ?? '';
};

function FarmPage() {
  const { id: farmIdParam } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const farmId = Number(farmIdParam);
  const validFarmId = Number.isFinite(farmId);

  const [rotateHex, setRotateHex] = useState(() => {
    if (typeof window === 'undefined') return true;
    return window.localStorage.getItem(ROTATION_STORAGE_KEY) !== 'off';
  });

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(ROTATION_STORAGE_KEY, rotateHex ? 'on' : 'off');
  }, [rotateHex]);

  const farmQuery = useQuery({
    queryKey: ['farm', 'by-id', farmId],
    queryFn: () => fetchFarmById(farmId),
    enabled: validFarmId,
    staleTime: 120000,
    gcTime: 900000,
    refetchOnWindowFocus: false,
    retry: 1,
  });

  const myFarmIdQuery = useQuery({
    queryKey: ['farm', 'my-id', user?.id],
    queryFn: () => fetchUserFarmId(user.id),
    enabled: Boolean(user?.id),
    staleTime: 120000,
    gcTime: 900000,
    refetchOnWindowFocus: false,
    retry: 1,
  });

  const ownerNameQuery = useQuery({
    queryKey: ['farm', 'owner-name', farmQuery.data?.proprietaire],
    queryFn: () => fetchUsername(farmQuery.data.proprietaire),
    enabled: Boolean(farmQuery.data?.proprietaire),
    staleTime: 300000,
    gcTime: 1200000,
    refetchOnWindowFocus: false,
    retry: 1,
  });

  const farm = farmQuery.data ?? null;
  const isOwner = Boolean(user?.id) && Boolean(farm?.proprietaire) && farm.proprietaire === user.id;
  const accessDenied = Boolean(farm) && !isOwner && farm.visible === false;

  const farmLabel = farm?.name || (farm?.id ? `Ferme #${farm.id}` : 'Ferme');
  const ownerName = ownerNameQuery.data || '';
  const myFarmId = myFarmIdQuery.data ?? null;
  const equippedBadges = useMemo(() => {
    const filenames = normalizeEquippedBadges(farm?.equipped_badges);
    if (!filenames.length) return [];

    return filenames
      .map((filename) => {
        const folder = BADGE_FOLDER_BY_FILE[filename] || null;
        return {
          id: filename,
          filename,
          folder,
          rarityOrder: BADGE_RARITY_ORDER[folder] || 0,
          rarityLabel: folder ? (BADGE_RARITY_LABELS[folder] || folder) : 'Inconnue',
          imageUrl: folder && BADGES_BUCKET_URL ? `${BADGES_BUCKET_URL}/${folder}/${filename}` : '',
        };
      })
      .sort((a, b) => {
        if (b.rarityOrder !== a.rarityOrder) return b.rarityOrder - a.rarityOrder;
        return a.filename.localeCompare(b.filename, 'fr');
      });
  }, [farm?.equipped_badges]);
  const visibleBadges = equippedBadges.slice(0, 8);
  const hiddenBadgesCount = Math.max(0, equippedBadges.length - visibleBadges.length);

  if (!validFarmId) {
    return (
      <div className="farm-page farm-page--error">
        <h1>Page de ferme</h1>
        <p>Identifiant de ferme invalide.</p>
        <button type="button" className="farm-page-btn" onClick={() => navigate('/home')}>
          Retour au tableau de bord
        </button>
      </div>
    );
  }

  if (farmQuery.isLoading) {
    return (
      <div className="farm-page farm-page--loading">
        <p>Chargement de la ferme...</p>
      </div>
    );
  }

  if (farmQuery.isError || !farm || accessDenied) {
    return (
      <div className="farm-page farm-page--error">
        <h1>Page de ferme</h1>
        <p>{accessDenied ? 'Cette ferme est privée.' : 'Ferme introuvable.'}</p>
        <button type="button" className="farm-page-btn" onClick={() => navigate('/home')}>
          Retour au tableau de bord
        </button>
      </div>
    );
  }

  return (
    <div className="farm-page">
      <header className="farm-page-header">
        <div>
          <p className="farm-page-eyebrow">{isOwner ? 'Votre ferme' : 'Mode visiteur'}</p>
          <h1 className="farm-page-title">{farmLabel}</h1>
          <p className="farm-page-subtitle">
            {ownerName ? `Propriétaire : ${ownerName}` : 'Propriétaire inconnu'} - État : {farm.state || '-'}
          </p>
        </div>
        <div className="farm-page-actions">
          {myFarmId && Number(myFarmId) !== Number(farm.id) ? (
            <button type="button" className="farm-page-btn ghost" onClick={() => navigate(`/farm/${myFarmId}`)}>
              Aller à ma ferme
            </button>
          ) : null}
          <button type="button" className="farm-page-btn ghost" onClick={() => navigate('/home')}>
            Tableau de bord
          </button>
          {isOwner ? (
            <button
              type="button"
              className="farm-page-btn"
              onClick={() =>
                window.dispatchEvent(
                  new CustomEvent('farmgestion-toast', {
                    detail: { type: 'error', message: 'La configuration de la ferme arrive bientôt.' },
                  }),
                )
              }
            >
              Configurer la ferme
            </button>
          ) : null}
        </div>
      </header>

      <section className="farm-page-main">
        <div
          className="farm-page-hex-wrap"
          style={
            FARM_BACKGROUND_DARK_URL || FARM_BACKGROUND_LIGHT_URL
              ? {
                  '--farm-hex-bg-dark': FARM_BACKGROUND_DARK_URL ? `url(${FARM_BACKGROUND_DARK_URL})` : 'none',
                  '--farm-hex-bg-light': FARM_BACKGROUND_LIGHT_URL ? `url(${FARM_BACKGROUND_LIGHT_URL})` : 'none',
                }
              : undefined
          }
        >
          <div className="farm-page-hex-toolbar">
            <span className="farm-page-hex-label">Hexagone principal</span>
            <button
              type="button"
              className="farm-page-rotate-btn"
              onClick={() => setRotateHex((prev) => !prev)}
              aria-pressed={rotateHex}
              title={rotateHex ? 'Désactiver la rotation' : 'Activer la rotation'}
            >
              {rotateHex ? 'Rotation active' : 'Rotation inactive'}
            </button>
          </div>
          <p className="farm-page-hex-intro">
            Le cœur de votre domaine ! C'est ici que vous pourrez gérer votre ferme, Cliquez sur les hexagones pour accéder à différentes sections de votre ferme.
          </p>

          {equippedBadges.length ? (
            <div className="farm-page-badges-overlay" role="list" aria-label="Badges équipés de la ferme">
              {visibleBadges.map((badge) => (
                <div
                  key={badge.id}
                  className={`farm-page-badge-chip ${badge.folder ? `is-${badge.folder}` : 'is-unknown'}`}
                  role="listitem"
                  title={`${badge.filename.replace('.gif', '')} • ${badge.rarityLabel}`}
                >
                  {badge.imageUrl ? (
                    <img
                      src={badge.imageUrl}
                      alt={badge.filename}
                      className="farm-page-badge-image"
                      loading="lazy"
                      decoding="async"
                      onError={(event) => {
                        event.currentTarget.style.display = 'none';
                      }}
                    />
                  ) : (
                    <span className="farm-page-badge-fallback" aria-hidden="true">
                      ?
                    </span>
                  )}
                </div>
              ))}
              {hiddenBadgesCount > 0 ? (
                <span className="farm-page-badge-more" title={`${hiddenBadgesCount} badge(s) supplémentaire(s)`}>
                  +{hiddenBadgesCount}
                </span>
              ) : null}
            </div>
          ) : null}

          <FarmDesignPreview
            farmLabel={farmLabel}
            siteColorsRaw={farm.site_colors}
            centerStyleRaw={farm.center_style}
            rotate={rotateHex}
            className="farm-page-hex-stage"
            maxSize={640}
            minHeight={620}
          />
        </div>

        <div className="farm-page-panel">
          <h2>Informations</h2>
          <p>ID de ferme : {farm.id}</p>
          <p>Visibilité : {farm.visible ? 'Publique' : 'Privée'}</p>
          <p>Créée le : {farm.creation_date ? new Date(farm.creation_date).toLocaleDateString('fr-FR') : 'Date inconnue'}</p>
          <p>
            Mode actuel : <strong>{isOwner ? 'Propriétaire (actions actives)' : 'Visiteur (lecture seule)'}</strong>
          </p>
        </div>
      </section>
    </div>
  );
}

export default FarmPage;
