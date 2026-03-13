import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef } from 'react';
import { supabase } from '../authentification/supabaseClient';
import { useAuth } from '../authentification/AuthContext';
import { FarmDesignPreview } from '../utils/FarmDesign';
import { normalizeSiteColors } from '../utils/FarmDesign/farmDesignUtils';
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
const SITE_COLOR_PRESETS = ['#FFB3BA', '#BAFFC9', '#BAE1FF', '#FFFFBA', '#E0BBE4', '#FFDFBA', '#FF8FA3', '#42C6FF', '#84CC16', '#F59E0B', '#A78BFA'];
const DEFAULT_CUSTOM_COLOR = '#ffffff';
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

const colorEquals = (left, right) => String(left || '').trim().toLowerCase() === String(right || '').trim().toLowerCase();

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

const fetchFarmBetailStats = async (farmId) => {
  const [totalResponse, premiumResponse] = await Promise.all([
    supabase
      .from('betails')
      .select('id', { count: 'exact', head: true })
      .eq('farm_id', farmId),
    supabase
      .from('betails')
      .select('id', { count: 'exact', head: true })
      .eq('farm_id', farmId)
      .eq('premium', true),
  ]);

  if (totalResponse.error) throw totalResponse.error;
  if (premiumResponse.error) throw premiumResponse.error;

  const total = Number(totalResponse.count || 0);
  const premium = Number(premiumResponse.count || 0);
  const standard = Math.max(0, total - premium);

  return { total, premium, standard };
};

