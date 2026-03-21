import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef } from 'react';
import { supabase } from '../authentification/supabaseClient';
import { useAuth } from '../authentification/AuthContext';
import { FarmDesignPreview } from '../utils/FarmDesign';
import { normalizeCenterStyle, normalizeSiteColors } from '../utils/FarmDesign/farmDesignUtils';
import badgesManifest from '../../assets/manifest.json';
import defaultProfileUser from '../../assets/defaut_profile_user.png';
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
const FARM_CENTER_BUCKET = 'farms';
const FARM_CENTER_MAX_SOURCE_BYTES = 12 * 1024 * 1024;
const FARM_CENTER_OUTPUT_SIZE = 1024;
const FARM_CENTER_UPLOAD_FORMATS = [
  { ext: 'webp', mimeType: 'image/webp', quality: 0.84 },
  { ext: 'png', mimeType: 'image/png' },
  { ext: 'jpg', mimeType: 'image/jpeg', quality: 0.88 },
];
const DEFAULT_CENTER_BACKGROUND_COLOR = '#ffffff';
const DEFAULT_CENTER_SYMBOL = 'H';
const DEFAULT_CENTER_IMAGE_ZOOM = 1.15;
const DEFAULT_CENTER_IMAGE_POSITION = { x: 0, y: 0 };
const CENTER_MODE_UPLOAD = 'upload';
const CENTER_MODE_URL = 'url';
const CENTER_MODE_CUSTOMIZE = 'customize';
const BADGE_FOLDER_BY_FILE = Object.entries(badgesManifest || {}).reduce((acc, [folder, files]) => {
  if (!Array.isArray(files)) return acc;
  files.forEach((file) => {
    if (typeof file === 'string' && file.length) {
      acc[file] = folder;
    }
  });
  return acc;
}, {});

const buildAvatarCandidates = (value) => {
  const raw = String(value || '').trim();
  if (!raw) return [];
  if (raw.startsWith('http://') || raw.startsWith('https://')) return [raw];
  if (!SUPABASE_URL) return [raw];

  const candidates = [raw];
  if (raw.startsWith('/storage/v1/object/public/')) {
    candidates.push(`${SUPABASE_URL}${raw}`);
  } else if (raw.startsWith('storage/v1/object/public/')) {
    candidates.push(`${SUPABASE_URL}/${raw}`);
  } else if (raw.startsWith('/')) {
    candidates.push(`${SUPABASE_URL}${raw}`);
    const normalized = raw.replace(/^\/+/, '');
    candidates.push(`${SUPABASE_URL}/${normalized}`);
  } else if (raw.includes('/')) {
    candidates.push(`${SUPABASE_URL}/storage/v1/object/public/${raw}`);
  } else {
    candidates.push(`${SUPABASE_URL}/storage/v1/object/public/avatars/${raw}`);
    candidates.push(`${SUPABASE_URL}/storage/v1/object/public/ressources/${raw}`);
  }

  return Array.from(new Set(candidates));
};

const buildCommunityProfilePath = (username, userId) => {
  const normalizedUsername = String(username || '').trim();
  if (normalizedUsername) return `/community/profile/${encodeURIComponent(normalizedUsername)}`;
  return '';
};

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

const parseFiniteNumber = (value, fallback = 0) => {
  const nextValue = Number(value);
  return Number.isFinite(nextValue) ? nextValue : fallback;
};

const clampNumber = (value, min, max) => Math.min(max, Math.max(min, value));

const clampCenterZoom = (value) => clampNumber(parseFiniteNumber(value, 1), 1, 2.5);

const normalizeSingleCharacter = (value, fallback = '') => {
  const symbols = Array.from(String(value || '').trim());
  return symbols[0] || fallback;
};

const parseMaybeJsonObject = (value) => {
  if (!value) return null;
  if (typeof value === 'object') return value;
  if (typeof value !== 'string') return null;

  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
};

const readStoredCenterImageDraft = (rawCenterStyle) => {
  const parsed = parseMaybeJsonObject(rawCenterStyle);
  if (!parsed) {
    return {
      imageUrl: '',
      zoom: DEFAULT_CENTER_IMAGE_ZOOM,
      position: { ...DEFAULT_CENTER_IMAGE_POSITION },
    };
  }

  const nestedPosition = parseMaybeJsonObject(
    parsed.savedImagePosition
    || parsed.saved_image_position
    || parsed.lastImagePosition,
  );

  const valueAsObject = parseMaybeJsonObject(parsed.value);

  const imageUrl = String(
    parsed.savedImageUrl
    || parsed.saved_image_url
    || parsed.lastImageUrl
    || parsed.previousImageUrl
    || parsed.imageUrl
    || parsed.image
    || parsed.url
    || (parsed.type === 'image' && typeof parsed.value === 'string' ? parsed.value : '')
    || (typeof valueAsObject?.url === 'string' ? valueAsObject.url : '')
    || '',
  ).trim();

  return {
    imageUrl,
    zoom: clampCenterZoom(
      parsed.savedImageZoom
      || parsed.saved_image_zoom
      || parsed.lastImageZoom
      || DEFAULT_CENTER_IMAGE_ZOOM,
    ),
    position: {
      x: parseFiniteNumber(nestedPosition?.x, DEFAULT_CENTER_IMAGE_POSITION.x),
      y: parseFiniteNumber(nestedPosition?.y, DEFAULT_CENTER_IMAGE_POSITION.y),
    },
  };
};

const numbersEqual = (left, right, epsilon = 0.0001) =>
  Math.abs(parseFiniteNumber(left, 0) - parseFiniteNumber(right, 0)) <= epsilon;

const stylesEqual = (left, right) => {
  if (!left || !right) return false;
  if (left.type !== right.type) return false;

  if (left.type === 'image') {
    return (
      String(left.imageUrl || '').trim() === String(right.imageUrl || '').trim()
      && numbersEqual(left.zoom, right.zoom, 0.001)
      && numbersEqual(left.position?.x, right.position?.x, 0.1)
      && numbersEqual(left.position?.y, right.position?.y, 0.1)
    );
  }

  return (
    normalizeSingleCharacter(left.emoji, DEFAULT_CENTER_SYMBOL) === normalizeSingleCharacter(right.emoji, DEFAULT_CENTER_SYMBOL)
    && colorEquals(left.backgroundColor || DEFAULT_CENTER_BACKGROUND_COLOR, right.backgroundColor || DEFAULT_CENTER_BACKGROUND_COLOR)
  );
};

const extractBucketObjectPath = (publicUrl, bucket) => {
  if (!publicUrl || !bucket) return '';

  try {
    const parsedUrl = new URL(publicUrl);
    const marker = `/storage/v1/object/public/${bucket}/`;
    const markerIndex = parsedUrl.pathname.indexOf(marker);
    if (markerIndex === -1) return '';
    const rawPath = parsedUrl.pathname.slice(markerIndex + marker.length);
    return decodeURIComponent(rawPath).replace(/^\/+/, '');
  } catch {
    return '';
  }
};

const loadImageElement = (sourceUrl) =>
  new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = 'async';
    image.crossOrigin = 'anonymous';
    image.referrerPolicy = 'no-referrer';
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Impossible de charger cette image.'));
    image.src = sourceUrl;
  });

const canvasToBlob = (canvas, type, quality) =>
  new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob);
        return;
      }
      reject(new Error('Impossible de préparer l\'image.'));
    }, type, quality);
  });

const renderCenterImageCanvas = async ({ sourceUrl, zoom, position, previewSize, outputSize = FARM_CENTER_OUTPUT_SIZE }) => {
  const image = await loadImageElement(sourceUrl);

  const safePreviewSize = Math.max(1, parseFiniteNumber(previewSize, 112));
  const safeOutputSize = Math.max(256, parseFiniteNumber(outputSize, FARM_CENTER_OUTPUT_SIZE));
  const effectiveZoom = clampCenterZoom(zoom);
  const offsetX = parseFiniteNumber(position?.x, 0);
  const offsetY = parseFiniteNumber(position?.y, 0);
  const baseScale = Math.max(safePreviewSize / image.naturalWidth, safePreviewSize / image.naturalHeight);
  const upscaleFactor = safeOutputSize / safePreviewSize;

  const drawWidth = image.naturalWidth * baseScale * effectiveZoom * upscaleFactor;
  const drawHeight = image.naturalHeight * baseScale * effectiveZoom * upscaleFactor;
  const centerX = safeOutputSize / 2;
  const centerY = safeOutputSize / 2;

  const canvas = document.createElement('canvas');
  canvas.width = safeOutputSize;
  canvas.height = safeOutputSize;

  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('Impossible de préparer le canvas.');
  }

  context.drawImage(
    image,
    centerX + (offsetX * upscaleFactor) - (drawWidth / 2),
    centerY + (offsetY * upscaleFactor) - (drawHeight / 2),
    drawWidth,
    drawHeight,
  );

  return canvas;
};