function FarmPage() {
  const { id: farmIdParam } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const farmId = Number(farmIdParam);
  const validFarmId = Number.isFinite(farmId);

  const [rotateHex, setRotateHex] = useState(() => {
    if (typeof window === 'undefined') return true;
    return window.localStorage.getItem(ROTATION_STORAGE_KEY) !== 'off';
  });
  const [selectedSiteState, setSelectedSiteState] = useState({ farmId: null, siteIndex: null });
  const [hoveredSiteState, setHoveredSiteState] = useState({ farmId: null, siteIndex: null });
  const [centerWidgetState, setCenterWidgetState] = useState({ farmId: null, isOpen: false });
  const [customColorDraft, setCustomColorDraft] = useState(DEFAULT_CUSTOM_COLOR);
  const [isCustomColorPickerOpen, setIsCustomColorPickerOpen] = useState(false);
  const siteColorWriteQueueRef = useRef(Promise.resolve());

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
  const siteColors = useMemo(() => normalizeSiteColors(farm?.site_colors), [farm?.site_colors]);
  const selectedSiteIndex = selectedSiteState.farmId === farm?.id ? selectedSiteState.siteIndex : null;
  const hoveredSiteIndex = hoveredSiteState.farmId === farm?.id ? hoveredSiteState.siteIndex : null;
  const isCenterWidgetOpen = centerWidgetState.farmId === farm?.id && centerWidgetState.isOpen;
  const visibleBadges = equippedBadges.slice(0, 8);
  const hiddenBadgesCount = Math.max(0, equippedBadges.length - visibleBadges.length);
  const selectedSiteNumber = selectedSiteIndex == null ? null : selectedSiteIndex + 1;
  const selectedSiteColor = selectedSiteIndex == null ? '' : siteColors[selectedSiteIndex] || '';
  const selectedColorIsPreset = SITE_COLOR_PRESETS.some((color) => colorEquals(color, selectedSiteColor));

  const betailStatsQuery = useQuery({
    queryKey: ['farm', 'betail-stats', farm?.id],
    queryFn: () => fetchFarmBetailStats(farm.id),
    enabled: Boolean(farm?.id && isCenterWidgetOpen),
    staleTime: 120000,
    gcTime: 900000,
    refetchOnWindowFocus: false,
    retry: 1,
  });

  const totalBetails = betailStatsQuery.data?.total || 0;
  const premiumBetails = betailStatsQuery.data?.premium || 0;
  const standardBetails = betailStatsQuery.data?.standard || 0;
  const premiumRatio = totalBetails > 0 ? premiumBetails / totalBetails : 0;

  const updateSiteColorsMutation = useMutation({
    mutationFn: async ({ farmId: nextFarmId, ownerId, nextColors }) => {
      const { error } = await supabase
        .from('farms_list')
        .update({ site_colors: nextColors })
        .eq('id', nextFarmId)
        .eq('proprietaire', ownerId);
      if (error) throw error;
      return nextColors;
    },
    onMutate: async ({ farmId: nextFarmId, nextColors }) => {
      await queryClient.cancelQueries({ queryKey: ['farm', 'by-id', nextFarmId] });
      const previousFarm = queryClient.getQueryData(['farm', 'by-id', nextFarmId]);
      queryClient.setQueryData(['farm', 'by-id', nextFarmId], (currentFarm) =>
        currentFarm ? { ...currentFarm, site_colors: nextColors } : currentFarm,
      );
      return { previousFarm, farmId: nextFarmId };
    },
    onError: (_error, _variables, context) => {
      if (context?.previousFarm && context.farmId != null) {
        queryClient.setQueryData(['farm', 'by-id', context.farmId], context.previousFarm);
      }
      window.dispatchEvent(
        new CustomEvent('farmgestion-toast', {
          detail: { type: 'error', message: 'Impossible de sauvegarder la couleur de ce site.' },
        }),
      );
    },
  });

  const queueSiteColorPersist = (nextColors) => {
    if (!isOwner || !farm?.id || !user?.id) return;
    const payload = [...nextColors];
    siteColorWriteQueueRef.current = siteColorWriteQueueRef.current
      .catch(() => undefined)
      .then(() =>
        updateSiteColorsMutation.mutateAsync({
          farmId: farm.id,
          ownerId: user.id,
          nextColors: payload,
        }),
      );
  };

  const handleHexStagePointerDown = (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (target.closest('.farm-design-preview__site') || target.closest('.farm-design-preview__media')) return;
    setSelectedSiteState({ farmId: farm?.id ?? null, siteIndex: null });
    setHoveredSiteState({ farmId: farm?.id ?? null, siteIndex: null });
    setCenterWidgetState({ farmId: farm?.id ?? null, isOpen: false });
    setIsCustomColorPickerOpen(false);
  };

  const handleSiteClick = (siteIndex) => {
    if (farm?.id == null) return;
    if (!Number.isInteger(siteIndex) || siteIndex < 0 || siteIndex > 5) return;
    setSelectedSiteState({ farmId: farm.id, siteIndex });
    setCenterWidgetState({ farmId: farm.id, isOpen: false });
    setCustomColorDraft(siteColors[siteIndex] || DEFAULT_CUSTOM_COLOR);
    setIsCustomColorPickerOpen(false);
  };

  const handleApplySiteColor = (nextColorRaw) => {
    if (!isOwner || selectedSiteIndex == null) return;
    const nextColor = String(nextColorRaw || '').trim();
    if (!nextColor) return;
    const previousColor = siteColors[selectedSiteIndex];
    if (colorEquals(previousColor, nextColor)) return;
    const nextColors = siteColors.map((color, index) => (index === selectedSiteIndex ? nextColor : color));
    if (farm?.id != null) {
      queryClient.setQueryData(['farm', 'by-id', farm.id], (currentFarm) =>
        currentFarm ? { ...currentFarm, site_colors: nextColors } : currentFarm,
      );
    }
    queueSiteColorPersist(nextColors);
  };

  const openCustomColorPicker = () => {
    if (selectedSiteIndex == null) return;
    setCustomColorDraft(siteColors[selectedSiteIndex] || DEFAULT_CUSTOM_COLOR);
    setIsCustomColorPickerOpen(true);
  };

  const handleCustomColorConfirm = () => {
    handleApplySiteColor(customColorDraft);
    setIsCustomColorPickerOpen(false);
  };

  const handleCenterWidgetToggle = () => {
    if (!farm?.id) return;
    const willOpen = !isCenterWidgetOpen;
    if (willOpen) {
      setSelectedSiteState({ farmId: farm.id, siteIndex: null });
      setIsCustomColorPickerOpen(false);
    }
    setCenterWidgetState({ farmId: farm.id, isOpen: willOpen });
  };

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
              onClick={() => navigate('/mes-betails')}
            >
              Mes bétails
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
            Le cœur de votre domaine ! C'est ici que vous pourrez gérer votre ferme.
            {isOwner ? " Cliquez sur un site dans l'hexagone pour afficher ses options." : ''}
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
            siteColorsRaw={siteColors}
            centerStyleRaw={farm.center_style}
            rotate={rotateHex}
            className="farm-page-hex-stage"
            maxSize={640}
            minHeight={620}
            onPointerDown={handleHexStagePointerDown}
            onSiteClick={isOwner ? handleSiteClick : undefined}
            selectedSiteIndex={selectedSiteIndex}
            hoveredSiteIndex={hoveredSiteIndex}
            onSiteHoverChange={(siteIndex) =>
              setHoveredSiteState({
                farmId: farm?.id ?? null,
                siteIndex: Number.isInteger(siteIndex) ? siteIndex : null,
              })
            }
            onCenterClick={handleCenterWidgetToggle}
            centerAriaLabel="Afficher le widget de répartition des bétails"
            getSiteAriaLabel={(siteIndex) => `Site ${siteIndex + 1}`}
            siteHoverHint={isOwner ? 'Cliquer pour voir' : ''}
          />
        </div>

        <div className="farm-page-panel">
          <h2>Informations - {farm.name} #{farm.id}</h2>
          <p>Visibilité : {farm.visible ? 'Publique' : 'Privée'}</p>
          <p>Créée le : {farm.creation_date ? new Date(farm.creation_date).toLocaleDateString('fr-FR') : 'Date inconnue'}</p>
          <p>
            Vous êtes <strong>{isOwner ? 'propriétaire' : 'visiteur'}</strong> de cette ferme !
          </p>
          {selectedSiteNumber ? (
            <div className="farm-page-site-subpanel" role="region" aria-live="polite" aria-label={`Site ${selectedSiteNumber}`}>
              <div className="farm-page-site-subpanel-head">
                <span className="farm-page-site-badge">Couleur - Site N°{selectedSiteNumber}</span>
                <span className="farm-page-site-color-code">{selectedSiteColor}</span>
              </div>
              <p className="farm-page-site-subpanel-copy">
                {isOwner ? 'Choisissez une couleur pour ce site.' : 'Mode visiteur : couleurs consultables seulement.'}
              </p>
              <div
                className="farm-page-clay-slab"
                role="list"
                aria-label={`Couleurs disponibles pour le site ${selectedSiteNumber}`}
              >
                <div className="farm-page-clay-items">
                  {SITE_COLOR_PRESETS.map((color) => (
                    <button
                      key={color}
                      type="button"
                      className={`farm-page-clay-color ${colorEquals(selectedSiteColor, color) ? 'is-active' : ''}`}
                      style={{ '--color': color }}
                      data-color={color}
                      onClick={() => handleApplySiteColor(color)}
                      disabled={!isOwner}
                      aria-label={`Appliquer la couleur ${color}`}
                    />
                  ))}
                  <button
                    type="button"
                    className={`farm-page-clay-color is-custom ${!selectedColorIsPreset ? 'is-active' : ''} ${isCustomColorPickerOpen ? 'is-open' : ''}`}
                    style={{ '--color': customColorDraft || DEFAULT_CUSTOM_COLOR }}
                    data-color="Custom"
                    onClick={openCustomColorPicker}
                    disabled={!isOwner}
                    aria-label="Choisir une couleur personnalisée"
                  >
                    +
                  </button>
                </div>
              </div>
              {isCustomColorPickerOpen ? (
                <div className="farm-page-custom-color-popover">
                  <label className="farm-page-custom-color-label">
                    Couleur personnalisée
                    <input
                      type="color"
                      value={customColorDraft}
                      onChange={(event) => setCustomColorDraft(event.target.value || DEFAULT_CUSTOM_COLOR)}
                      disabled={!isOwner}
                    />
                  </label>
                  <button
                    type="button"
                    className="farm-page-custom-color-confirm"
                    onClick={handleCustomColorConfirm}
                    disabled={!isOwner}
                  >
                    OK
                  </button>
                </div>
              ) : null}
            </div>
          ) : (
            <p className="farm-page-site-empty">
              Cliquez sur un site dans l'hexagone ou sur le centre pour découvrir les options.
            </p>
          )}
          {isCenterWidgetOpen ? (
            <div className="farm-page-center-widget" aria-live="polite">
              <div className="farm-page-center-widget-head">
                <h3 className="farm-page-center-widget-title">Répartition</h3>
                <span className="farm-page-center-widget-total">{totalBetails}</span>
              </div>
              {betailStatsQuery.isError ? (
                <p className="farm-page-center-widget-state">Impossible de charger la répartition.</p>
              ) : (
                <>
                  <div
                    className={`farm-page-center-widget-pie ${betailStatsQuery.isLoading ? 'is-loading' : ''}`}
                    style={{ '--premium-ratio': String(premiumRatio) }}
                    role="img"
                    aria-label={`Bétails premium ${premiumBetails}, bétails standard ${standardBetails}`}
                  />
                  <div className="farm-page-center-widget-legend">
                    <span className="farm-page-center-legend-item premium">Bétail premium</span>
                    <span className="farm-page-center-legend-item standard">Standard</span>
                  </div>
                  {betailStatsQuery.isLoading ? (
                    <p className="farm-page-center-widget-state">Chargement...</p>
                  ) : null}
                </>
              )}
            </div>
          ) : null}
        </div>
      </section>
    </div>
  );
}

export default FarmPage;