const uploadCenterImageWithFallback = async ({ farmId, userId, canvas }) => {
  const errors = [];

  for (const format of FARM_CENTER_UPLOAD_FORMATS) {
    const blob = await canvasToBlob(canvas, format.mimeType, format.quality);
    const baseFilename = `farm-center-${farmId}.${format.ext}`;
    const candidatePaths = [
      `${userId}/${baseFilename}`,
      baseFilename,
    ];

    for (const path of candidatePaths) {
      const { error } = await supabase.storage
        .from(FARM_CENTER_BUCKET)
        .upload(path, blob, {
          contentType: format.mimeType,
          cacheControl: '3600',
          upsert: true,
        });

      if (!error) {
        return { path, error: null };
      }

      const details = error?.message || error?.error_description || error?.statusCode || 'Erreur inconnue';
      errors.push(`${format.ext}@${path}: ${details}`);
    }
  }

  return {
    path: '',
    error: new Error(errors.join(' | ') || 'Impossible de téléverser l\'image dans le bucket farms.'),
  };
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

const fetchOwnerProfile = async (userId) => {
  const { data, error } = await supabase
    .from('users_profiles')
    .select('username, avatar_url')
    .eq('id', userId)
    .maybeSingle();
  if (error) throw error;
  return {
    username: data?.username ?? '',
    avatarUrl: data?.avatar_url ?? '',
  };
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
  const [centerInfoTab, setCenterInfoTab] = useState('stats');
  const [customColorDraft, setCustomColorDraft] = useState(DEFAULT_CUSTOM_COLOR);
  const [isCustomColorPickerOpen, setIsCustomColorPickerOpen] = useState(false);
  const [centerEditorMode, setCenterEditorMode] = useState(CENTER_MODE_UPLOAD);
  const [centerImageInputUrl, setCenterImageInputUrl] = useState('');
  const [centerImagePreviewUrl, setCenterImagePreviewUrl] = useState('');
  const [centerImageZoom, setCenterImageZoom] = useState(DEFAULT_CENTER_IMAGE_ZOOM);
  const [centerImagePosition, setCenterImagePosition] = useState({ ...DEFAULT_CENTER_IMAGE_POSITION });
  const [centerImageNaturalSize, setCenterImageNaturalSize] = useState({ width: 0, height: 0 });
  const [isCenterImageDragging, setIsCenterImageDragging] = useState(false);
  const [centerImageDragStart, setCenterImageDragStart] = useState({ x: 0, y: 0 });
  const [centerImageDragOrigin, setCenterImageDragOrigin] = useState({ x: 0, y: 0 });
  const [ownerAvatarIndex, setOwnerAvatarIndex] = useState(0);
  const [centerPreviewSize, setCenterPreviewSize] = useState(0);
  const [centerCustomBackground, setCenterCustomBackground] = useState(DEFAULT_CENTER_BACKGROUND_COLOR);
  const [centerCustomSymbol, setCenterCustomSymbol] = useState(DEFAULT_CENTER_SYMBOL);
  const [centerImageError, setCenterImageError] = useState('');
  const [centerImageStatus, setCenterImageStatus] = useState('');
  const [isCenterUrlLoading, setIsCenterUrlLoading] = useState(false);
  const [isCenterStyleSaving, setIsCenterStyleSaving] = useState(false);
  const siteColorWriteQueueRef = useRef(Promise.resolve());
  const centerFileInputRef = useRef(null);
  const centerPreviewRef = useRef(null);
  const centerImageObjectUrlRef = useRef('');

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

  const ownerProfileQuery = useQuery({
    queryKey: ['farm', 'owner-profile', farmQuery.data?.proprietaire],
    queryFn: () => fetchOwnerProfile(farmQuery.data.proprietaire),
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
  const ownerName = ownerProfileQuery.data?.username || '';
  const ownerAvatarCandidates = useMemo(
    () => buildAvatarCandidates(ownerProfileQuery.data?.avatarUrl),
    [ownerProfileQuery.data?.avatarUrl],
  );
  const ownerAvatarSrc = ownerAvatarCandidates[ownerAvatarIndex] || '';
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
  const normalizedCenterStyle = useMemo(() => normalizeCenterStyle(farm?.center_style), [farm?.center_style]);
  const storedCenterImageDraft = useMemo(() => readStoredCenterImageDraft(farm?.center_style), [farm?.center_style]);
  const selectedSiteIndex = selectedSiteState.farmId === farm?.id ? selectedSiteState.siteIndex : null;
  const hoveredSiteIndex = hoveredSiteState.farmId === farm?.id ? hoveredSiteState.siteIndex : null;
  const isCenterWidgetOpen = centerWidgetState.farmId === farm?.id && centerWidgetState.isOpen;
  const visibleBadges = equippedBadges.slice(0, 8);
  const hiddenBadgesCount = Math.max(0, equippedBadges.length - visibleBadges.length);
  const selectedSiteNumber = selectedSiteIndex == null ? null : selectedSiteIndex + 1;
  const selectedSiteColor = selectedSiteIndex == null ? '' : siteColors[selectedSiteIndex] || '';
  const selectedColorIsPreset = SITE_COLOR_PRESETS.some((color) => colorEquals(color, selectedSiteColor));
  const effectiveCenterPreviewSize = Math.max(centerPreviewSize || 0, 112);
  const centerSymbol = normalizeSingleCharacter(centerCustomSymbol, DEFAULT_CENTER_SYMBOL);
  const centerBackgroundColor = centerCustomBackground || DEFAULT_CENTER_BACKGROUND_COLOR;
  const centerDraftType = centerEditorMode === CENTER_MODE_CUSTOMIZE ? 'emoji' : 'image';
  const centerDraftStyle =
    centerDraftType === 'emoji'
      ? {
          type: 'emoji',
          emoji: centerSymbol,
          backgroundColor: centerBackgroundColor,
        }
      : centerImagePreviewUrl
        ? {
            type: 'image',
            imageUrl: centerImagePreviewUrl,
            zoom: clampCenterZoom(centerImageZoom),
            position: {
              x: parseFiniteNumber(centerImagePosition?.x, 0),
              y: parseFiniteNumber(centerImagePosition?.y, 0),
            },
          }
        : null;
  const currentComparableImageUrl = normalizedCenterStyle.imageUrl || '';
  const shouldUseStoredDraftForComparable = Boolean(
    currentComparableImageUrl
    && storedCenterImageDraft.imageUrl
    && String(storedCenterImageDraft.imageUrl).trim() === String(currentComparableImageUrl).trim(),
  );
  const currentComparableCenterStyle = {
    type: normalizedCenterStyle.type === 'image' && normalizedCenterStyle.imageUrl ? 'image' : 'emoji',
    imageUrl: currentComparableImageUrl,
    zoom: shouldUseStoredDraftForComparable
      ? clampCenterZoom(storedCenterImageDraft.zoom || 1)
      : clampCenterZoom(normalizedCenterStyle.zoom || 1),
    position: {
      x: shouldUseStoredDraftForComparable
        ? parseFiniteNumber(storedCenterImageDraft.position?.x, 0)
        : parseFiniteNumber(normalizedCenterStyle.position?.x, 0),
      y: shouldUseStoredDraftForComparable
        ? parseFiniteNumber(storedCenterImageDraft.position?.y, 0)
        : parseFiniteNumber(normalizedCenterStyle.position?.y, 0),
    },
    emoji: normalizeSingleCharacter(normalizedCenterStyle.emoji, DEFAULT_CENTER_SYMBOL),
    backgroundColor: normalizedCenterStyle.backgroundColor || DEFAULT_CENTER_BACKGROUND_COLOR,
  };
  const hasCenterPendingChange = Boolean(centerDraftStyle) && !stylesEqual(currentComparableCenterStyle, centerDraftStyle);

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

  const updateCenterStyleMutation = useMutation({
    mutationFn: async ({ farmId: nextFarmId, ownerId, nextCenterStyle }) => {
      const { error } = await supabase
        .from('farms_list')
        .update({ center_style: nextCenterStyle })
        .eq('id', nextFarmId)
        .eq('proprietaire', ownerId);
      if (error) throw error;
      return nextCenterStyle;
    },
    onMutate: async ({ farmId: nextFarmId, nextCenterStyle }) => {
      await queryClient.cancelQueries({ queryKey: ['farm', 'by-id', nextFarmId] });
      const previousFarm = queryClient.getQueryData(['farm', 'by-id', nextFarmId]);
      queryClient.setQueryData(['farm', 'by-id', nextFarmId], (currentFarm) =>
        currentFarm ? { ...currentFarm, center_style: nextCenterStyle } : currentFarm,
      );
      return { previousFarm, farmId: nextFarmId };
    },
    onError: (_error, _variables, context) => {
      if (context?.previousFarm && context.farmId != null) {
        queryClient.setQueryData(['farm', 'by-id', context.farmId], context.previousFarm);
      }
      window.dispatchEvent(
        new CustomEvent('farmgestion-toast', {
          detail: { type: 'error', message: 'Impossible de sauvegarder le centre de la ferme.' },
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

  const releaseCenterObjectUrl = () => {
    if (centerImageObjectUrlRef.current && typeof URL !== 'undefined') {
      URL.revokeObjectURL(centerImageObjectUrlRef.current);
      centerImageObjectUrlRef.current = '';
    }
  };

  const applyCenterPreviewUrl = (nextUrl, options = {}) => {
    const { isObjectUrl = false, resetTransform = true } = options;

    if (!isObjectUrl) {
      releaseCenterObjectUrl();
    } else if (centerImageObjectUrlRef.current && centerImageObjectUrlRef.current !== nextUrl && typeof URL !== 'undefined') {
      URL.revokeObjectURL(centerImageObjectUrlRef.current);
    }

    centerImageObjectUrlRef.current = isObjectUrl ? nextUrl : '';
    setCenterImagePreviewUrl(nextUrl);
    setCenterImageNaturalSize({ width: 0, height: 0 });

    if (resetTransform) {
      setCenterImageZoom(DEFAULT_CENTER_IMAGE_ZOOM);
      setCenterImagePosition({ ...DEFAULT_CENTER_IMAGE_POSITION });
    }
  };

  const getCenterBaseScale = () => {
    if (!centerImageNaturalSize.width || !centerImageNaturalSize.height) {
      return 1;
    }

    return Math.max(
      effectiveCenterPreviewSize / centerImageNaturalSize.width,
      effectiveCenterPreviewSize / centerImageNaturalSize.height,
    );
  };

  const clampCenterPosition = (position, zoom) => {
    if (!centerImageNaturalSize.width || !centerImageNaturalSize.height) {
      return { x: 0, y: 0 };
    }

    const baseScale = getCenterBaseScale();
    const scaledWidth = centerImageNaturalSize.width * baseScale * clampCenterZoom(zoom);
    const scaledHeight = centerImageNaturalSize.height * baseScale * clampCenterZoom(zoom);
    const maxOffsetX = Math.max(0, (scaledWidth - effectiveCenterPreviewSize) * 0.5);
    const maxOffsetY = Math.max(0, (scaledHeight - effectiveCenterPreviewSize) * 0.5);

    return {
      x: clampNumber(parseFiniteNumber(position?.x, 0), -maxOffsetX, maxOffsetX),
      y: clampNumber(parseFiniteNumber(position?.y, 0), -maxOffsetY, maxOffsetY),
    };
  };

  useEffect(
    () => () => {
      releaseCenterObjectUrl();
    },
    [],
  );

  useEffect(() => {
    if (!isCenterWidgetOpen || !farm?.id) return;

    const nextMode = normalizedCenterStyle.type === 'image' && normalizedCenterStyle.imageUrl
      ? CENTER_MODE_UPLOAD
      : CENTER_MODE_CUSTOMIZE;
    const nextImageUrl = normalizedCenterStyle.imageUrl || storedCenterImageDraft.imageUrl || '';
    const shouldUseStoredDraftForEditor = Boolean(
      nextImageUrl
      && storedCenterImageDraft.imageUrl
      && String(storedCenterImageDraft.imageUrl).trim() === String(nextImageUrl).trim(),
    );
    const nextZoom = shouldUseStoredDraftForEditor
      ? clampCenterZoom(storedCenterImageDraft.zoom || DEFAULT_CENTER_IMAGE_ZOOM)
      : clampCenterZoom(normalizedCenterStyle.zoom || DEFAULT_CENTER_IMAGE_ZOOM);
    const nextPosition = shouldUseStoredDraftForEditor
      ? {
          x: parseFiniteNumber(storedCenterImageDraft.position?.x, DEFAULT_CENTER_IMAGE_POSITION.x),
          y: parseFiniteNumber(storedCenterImageDraft.position?.y, DEFAULT_CENTER_IMAGE_POSITION.y),
        }
      : {
          x: parseFiniteNumber(normalizedCenterStyle.position?.x, DEFAULT_CENTER_IMAGE_POSITION.x),
          y: parseFiniteNumber(normalizedCenterStyle.position?.y, DEFAULT_CENTER_IMAGE_POSITION.y),
        };

    setCenterEditorMode(nextMode);
    setCenterImageInputUrl('');
    setCenterImageError('');
    setCenterImageStatus('');
    setIsCenterUrlLoading(false);
    setIsCenterStyleSaving(false);
    setCenterImageNaturalSize({ width: 0, height: 0 });
    setIsCenterImageDragging(false);

    if (nextImageUrl) {
      applyCenterPreviewUrl(nextImageUrl, { isObjectUrl: false, resetTransform: false });
      setCenterImageZoom(nextZoom);
      setCenterImagePosition(nextPosition);
    } else {
      applyCenterPreviewUrl('', { isObjectUrl: false, resetTransform: true });
    }

    setCenterCustomBackground(normalizedCenterStyle.backgroundColor || DEFAULT_CENTER_BACKGROUND_COLOR);
    setCenterCustomSymbol(normalizeSingleCharacter(normalizedCenterStyle.emoji, DEFAULT_CENTER_SYMBOL));
  }, [
    farm?.id,
    isCenterWidgetOpen,
    normalizedCenterStyle.backgroundColor,
    normalizedCenterStyle.emoji,
    normalizedCenterStyle.imageUrl,
    normalizedCenterStyle.position?.x,
    normalizedCenterStyle.position?.y,
    normalizedCenterStyle.type,
    normalizedCenterStyle.zoom,
    storedCenterImageDraft.imageUrl,
    storedCenterImageDraft.position?.x,
    storedCenterImageDraft.position?.y,
    storedCenterImageDraft.zoom,
  ]);

  useEffect(() => {
    if (!isCenterWidgetOpen) return;

    let frameA = 0;
    let frameB = 0;
    let previewResizeObserver;

    const updatePreviewSize = () => {
      const rect = centerPreviewRef.current?.getBoundingClientRect();
      if (rect?.width && rect?.height) {
        setCenterPreviewSize((currentSize) => {
          const nextSize = Math.min(rect.width, rect.height);
          return Math.abs(currentSize - nextSize) > 0.25 ? nextSize : currentSize;
        });
      }
    };

    updatePreviewSize();
    frameA = window.requestAnimationFrame(() => {
      updatePreviewSize();
      frameB = window.requestAnimationFrame(updatePreviewSize);
    });

    if (typeof ResizeObserver !== 'undefined' && centerPreviewRef.current) {
      previewResizeObserver = new ResizeObserver(() => {
        updatePreviewSize();
      });
      previewResizeObserver.observe(centerPreviewRef.current);
    }

    window.addEventListener('resize', updatePreviewSize);
    return () => {
      window.cancelAnimationFrame(frameA);
      window.cancelAnimationFrame(frameB);
      previewResizeObserver?.disconnect();
      window.removeEventListener('resize', updatePreviewSize);
    };
  }, [isCenterWidgetOpen, centerEditorMode, centerImagePreviewUrl]);

  useEffect(() => {
    if (!centerImageNaturalSize.width || !centerImageNaturalSize.height) return;
    setCenterImagePosition((currentPosition) => clampCenterPosition(currentPosition, centerImageZoom));
  }, [centerImageNaturalSize, centerImageZoom, effectiveCenterPreviewSize]);

  const handleCenterImageFileChange = (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    if (!file.type?.startsWith('image/')) {
      setCenterImageError('Le fichier sélectionné doit être une image.');
      return;
    }

    if (file.size > FARM_CENTER_MAX_SOURCE_BYTES) {
      setCenterImageError('Image trop lourde. Limite: 12 Mo avant compression.');
      return;
    }

    setCenterImageError('');
    setCenterImageStatus('Image chargée. Ajustez-la puis enregistrez.');
    const localUrl = URL.createObjectURL(file);
    applyCenterPreviewUrl(localUrl, { isObjectUrl: true, resetTransform: true });
  };

  const handleCenterLoadFromUrl = async () => {
    const nextUrl = centerImageInputUrl.trim();
    if (!nextUrl) {
      setCenterImageError('Ajoutez une URL image avant de charger.');
      return;
    }

    setCenterImageError('');
    setCenterImageStatus('');
    setIsCenterUrlLoading(true);

    try {
      const response = await fetch(nextUrl);
      if (!response.ok) {
        throw new Error('Impossible de télécharger cette image depuis l\'URL fournie.');
      }

      const contentType = String(response.headers.get('content-type') || '').toLowerCase();
      if (contentType && !contentType.startsWith('image/')) {
        throw new Error('L\'URL doit pointer vers une image valide.');
      }

      const blob = await response.blob();
      if (!String(blob.type || '').toLowerCase().startsWith('image/')) {
        throw new Error('Le contenu téléchargé n\'est pas une image.');
      }

      if (blob.size > FARM_CENTER_MAX_SOURCE_BYTES) {
        throw new Error('Image trop lourde. Limite: 12 Mo avant compression.');
      }

      const localUrl = URL.createObjectURL(blob);
      applyCenterPreviewUrl(localUrl, { isObjectUrl: true, resetTransform: true });
      setCenterImageStatus('Image URL chargée. Ajustez-la puis enregistrez.');
    } catch (error) {
      setCenterImageError(error?.message || 'Impossible de charger cette URL image.');
    } finally {
      setIsCenterUrlLoading(false);
    }
  };

  const handleCenterImagePointerDown = (event) => {
    if (!centerImagePreviewUrl) return;
    event.preventDefault();
    setIsCenterImageDragging(true);
    setCenterImageDragStart({ x: event.clientX, y: event.clientY });
    setCenterImageDragOrigin({ x: centerImagePosition.x, y: centerImagePosition.y });
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };

  const handleCenterImagePointerMove = (event) => {
    if (!isCenterImageDragging) return;
    const deltaX = event.clientX - centerImageDragStart.x;
    const deltaY = event.clientY - centerImageDragStart.y;
    const rawPosition = {
      x: centerImageDragOrigin.x + deltaX,
      y: centerImageDragOrigin.y + deltaY,
    };
    setCenterImagePosition(clampCenterPosition(rawPosition, centerImageZoom));
  };

  const handleCenterImagePointerUp = (event) => {
    if (!isCenterImageDragging) return;
    setIsCenterImageDragging(false);
    event.currentTarget.releasePointerCapture?.(event.pointerId);
  };

  const handleSaveCenterStyle = async () => {
    if (!isOwner || !farm?.id || !user?.id || !centerDraftStyle) return;

    setCenterImageError('');
    setCenterImageStatus('');
    setIsCenterStyleSaving(true);

    try {
      let nextCenterStyle;

      if (centerDraftStyle.type === 'emoji') {
        const backupImageUrl = [normalizedCenterStyle.imageUrl, storedCenterImageDraft.imageUrl]
          .map((value) => String(value || '').trim())
          .find((value) => value && !value.startsWith('blob:')) || '';
        const backupZoom = clampCenterZoom(
          storedCenterImageDraft.zoom
          || normalizedCenterStyle.zoom
          || DEFAULT_CENTER_IMAGE_ZOOM,
        );
        const backupPosition = {
          x: parseFiniteNumber(
            storedCenterImageDraft.position?.x,
            parseFiniteNumber(normalizedCenterStyle.position?.x, DEFAULT_CENTER_IMAGE_POSITION.x),
          ),
          y: parseFiniteNumber(
            storedCenterImageDraft.position?.y,
            parseFiniteNumber(normalizedCenterStyle.position?.y, DEFAULT_CENTER_IMAGE_POSITION.y),
          ),
        };

        nextCenterStyle = {
          type: 'emoji',
          value: centerSymbol,
          emoji: centerSymbol,
          backgroundColor: centerBackgroundColor,
          savedImageUrl: backupImageUrl,
          savedImageZoom: backupZoom,
          savedImagePosition: backupPosition,
        };
      } else {
        if (!centerImagePreviewUrl) {
          throw new Error('Ajoutez une image avant d\'enregistrer.');
        }

        const clampedPosition = clampCenterPosition(centerImagePosition, centerImageZoom);
        const centerCanvas = await renderCenterImageCanvas({
          sourceUrl: centerImagePreviewUrl,
          zoom: centerImageZoom,
          position: clampedPosition,
          previewSize: effectiveCenterPreviewSize,
        });

        const { path: centerFilePath, error: uploadError } = await uploadCenterImageWithFallback({
          farmId: farm.id,
          userId: user.id,
          canvas: centerCanvas,
        });

        if (uploadError || !centerFilePath) {
          const details = uploadError?.message || uploadError?.error_description || uploadError?.statusCode || 'Erreur inconnue';
          throw new Error(`Upload farms refusé: ${details}`);
        }

        const { data: publicData } = supabase.storage.from(FARM_CENTER_BUCKET).getPublicUrl(centerFilePath);
        const nextImageUrl = publicData?.publicUrl ? `${publicData.publicUrl}?v=${Date.now()}` : '';

        if (!nextImageUrl) {
          throw new Error('Impossible de récupérer l\'URL publique de cette image.');
        }

        const oldImagePath = extractBucketObjectPath(normalizedCenterStyle.imageUrl, FARM_CENTER_BUCKET);
        if (oldImagePath && oldImagePath !== centerFilePath) {
          await supabase.storage.from(FARM_CENTER_BUCKET).remove([oldImagePath]);
        }

        nextCenterStyle = {
          type: 'image',
          value: nextImageUrl,
          imageUrl: nextImageUrl,
          zoom: 1,
          position: {
            x: 0,
            y: 0,
          },
          savedImageUrl: nextImageUrl,
          savedImageZoom: clampCenterZoom(centerImageZoom),
          savedImagePosition: {
            x: parseFiniteNumber(clampedPosition.x, 0),
            y: parseFiniteNumber(clampedPosition.y, 0),
          },
        };

        applyCenterPreviewUrl(nextImageUrl, { isObjectUrl: false, resetTransform: false });
      }

      await updateCenterStyleMutation.mutateAsync({
        farmId: farm.id,
        ownerId: user.id,
        nextCenterStyle,
      });

      setCenterImageStatus('Centre enregistré avec succès.');
      window.dispatchEvent(
        new CustomEvent('farmgestion-toast', {
          detail: { type: 'success', message: 'Le centre de la ferme est à jour.' },
        }),
      );
    } catch (error) {
      setCenterImageError(error?.message || 'Impossible d\'enregistrer le centre.');
    } finally {
      setIsCenterStyleSaving(false);
    }
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

  const handleCenterModeChange = (nextMode) => {
    if (![CENTER_MODE_UPLOAD, CENTER_MODE_URL, CENTER_MODE_CUSTOMIZE].includes(nextMode)) return;
    setCenterEditorMode(nextMode);
    setCenterImageError('');
    setCenterImageStatus('');

    if (nextMode === CENTER_MODE_CUSTOMIZE) {
      setIsCenterImageDragging(false);
    }
  };

  const handleCenterSymbolChange = (nextValueRaw) => {
    const normalizedValue = normalizeSingleCharacter(nextValueRaw);
    setCenterCustomSymbol(normalizedValue || '');
  };

  const handleCenterWidgetToggle = () => {
    if (!farm?.id) return;
    const willOpen = !isCenterWidgetOpen;
    if (willOpen) {
      setSelectedSiteState({ farmId: farm.id, siteIndex: null });
      setIsCustomColorPickerOpen(false);
      setCenterInfoTab('stats');
    }
    setCenterWidgetState({ farmId: farm.id, isOpen: willOpen });
  };

  useEffect(() => {
    setOwnerAvatarIndex(0);
  }, [farm?.proprietaire, ownerProfileQuery.data?.avatarUrl]);

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

  if (farmQuery.isError || !farm) {
    return (
      <div className="farm-page farm-page--error">
        <h1>Page de ferme</h1>
        <p>Ferme introuvable.</p>
        <button type="button" className="farm-page-btn" onClick={() => navigate('/home')}>
          Retour au tableau de bord
        </button>
      </div>
    );
  }

  if (accessDenied) {
    return (
      <div className="farm-page farm-page--private">
        <div className="farm-private-card" role="status" aria-live="polite">
          <div className="farm-private-lock" aria-hidden="true">
            <div className="farm-private-lock-shackle" />
            <div className="farm-private-lock-body">
              <div className="farm-private-lock-keyhole" />
            </div>
          </div>

          <div className="farm-private-orbit" aria-hidden="true">
            <div className="farm-private-crypto-shell">
              <div className="farm-private-crypto-track">
                <span className="farm-private-crypto-bit c1">A1F3</span>
                <span className="farm-private-crypto-bit c2">7D9C</span>
                <span className="farm-private-crypto-bit c3">0x5E</span>
                <span className="farm-private-crypto-bit c4">B2A8</span>
                <span className="farm-private-crypto-bit c5">31CF</span>
              </div>
              <div className="farm-private-crypto-scan" />
            </div>
          </div>

          <p className="farm-private-eyebrow">Accès restreint</p>
          <h1 className="farm-private-title">Cette ferme est privée</h1>
          <p className="farm-private-text">
            Le propriétaire a choisi de garder cette ferme hors de la communauté pour le moment.
          </p>

          <div className="farm-private-actions">
            <button type="button" className="farm-page-btn" onClick={() => navigate('/community')}>
              Retour à la communauté
            </button>
            <button type="button" className="farm-page-btn ghost" onClick={() => navigate('/home')}>
              Tableau de bord
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="farm-page">
      <header className="farm-page-header">
        <div>
          <p className="farm-page-eyebrow">{isOwner ? 'Votre ferme' : 'Mode visiteur'}</p>
          <h1 className="farm-page-title">{farmLabel}</h1>
          <div className="farm-page-owner-row">
            <button
              type="button"
              className="farm-page-owner-link"
              onClick={() => {
                const path = buildCommunityProfilePath(ownerName, farm?.proprietaire);
                if (path) navigate(path);
              }}
              disabled={!farm?.proprietaire || !ownerName}
              title={ownerName ? `Voir le profil de ${ownerName}` : 'Voir le profil du propriétaire'}
            >
              <span className="farm-page-owner-avatar" aria-hidden="true">
                {ownerAvatarSrc ? (
                  <img
                    src={ownerAvatarSrc}
                    alt="Avatar propriétaire"
                    loading="lazy"
                    onError={() => {
                      if (ownerAvatarIndex < ownerAvatarCandidates.length - 1) {
                        setOwnerAvatarIndex((current) => current + 1);
                        return;
                      }
                      setOwnerAvatarIndex(ownerAvatarCandidates.length);
                    }}
                  />
                ) : (
                  <img src={defaultProfileUser} alt="Avatar propriétaire" loading="lazy" />
                )}
              </span>
              <span className="farm-page-owner-name">{ownerName || 'Propriétaire inconnu'}</span>
            </button>
            <p className="farm-page-subtitle">État : {farm.state || '-'}</p>
          </div>
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
          ) : !isCenterWidgetOpen ? (
            <p className="farm-page-site-empty">
              Cliquez sur un site dans l'hexagone ou sur le centre pour découvrir les options.
            </p>
          ) : null}
          {isCenterWidgetOpen ? (
            <div className="farm-page-center-panel" aria-live="polite">
              <div className="farm-page-center-main-tabs" role="tablist" aria-label="Onglets centre de la ferme">
                <button
                  type="button"
                  className={`farm-page-center-main-tab ${centerInfoTab === 'stats' ? 'is-active' : ''}`}
                  onClick={() => setCenterInfoTab('stats')}
                  role="tab"
                  aria-selected={centerInfoTab === 'stats'}
                >
                  Statistiques
                </button>
                <button
                  type="button"
                  className={`farm-page-center-main-tab ${centerInfoTab === 'customization' ? 'is-active' : ''}`}
                  onClick={() => {
                    if (!isOwner) return;
                    setCenterInfoTab('customization');
                  }}
                  role="tab"
                  aria-selected={centerInfoTab === 'customization'}
                  disabled={!isOwner}
                >
                  Personnalisation
                </button>
              </div>

              <div className="farm-page-center-main-content">
                {(centerInfoTab === 'stats' || !isOwner) ? (
                  <div className="farm-page-center-main-pane is-stats">
                    <div className="farm-page-center-widget">
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
                  </div>
                ) : null}

                {centerInfoTab === 'customization' && isOwner ? (
                  <div className="farm-page-center-main-pane is-customization">
                    <div className="farm-page-center-style-card" role="region" aria-label="Personnalisation du centre">
                      <p className="farm-page-center-style-title">Apparence du centre</p>

                      <div className="radio-inputs" role="tablist" aria-label="Modes de personnalisation du centre">
                        <label className="radio" htmlFor={`center-mode-upload-${farm.id}`}>
                          <input
                            type="radio"
                            id={`center-mode-upload-${farm.id}`}
                            name={`center-mode-tabs-${farm.id}`}
                            checked={centerEditorMode === CENTER_MODE_UPLOAD}
                            onChange={() => handleCenterModeChange(CENTER_MODE_UPLOAD)}
                          />
                          <span className="name">Importer</span>
                        </label>

                        <label className="radio" htmlFor={`center-mode-url-${farm.id}`}>
                          <input
                            type="radio"
                            id={`center-mode-url-${farm.id}`}
                            name={`center-mode-tabs-${farm.id}`}
                            checked={centerEditorMode === CENTER_MODE_URL}
                            onChange={() => handleCenterModeChange(CENTER_MODE_URL)}
                          />
                          <span className="name">URL</span>
                        </label>

                        <label className="radio" htmlFor={`center-mode-customize-${farm.id}`}>
                          <input
                            type="radio"
                            id={`center-mode-customize-${farm.id}`}
                            name={`center-mode-tabs-${farm.id}`}
                            checked={centerEditorMode === CENTER_MODE_CUSTOMIZE}
                            onChange={() => handleCenterModeChange(CENTER_MODE_CUSTOMIZE)}
                          />
                          <span className="name">Personnaliser</span>
                        </label>
                      </div>

                      <div className="farm-page-center-style-body">
                        <input
                          ref={centerFileInputRef}
                          type="file"
                          accept="image/*"
                          className="farm-page-hidden-file-input"
                          onChange={handleCenterImageFileChange}
                        />

                        <div className={`farm-page-center-mode-pane ${centerEditorMode === CENTER_MODE_UPLOAD ? 'is-active' : ''}`}>
                          <button
                            type="button"
                            className="farm-page-btn farm-page-center-action"
                            onClick={() => centerFileInputRef.current?.click()}
                            disabled={isCenterStyleSaving}
                          >
                            Choisir une image
                          </button>
                          <p className="farm-page-center-mode-hint">Import local puis recadrage du centre.</p>
                        </div>

                        <div className={`farm-page-center-mode-pane ${centerEditorMode === CENTER_MODE_URL ? 'is-active' : ''}`}>
                          <label className="farm-page-center-url-label">
                            URL image
                            <input
                              type="url"
                              className="farm-page-center-url-input"
                              value={centerImageInputUrl}
                              onChange={(event) => setCenterImageInputUrl(event.target.value)}
                              placeholder="https://..."
                              disabled={isCenterUrlLoading || isCenterStyleSaving}
                            />
                          </label>
                          <button
                            type="button"
                            className="farm-page-btn farm-page-center-action"
                            onClick={handleCenterLoadFromUrl}
                            disabled={isCenterUrlLoading || isCenterStyleSaving}
                          >
                            {isCenterUrlLoading ? 'Chargement...' : 'Charger l\'image'}
                          </button>
                        </div>

                        <div className={`farm-page-center-mode-pane farm-page-center-mode-customize ${centerEditorMode === CENTER_MODE_CUSTOMIZE ? 'is-active' : ''}`}>
                          <label className="farm-page-center-color-label">
                            Couleur du centre
                            <input
                              type="color"
                              value={centerBackgroundColor}
                              onChange={(event) => setCenterCustomBackground(event.target.value || DEFAULT_CENTER_BACKGROUND_COLOR)}
                              disabled={isCenterStyleSaving}
                            />
                          </label>
                          <label className="farm-page-center-symbol-label">
                            Lettre ou emoji
                            <input
                              type="text"
                              value={centerCustomSymbol}
                              maxLength={4}
                              onChange={(event) => handleCenterSymbolChange(event.target.value)}
                              placeholder="H"
                              disabled={isCenterStyleSaving}
                            />
                          </label>
                        </div>

                        {centerDraftType === 'image' ? (
                          <div className="farm-page-center-image-stage">
                            <div
                              ref={centerPreviewRef}
                              className={`farm-page-center-image-preview ${isCenterImageDragging ? 'is-dragging' : ''}`}
                              onPointerDown={handleCenterImagePointerDown}
                              onPointerMove={handleCenterImagePointerMove}
                              onPointerUp={handleCenterImagePointerUp}
                              onPointerLeave={handleCenterImagePointerUp}
                            >
                              {centerImagePreviewUrl ? (
                                <img
                                  src={centerImagePreviewUrl}
                                  alt="Aperçu centre"
                                  draggable={false}
                                  onDragStart={(event) => event.preventDefault()}
                                  onLoad={(event) => {
                                    setCenterImageNaturalSize({
                                      width: event.currentTarget.naturalWidth || 0,
                                      height: event.currentTarget.naturalHeight || 0,
                                    });

                                    const rect = centerPreviewRef.current?.getBoundingClientRect();
                                    if (rect?.width && rect?.height) {
                                      setCenterPreviewSize((currentSize) => {
                                        const nextSize = Math.min(rect.width, rect.height);
                                        return Math.abs(currentSize - nextSize) > 0.25 ? nextSize : currentSize;
                                      });
                                    }
                                  }}
                                  style={{
                                    width: `${centerImageNaturalSize.width ? centerImageNaturalSize.width * getCenterBaseScale() : effectiveCenterPreviewSize}px`,
                                    height: `${centerImageNaturalSize.height ? centerImageNaturalSize.height * getCenterBaseScale() : effectiveCenterPreviewSize}px`,
                                    transform: `translate(-50%, -50%) translate(${centerImagePosition.x}px, ${centerImagePosition.y}px) scale(${centerImageZoom})`,
                                  }}
                                />
                              ) : (
                                <span className="farm-page-center-image-placeholder">Aucune image sélectionnée</span>
                              )}
                            </div>

                            {centerImagePreviewUrl ? (
                              <div className="farm-page-center-image-controls">
                                <label>
                                  Zoom
                                  <input
                                    type="range"
                                    min="1"
                                    max="2.5"
                                    step="0.01"
                                    value={centerImageZoom}
                                    onChange={(event) => {
                                      const nextZoom = clampCenterZoom(event.target.value);
                                      setCenterImageZoom(nextZoom);
                                      setCenterImagePosition((currentPosition) => clampCenterPosition(currentPosition, nextZoom));
                                    }}
                                    disabled={isCenterStyleSaving}
                                  />
                                </label>
                                <p>Glissez l'image pour recadrer.</p>
                              </div>
                            ) : null}
                          </div>
                        ) : (
                          <div className="farm-page-center-custom-stage">
                            <div
                              className="farm-page-center-custom-preview is-large"
                              style={{ background: centerBackgroundColor }}
                              aria-label="Aperçu centre personnalisé"
                            >
                              <span>{centerSymbol || DEFAULT_CENTER_SYMBOL}</span>
                            </div>
                            <p>Le symbole sera affiché sur le centre avec la couleur choisie.</p>
                          </div>
                        )}
                      </div>

                      {centerImageError ? <p className="farm-page-center-feedback is-error">{centerImageError}</p> : null}
                      {centerImageStatus ? <p className="farm-page-center-feedback is-success">{centerImageStatus}</p> : null}

                      <button
                        type="button"
                        className="farm-page-btn farm-page-center-save-btn"
                        onClick={handleSaveCenterStyle}
                        disabled={!hasCenterPendingChange || isCenterStyleSaving || updateCenterStyleMutation.isPending}
                      >
                        {isCenterStyleSaving || updateCenterStyleMutation.isPending ? 'Enregistrement...' : 'Enregistrer les changements'}
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>
      </section>
    </div>
  );
}

export default FarmPage;
