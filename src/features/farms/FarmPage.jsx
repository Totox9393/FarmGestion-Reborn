import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2, RefreshCcw, ShoppingCart, Truck, Users } from 'lucide-react';
import { useRef } from 'react';
import { supabase } from '../authentification/supabaseClient';
import { useAuth } from '../authentification/AuthContext';
import { FarmDesignPreview } from '../utils/FarmDesign';
import { normalizeCenterStyle, normalizeSiteColors } from '../utils/FarmDesign/farmDesignUtils';
import {
  MAX_BADGE_SLOTS,
  equipFarmBadgeReborn,
  fetchFarmBadgesEquipsReborn,
  fetchUserBadgesEquipsReborn,
  fetchUserBadgesInventoryReborn,
  unequipFarmBadgeReborn,
} from '../badges';
import './FarmPage.css';

const ROTATION_STORAGE_KEY = 'farmgestion_farm_hex_rotate';
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const FARM_BACKGROUND_DARK_URL = SUPABASE_URL
  ? `${SUPABASE_URL}/storage/v1/object/public/ressources/fond_farm2.png`
  : '';
const FARM_BACKGROUND_LIGHT_URL = SUPABASE_URL
  ? `${SUPABASE_URL}/storage/v1/object/public/ressources/fond_farm3.png`
  : '';
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
const CUSTOMIZATION_VIEW_SITES = 'sites';
const CUSTOMIZATION_VIEW_CENTER = 'center';
const PANEL_TAB_OVERVIEW = 'overview';
const PANEL_TAB_CUSTOMIZATION = 'customization';
const FARM_SITE_VALUES = ['1', '2', '3', '4', '5', '6'];
const SITE_MANAGED_SITE_CAPACITY = 30;
const SITE_MANAGED_BAR_COLORS = ['#e7b347', '#dc9157', '#8baa58', '#67a98c', '#7084b8', '#ba7b96'];
const DEFAULT_OWNER_DASHBOARD_STATS = {
  population: 0,
  inhabitedSites: 0,
  purchasesToday: 0,
  shippedToday: 0,
  withShippingInProgress: 0,
  withoutShippingInProgress: 0,
  premiumCount: 0,
  standardCount: 0,
  siteCountsBySite: FARM_SITE_VALUES.map((site) => ({ site, count: 0 })),
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
    .select('id, name, proprietaire, state, visible, site_colors, center_style, creation_date')
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

const getTodayRangeIso = () => {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return {
    startIso: start.toISOString(),
    endIso: end.toISOString(),
  };
};

const countRowsSafely = async (requestPromise) => {
  try {
    const { count, error } = await requestPromise;
    if (error) {
      return 0;
    }
    return Number(count || 0);
  } catch {
    return 0;
  }
};

const fetchOwnerDashboardStats = async ({ farmId, ownerId }) => {
  if (!farmId || !ownerId) {
    return { ...DEFAULT_OWNER_DASHBOARD_STATS };
  }

  const { startIso, endIso } = getTodayRangeIso();

  const populationPromise = countRowsSafely(
    supabase
      .from('betails')
      .select('id', { count: 'exact', head: true })
      .eq('farm_id', farmId)
      .eq('owner_id', ownerId)
      .eq('visible', true),
  );

  const inhabitedSitePromises = FARM_SITE_VALUES.map((siteValue) =>
    countRowsSafely(
      supabase
        .from('betails')
        .select('id', { count: 'exact', head: true })
        .eq('farm_id', farmId)
        .eq('owner_id', ownerId)
        .eq('visible', true)
        .eq('farm_site', siteValue),
    ),
  );

  const purchasesTodayPromise = countRowsSafely(
    supabase
      .from('betails')
      .select('id', { count: 'exact', head: true })
      .eq('owner_id', ownerId)
      .gte('purchased_at', startIso)
      .lt('purchased_at', endIso),
  );

  const shippedTodayPromise = countRowsSafely(
    supabase
      .from('shipping')
      .select('id, betails!inner(owner_id)', { count: 'exact', head: true })
      .eq('betails.owner_id', ownerId)
      .eq('betails.visible', true)
      .eq('status', 'scheduled')
      .gte('scheduled_for', startIso)
      .lt('scheduled_for', endIso),
  );

  const withShippingInProgressPromise = countRowsSafely(
    supabase
      .from('shipping')
      .select('id, betails!inner(owner_id, farm_id)', { count: 'exact', head: true })
      .eq('betails.owner_id', ownerId)
      .eq('betails.farm_id', farmId)
      .eq('betails.visible', true)
      .eq('status', 'scheduled'),
  );

  const premiumCountPromise = countRowsSafely(
    supabase
      .from('betails')
      .select('id', { count: 'exact', head: true })
      .eq('farm_id', farmId)
      .eq('owner_id', ownerId)
      .eq('visible', true)
      .eq('premium', true),
  );

  const standardCountPromise = countRowsSafely(
    supabase
      .from('betails')
      .select('id', { count: 'exact', head: true })
      .eq('farm_id', farmId)
      .eq('owner_id', ownerId)
      .eq('visible', true)
      .eq('premium', false),
  );

  const [population, siteCounts, purchasesToday, shippedToday, withShippingInProgressRaw, premiumCount, standardCount] = await Promise.all([
    populationPromise,
    Promise.all(inhabitedSitePromises),
    purchasesTodayPromise,
    shippedTodayPromise,
    withShippingInProgressPromise,
    premiumCountPromise,
    standardCountPromise,
  ]);

  const inhabitedSites = siteCounts.reduce((count, sitePopulation) => (sitePopulation > 0 ? count + 1 : count), 0);
  const withShippingInProgress = clampNumber(withShippingInProgressRaw, 0, population);
  const withoutShippingInProgress = Math.max(0, population - withShippingInProgress);

  return {
    population,
    inhabitedSites,
    purchasesToday,
    shippedToday,
    withShippingInProgress,
    withoutShippingInProgress,
    premiumCount,
    standardCount,
    siteCountsBySite: FARM_SITE_VALUES.map((site, index) => ({
      site,
      count: siteCounts[index] || 0,
    })),
  };
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
  const [panelTab, setPanelTab] = useState(PANEL_TAB_OVERVIEW);
  const [customizationView, setCustomizationView] = useState(CUSTOMIZATION_VIEW_CENTER);
  const [selectedSiteState, setSelectedSiteState] = useState({ farmId: null, siteIndex: null });
  const [hoveredSiteState, setHoveredSiteState] = useState({ farmId: null, siteIndex: null });
  const [customColorDraft, setCustomColorDraft] = useState(DEFAULT_CUSTOM_COLOR);
  const [isCustomColorPickerOpen, setIsCustomColorPickerOpen] = useState(false);
  const [farmVisibleDraft, setFarmVisibleDraft] = useState(true);
  const [badgePickerSlot, setBadgePickerSlot] = useState(null);
  const [isBadgePickerOpen, setIsBadgePickerOpen] = useState(false);
  const [refreshSpinTick, setRefreshSpinTick] = useState(0);
  const [centerEditorMode, setCenterEditorMode] = useState(CENTER_MODE_UPLOAD);
  const [centerImageInputUrl, setCenterImageInputUrl] = useState('');
  const [centerImagePreviewUrl, setCenterImagePreviewUrl] = useState('');
  const [centerImageZoom, setCenterImageZoom] = useState(DEFAULT_CENTER_IMAGE_ZOOM);
  const [centerImagePosition, setCenterImagePosition] = useState({ ...DEFAULT_CENTER_IMAGE_POSITION });
  const [centerImageNaturalSize, setCenterImageNaturalSize] = useState({ width: 0, height: 0 });
  const [isCenterImageDragging, setIsCenterImageDragging] = useState(false);
  const [centerImageDragStart, setCenterImageDragStart] = useState({ x: 0, y: 0 });
  const [centerImageDragOrigin, setCenterImageDragOrigin] = useState({ x: 0, y: 0 });
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

  const farmBadgesQuery = useQuery({
    queryKey: ['farm', 'equips', farm?.id || null],
    queryFn: () => fetchFarmBadgesEquipsReborn(farm.id),
    enabled: Boolean(farm?.id),
    staleTime: 20_000,
    gcTime: 300_000,
    refetchOnWindowFocus: false,
    retry: 1,
  });

  const userBadgesInventoryQuery = useQuery({
    queryKey: ['settings', 'badges', 'inventory', user?.id || 'anon'],
    queryFn: () => fetchUserBadgesInventoryReborn(user.id),
    enabled: Boolean(isOwner && user?.id),
    staleTime: 30_000,
    gcTime: 300_000,
    refetchOnWindowFocus: false,
    retry: 1,
  });

  const userBadgesEquipsQuery = useQuery({
    queryKey: ['settings', 'badges', 'equips', user?.id || 'anon'],
    queryFn: () => fetchUserBadgesEquipsReborn(user.id),
    enabled: Boolean(isOwner && user?.id),
    staleTime: 20_000,
    gcTime: 300_000,
    refetchOnWindowFocus: false,
    retry: 1,
  });

  const farmLabel = farm?.name || (farm?.id ? `Ferme #${farm.id}` : 'Ferme');
  const ownerName = ownerNameQuery.data || '';
  const myFarmId = myFarmIdQuery.data ?? null;
  const isCustomizationPanelActive = panelTab === PANEL_TAB_CUSTOMIZATION;
  const equippedBadges = useMemo(() => {
    return [...(farmBadgesQuery.data || [])]
      .sort((a, b) => (a.slot || 99) - (b.slot || 99));
  }, [farmBadgesQuery.data]);
  const inventoryBadges = useMemo(() => userBadgesInventoryQuery.data || [], [userBadgesInventoryQuery.data]);
  const userEquippedBadges = useMemo(() => userBadgesEquipsQuery.data || [], [userBadgesEquipsQuery.data]);
  const equippedBadgeIdSet = useMemo(
    () => new Set(userEquippedBadges.map((badge) => badge.id)),
    [userEquippedBadges],
  );
  const farmEquippedBySlot = useMemo(() => {
    const map = new Map();
    equippedBadges.forEach((badge) => {
      if (Number.isFinite(Number(badge.slot))) {
        map.set(Number(badge.slot), badge);
      }
    });
    return map;
  }, [equippedBadges]);
  const freeInventoryBadges = useMemo(
    () => inventoryBadges.filter((badge) => !equippedBadgeIdSet.has(badge.id)),
    [inventoryBadges, equippedBadgeIdSet],
  );
  const selectedSlotBadge = useMemo(() => {
    if (!Number.isFinite(Number(badgePickerSlot))) return null;
    return farmEquippedBySlot.get(Number(badgePickerSlot)) || null;
  }, [badgePickerSlot, farmEquippedBySlot]);
  const siteColors = useMemo(() => normalizeSiteColors(farm?.site_colors), [farm?.site_colors]);
  const normalizedCenterStyle = useMemo(() => normalizeCenterStyle(farm?.center_style), [farm?.center_style]);
  const storedCenterImageDraft = useMemo(() => readStoredCenterImageDraft(farm?.center_style), [farm?.center_style]);
  const selectedSiteIndex = selectedSiteState.farmId === farm?.id ? selectedSiteState.siteIndex : null;
  const hoveredSiteIndex = hoveredSiteState.farmId === farm?.id ? hoveredSiteState.siteIndex : null;
  const visibleBadges = equippedBadges.slice(0, 3);
  const hiddenBadgesCount = Math.max(0, equippedBadges.length - visibleBadges.length);
  const selectedSiteNumber = selectedSiteIndex == null ? null : selectedSiteIndex + 1;
  const selectedSiteColor = selectedSiteIndex == null ? '' : siteColors[selectedSiteIndex] || '';
  const activeSiteColor = selectedSiteColor || siteColors[0] || '';
  const selectedColorIsPreset = SITE_COLOR_PRESETS.some((color) => colorEquals(color, activeSiteColor));
  const visibilityLabel = farmVisibleDraft ? 'Publique' : 'Privée';
  const visibilityToggleHint = farmVisibleDraft
    ? 'Cliquer pour rendre la ferme privée'
    : 'Cliquer pour rendre la ferme publique';
  const equippedSlotsCount = equippedBadges.reduce(
    (count, badge) => (Number.isFinite(Number(badge.slot)) ? count + 1 : count),
    0,
  );
  const isBadgesLoading = farmBadgesQuery.isLoading || userBadgesInventoryQuery.isLoading || userBadgesEquipsQuery.isLoading;
  const isBadgesFetching = farmBadgesQuery.isFetching || userBadgesInventoryQuery.isFetching || userBadgesEquipsQuery.isFetching;
  const badgesLoadError = userBadgesInventoryQuery.error || userBadgesEquipsQuery.error;
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

  const ownerDashboardQuery = useQuery({
    queryKey: ['farm', 'owner-dashboard-stats', farm?.id || null, user?.id || null],
    queryFn: () => fetchOwnerDashboardStats({ farmId: farm.id, ownerId: user.id }),
    enabled: Boolean(isOwner && farm?.id && user?.id && panelTab === PANEL_TAB_OVERVIEW),
    staleTime: 90_000,
    gcTime: 600_000,
    refetchOnWindowFocus: false,
    retry: 1,
    placeholderData: (previousData) => previousData,
  });

  const ownerDashboardStats = ownerDashboardQuery.data || DEFAULT_OWNER_DASHBOARD_STATS;
  const shippingPieRatio = ownerDashboardStats.population > 0
    ? clampNumber(ownerDashboardStats.withShippingInProgress / ownerDashboardStats.population, 0, 1)
    : 0;
  const premiumRatio = ownerDashboardStats.population > 0
    ? clampNumber(ownerDashboardStats.premiumCount / ownerDashboardStats.population, 0, 1)
    : 0;
  const standardRatio = ownerDashboardStats.population > 0
    ? clampNumber(ownerDashboardStats.standardCount / ownerDashboardStats.population, 0, 1)
    : 0;
  const managedSitesData = useMemo(
    () => FARM_SITE_VALUES.map((site, index) => {
      const matchingSite = ownerDashboardStats.siteCountsBySite?.find((item) => item.site === site);
      const count = Number(matchingSite?.count || 0);
      return {
        site,
        count,
        ratio: clampNumber(count / SITE_MANAGED_SITE_CAPACITY, 0, 1),
        color: SITE_MANAGED_BAR_COLORS[index % SITE_MANAGED_BAR_COLORS.length],
      };
    }),
    [ownerDashboardStats.siteCountsBySite],
  );

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

  const updateFarmVisibilityMutation = useMutation({
    mutationFn: async ({ farmId: nextFarmId, ownerId, nextVisible }) => {
      const { error } = await supabase
        .from('farms_list')
        .update({ visible: nextVisible })
        .eq('id', nextFarmId)
        .eq('proprietaire', ownerId);
      if (error) throw error;
      return nextVisible;
    },
    onMutate: async ({ farmId: nextFarmId, nextVisible }) => {
      await queryClient.cancelQueries({ queryKey: ['farm', 'by-id', nextFarmId] });
      const previousFarm = queryClient.getQueryData(['farm', 'by-id', nextFarmId]);
      queryClient.setQueryData(['farm', 'by-id', nextFarmId], (currentFarm) =>
        currentFarm ? { ...currentFarm, visible: nextVisible } : currentFarm,
      );
      return { previousFarm, farmId: nextFarmId };
    },
    onError: (_error, _variables, context) => {
      if (context?.previousFarm && context.farmId != null) {
        queryClient.setQueryData(['farm', 'by-id', context.farmId], context.previousFarm);
      }
      setFarmVisibleDraft(Boolean(context?.previousFarm?.visible));
      window.dispatchEvent(
        new CustomEvent('farmgestion-toast', {
          detail: { type: 'error', message: 'Impossible de mettre à jour la visibilité de la ferme.' },
        }),
      );
    },
  });

  const equipFarmBadgeMutation = useMutation({
    mutationFn: ({ badgeId, slot = null }) => equipFarmBadgeReborn({ badgeId, slot }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings', 'badges', 'equips', user?.id || 'anon'] });
      queryClient.invalidateQueries({ queryKey: ['settings', 'badges', 'inventory', user?.id || 'anon'] });
      queryClient.invalidateQueries({ queryKey: ['farm', 'equips', farm?.id || null] });
    },
  });

  const unequipFarmBadgeMutation = useMutation({
    mutationFn: ({ badgeId }) => unequipFarmBadgeReborn({ badgeId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings', 'badges', 'equips', user?.id || 'anon'] });
      queryClient.invalidateQueries({ queryKey: ['settings', 'badges', 'inventory', user?.id || 'anon'] });
      queryClient.invalidateQueries({ queryKey: ['farm', 'equips', farm?.id || null] });
    },
  });

  const isBadgeMutationPending = equipFarmBadgeMutation.isPending || unequipFarmBadgeMutation.isPending;

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
    setFarmVisibleDraft(Boolean(farm?.visible));
  }, [farm?.id, farm?.visible]);

  useEffect(() => {
    if (!isBadgePickerOpen) return undefined;

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        setIsBadgePickerOpen(false);
        setBadgePickerSlot(null);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isBadgePickerOpen]);

  useEffect(() => {
    if (!isOwner || panelTab !== PANEL_TAB_OVERVIEW) {
      setIsBadgePickerOpen(false);
      setBadgePickerSlot(null);
    }
  }, [isOwner, panelTab]);

  useEffect(() => {
    if (!isCustomizationPanelActive || !farm?.id) return;

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
    isCustomizationPanelActive,
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
    if (!isCustomizationPanelActive) return;

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
  }, [isCustomizationPanelActive, centerEditorMode, centerImagePreviewUrl]);

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
    setIsCustomColorPickerOpen(false);
  };

  const handleSiteClick = (siteIndex) => {
    if (farm?.id == null) return;
    if (!Number.isInteger(siteIndex) || siteIndex < 0 || siteIndex > 5) return;
    setSelectedSiteState({ farmId: farm.id, siteIndex });
    setPanelTab(PANEL_TAB_CUSTOMIZATION);
    setCustomizationView(CUSTOMIZATION_VIEW_SITES);
    setCustomColorDraft(siteColors[siteIndex] || DEFAULT_CUSTOM_COLOR);
    setIsCustomColorPickerOpen(false);
  };

  const handleApplySiteColor = (nextColorRaw) => {
    if (!isOwner || selectedSiteIndex == null) return;
    const targetSiteIndex = selectedSiteIndex;
    const nextColor = String(nextColorRaw || '').trim();
    if (!nextColor) return;
    const previousColor = siteColors[targetSiteIndex];
    if (colorEquals(previousColor, nextColor)) return;
    const nextColors = siteColors.map((color, index) => (index === targetSiteIndex ? nextColor : color));
    if (farm?.id != null) {
      queryClient.setQueryData(['farm', 'by-id', farm.id], (currentFarm) =>
        currentFarm ? { ...currentFarm, site_colors: nextColors } : currentFarm,
      );
    }
    queueSiteColorPersist(nextColors);
  };

  const openCustomColorPicker = () => {
    if (selectedSiteIndex == null) return;
    const targetSiteIndex = selectedSiteIndex;
    setCustomColorDraft(siteColors[targetSiteIndex] || DEFAULT_CUSTOM_COLOR);
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

  const handlePanelTabChange = (nextTab) => {
    setPanelTab(nextTab);
    if (nextTab !== PANEL_TAB_OVERVIEW) {
      setIsBadgePickerOpen(false);
      setBadgePickerSlot(null);
    }
    if (nextTab !== PANEL_TAB_CUSTOMIZATION) {
      setIsCustomColorPickerOpen(false);
    }
  };

  const handleCenterClickFromHex = () => {
    if (!farm?.id) return;
    setPanelTab(PANEL_TAB_CUSTOMIZATION);
    setCustomizationView(CUSTOMIZATION_VIEW_CENTER);
    setIsCustomColorPickerOpen(false);
  };

  const handleRefreshBadges = async () => {
    if (!farm?.id || !user?.id || !isOwner) return;
    setRefreshSpinTick((currentTick) => currentTick + 1);
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['farm', 'equips', farm.id] }),
      queryClient.invalidateQueries({ queryKey: ['settings', 'badges', 'inventory', user.id] }),
      queryClient.invalidateQueries({ queryKey: ['settings', 'badges', 'equips', user.id] }),
    ]);
  };

  const handleFarmVisibilityToggle = async () => {
    if (!isOwner || !farm?.id || !user?.id || updateFarmVisibilityMutation.isPending) return;
    const nextValue = !farmVisibleDraft;
    setFarmVisibleDraft(nextValue);

    try {
      await updateFarmVisibilityMutation.mutateAsync({
        farmId: farm.id,
        ownerId: user.id,
        nextVisible: nextValue,
      });
      window.dispatchEvent(
        new CustomEvent('farmgestion-toast', {
          detail: { type: 'success', message: nextValue ? 'Ferme publique activée.' : 'Ferme privée activée.' },
        }),
      );
    } catch {
      // rollback géré dans onError de la mutation
    }
  };

  const handleEquipFarmBadge = async (badgeId, slot = null) => {
    if (!isOwner || !badgeId || !farm?.id || equipFarmBadgeMutation.isPending) return;
    try {
      const result = await equipFarmBadgeMutation.mutateAsync({ badgeId, slot });
      if (!result?.success) {
        const reason = result?.reason || 'UNKNOWN';
        if (reason === 'NO_FREE_SLOT') {
          window.dispatchEvent(new CustomEvent('farmgestion-toast', { detail: { type: 'error', message: 'Tous les slots ferme sont occupés.' } }));
        } else if (reason === 'BADGE_ALREADY_EQUIPPED') {
          window.dispatchEvent(new CustomEvent('farmgestion-toast', { detail: { type: 'error', message: 'Ce badge est déjà équipé ailleurs.' } }));
        } else if (reason === 'BADGE_NOT_OWNED') {
          window.dispatchEvent(new CustomEvent('farmgestion-toast', { detail: { type: 'error', message: 'Ce badge n\'est pas dans ton inventaire.' } }));
        } else {
          window.dispatchEvent(new CustomEvent('farmgestion-toast', { detail: { type: 'error', message: 'Équipement ferme impossible pour le moment.' } }));
        }
        return;
      }
      window.dispatchEvent(new CustomEvent('farmgestion-toast', { detail: { type: 'success', message: 'Badge équipé sur la ferme.' } }));
    } catch (error) {
      const message = String(error?.message || '').toLowerCase();
      if (error?.code === '42883' || message.includes('equip_farm_badge_reborn')) {
        window.dispatchEvent(new CustomEvent('farmgestion-toast', { detail: { type: 'error', message: 'Fonction SQL equip_farm_badge_reborn absente.' } }));
      } else {
        window.dispatchEvent(new CustomEvent('farmgestion-toast', { detail: { type: 'error', message: 'Erreur pendant l\'équipement de la ferme.' } }));
      }
    }
  };

  const handleUnequipFarmBadge = async (badgeId) => {
    if (!isOwner || !badgeId || unequipFarmBadgeMutation.isPending) return;
    try {
      const result = await unequipFarmBadgeMutation.mutateAsync({ badgeId });
      if (!result?.success) {
        window.dispatchEvent(new CustomEvent('farmgestion-toast', { detail: { type: 'error', message: 'Déséquipement ferme impossible pour le moment.' } }));
        return;
      }
      window.dispatchEvent(new CustomEvent('farmgestion-toast', { detail: { type: 'success', message: 'Badge retiré de la ferme.' } }));
    } catch (error) {
      const message = String(error?.message || '').toLowerCase();
      if (error?.code === '42883' || message.includes('unequip_farm_badge_reborn')) {
        window.dispatchEvent(new CustomEvent('farmgestion-toast', { detail: { type: 'error', message: 'Fonction SQL unequip_farm_badge_reborn absente.' } }));
      } else {
        window.dispatchEvent(new CustomEvent('farmgestion-toast', { detail: { type: 'error', message: 'Erreur pendant le déséquipement de la ferme.' } }));
      }
    }
  };

  const openBadgePickerForSlot = (slot) => {
    if (!isOwner || !Number.isFinite(Number(slot))) return;
    setBadgePickerSlot(Number(slot));
    setIsBadgePickerOpen(true);
  };

  const closeBadgePicker = () => {
    setIsBadgePickerOpen(false);
    setBadgePickerSlot(null);
  };

  const handleEquipBadgeFromSlotPicker = async (badge) => {
    const slot = Number(badgePickerSlot);
    if (!isOwner || !Number.isFinite(slot) || !badge?.id || !farm?.id || isBadgeMutationPending) return;

    const currentlyEquipped = farmEquippedBySlot.get(slot);
    if (currentlyEquipped?.id === badge.id) {
      closeBadgePicker();
      return;
    }

    if (currentlyEquipped?.id) {
      try {
        const unequipResult = await unequipFarmBadgeMutation.mutateAsync({ badgeId: currentlyEquipped.id });
        if (!unequipResult?.success) {
          window.dispatchEvent(new CustomEvent('farmgestion-toast', { detail: { type: 'error', message: 'Impossible de remplacer le badge sur ce slot.' } }));
          return;
        }
      } catch {
        window.dispatchEvent(new CustomEvent('farmgestion-toast', { detail: { type: 'error', message: 'Impossible de remplacer le badge sur ce slot.' } }));
        return;
      }
    }

    await handleEquipFarmBadge(badge.id, slot);
    closeBadgePicker();
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
            <span className="farm-page-hex-label">{farmLabel}</span>
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
            {ownerName ? `Propriétaire : ${ownerName}` : 'Propriétaire inconnu'} - État : {farm.state || '-'}
          </p>

          {equippedBadges.length ? (
            <div className="farm-page-badges-overlay" role="list" aria-label="Badges équipés de la ferme">
              {visibleBadges.map((badge) => (
                <div
                  key={badge.id}
                  className={`farm-page-badge-chip ${badge.rarity ? `is-${badge.rarity}` : 'is-unknown'}`}
                  role="listitem"
                  title={`${badge.name} - ${badge.rarityLabel}`}
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
            className="farm-page-hex-stage farm-page-hex-stage--mobile-profile"
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
            onCenterClick={handleCenterClickFromHex}
            centerAriaLabel="Ouvrir l'onglet customisation de la ferme"
            getSiteAriaLabel={(siteIndex) => `Site ${siteIndex + 1}`}
            siteHoverHint={isOwner ? 'Cliquer pour personnaliser' : ''}
          />
        </div>

        <div className="farm-page-panel">
          <div className="farm-page-panel-head">
            <div>
              <p className="farm-page-panel-kicker">Tableau de bord de la ferme</p>
              <p className="farm-page-panel-subtitle">
                {isOwner ? 'Administration propriétaire active.' : 'Mode visiteur : consultation uniquement.'}
              </p>
            </div>
            <div className="farm-page-panel-visibility-controls">
              <span className={`farm-page-panel-visibility-pill ${farmVisibleDraft ? 'is-public' : 'is-private'}`}>
                {visibilityLabel}
              </span>
              {isOwner ? (
                <label
                  className={`farm-page-panel-visibility-switch settings-switch ${updateFarmVisibilityMutation.isPending ? 'is-busy' : ''}`}
                  title={visibilityToggleHint}
                >
                  <input
                    type="checkbox"
                    onChange={handleFarmVisibilityToggle}
                    checked={farmVisibleDraft}
                    disabled={updateFarmVisibilityMutation.isPending}
                    aria-label="Rendre la ferme publique"
                    title={visibilityToggleHint}
                  />
                  <span className="settings-slider" />
                </label>
              ) : null}
            </div>
          </div>

          <div className="farm-page-panel-tabs" role="tablist" aria-label="Onglets du panneau de ferme">
            <button
              type="button"
              role="tab"
              aria-selected={panelTab === PANEL_TAB_OVERVIEW}
              className={`farm-page-panel-tab ${panelTab === PANEL_TAB_OVERVIEW ? 'is-active' : ''}`}
              onClick={() => handlePanelTabChange(PANEL_TAB_OVERVIEW)}
            >
              Aperçu
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={isCustomizationPanelActive}
              className={`farm-page-panel-tab ${isCustomizationPanelActive ? 'is-active' : ''}`}
              onClick={() => handlePanelTabChange(PANEL_TAB_CUSTOMIZATION)}
            >
              Customisation
            </button>
          </div>

          <div className="farm-page-panel-content">
            {panelTab === PANEL_TAB_OVERVIEW ? (
              <div className="farm-page-overview-tab">
                {isOwner ? (
                  <div className="farm-page-owner-dashboard">
                    <div className="farm-page-dashboard-top-cards" role="list" aria-label="Indicateurs principaux">
                      <article className="farm-page-dashboard-stat-card" role="listitem">
                        <p className="farm-page-dashboard-stat-title">
                          <Users size={15} aria-hidden="true" />
                          Population
                        </p>
                        <strong>{ownerDashboardStats.population}</strong>
                        <span>Nombre total de bétails dans la ferme</span>
                      </article>

                      <article className="farm-page-dashboard-stat-card" role="listitem">
                        <p className="farm-page-dashboard-stat-title">
                          <Building2 size={15} aria-hidden="true" />
                          Sites habités
                        </p>
                        <strong>{ownerDashboardStats.inhabitedSites}</strong>
                        <span>Sites contenant au moins un bétail</span>
                      </article>
                    </div>

                    <section className="farm-page-dashboard-activity" aria-label="Activité récente">
                      <p className="farm-page-dashboard-activity-title">Activité récente</p>

                      <div className="farm-page-dashboard-activity-content">
                        <div className="farm-page-dashboard-activity-metrics">
                          <article className="farm-page-dashboard-activity-metric">
                            <p>
                              <ShoppingCart size={14} aria-hidden="true" />
                              Achats aujourd'hui
                            </p>
                            <strong>{ownerDashboardStats.purchasesToday}</strong>
                          </article>

                          <article className="farm-page-dashboard-activity-metric">
                            <p>
                              <Truck size={14} aria-hidden="true" />
                              Expéditions aujourd'hui
                            </p>
                            <strong>{ownerDashboardStats.shippedToday}</strong>
                          </article>
                        </div>

                        <div className="farm-page-dashboard-pie-block" aria-label="Répartition des expéditions en cours">
                          <div
                            className="farm-page-dashboard-pie"
                            style={{ '--with-shipping-ratio': shippingPieRatio }}
                            role="img"
                            aria-label={`Expéditions en cours: ${ownerDashboardStats.withShippingInProgress} avec date, ${ownerDashboardStats.withoutShippingInProgress} sans date`}
                          >
                            <span className="farm-page-dashboard-pie-value">{Math.round(shippingPieRatio * 100)}%</span>
                          </div>

                          <div className="farm-page-dashboard-pie-legend">
                            <p className="is-with-shipping">
                              Avec expédition <strong>{ownerDashboardStats.withShippingInProgress}</strong>
                            </p>
                            <p className="is-without-shipping">
                              Sans expédition <strong>{ownerDashboardStats.withoutShippingInProgress}</strong>
                            </p>
                          </div>
                        </div>
                      </div>
                    </section>

                    <div className="farm-page-dashboard-bottom-grid">
                      <section className="farm-page-dashboard-split" aria-label="Répartition du bétail">
                        <p className="farm-page-dashboard-split-title">Répartition du bétail</p>

                        <article className="farm-page-dashboard-split-row">
                          <p>
                            Premium
                            <strong>{ownerDashboardStats.premiumCount}</strong>
                          </p>
                          <div className="farm-page-dashboard-split-track" role="img" aria-label={`Premium ${Math.round(premiumRatio * 100)}%`}>
                            <span
                              className="is-premium"
                              style={{ '--split-ratio': premiumRatio }}
                            />
                          </div>
                        </article>

                        <article className="farm-page-dashboard-split-row">
                          <p>
                            Produit standard
                            <strong>{ownerDashboardStats.standardCount}</strong>
                          </p>
                          <div className="farm-page-dashboard-split-track" role="img" aria-label={`Standard ${Math.round(standardRatio * 100)}%`}>
                            <span
                              className="is-standard"
                              style={{ '--split-ratio': standardRatio }}
                            />
                          </div>
                        </article>
                      </section>

                      <section className="farm-page-dashboard-badges farm-page-badge-manager" aria-label="Badges équipés sur la ferme">
                        <div className="farm-page-dashboard-badges-head">
                          <p className="farm-page-dashboard-badges-title">Badges</p>
                          <button
                            type="button"
                            className="settings-admin-refresh-icon-btn"
                            onClick={handleRefreshBadges}
                            aria-label="Rafraîchir les badges"
                            disabled={isBadgesFetching || isBadgeMutationPending}
                          >
                            <RefreshCcw
                              key={`farm-badges-refresh-${refreshSpinTick}`}
                              size={16}
                              className={`settings-admin-refresh-icon ${refreshSpinTick > 0 ? 'is-spinning' : ''}`}
                            />
                          </button>
                        </div>

                        {badgesLoadError ? (
                          <p className="farm-page-badge-state is-error">
                            {badgesLoadError?.message || 'Impossible de charger les badges de la ferme.'}
                          </p>
                        ) : null}
                        {isBadgesLoading ? <p className="farm-page-badge-state">Chargement des badges...</p> : null}

                        <div className="farm-page-dashboard-badge-slots" role="list" aria-label="Slots badges de la ferme">
                          {Array.from({ length: MAX_BADGE_SLOTS }, (_, index) => {
                            const slot = index + 1;
                            const badge = farmEquippedBySlot.get(slot);

                            if (!badge) {
                              return (
                                <button
                                  key={`farm-slot-empty-${slot}`}
                                  type="button"
                                  className="farm-page-dashboard-badge-slot is-empty"
                                  onClick={() => openBadgePickerForSlot(slot)}
                                  disabled={!isOwner || isBadgeMutationPending}
                                  role="listitem"
                                >
                                  <span className="farm-page-dashboard-badge-slot-label">Slot {slot}</span>
                                  <span className="farm-page-dashboard-badge-slot-hint">Équiper</span>
                                </button>
                              );
                            }

                            return (
                              <article
                                key={`farm-slot-${badge.id}`}
                                className={`farm-page-dashboard-badge-slot is-filled is-${badge.rarity}`}
                                role="listitem"
                              >
                                <button
                                  type="button"
                                  className="farm-page-dashboard-badge-preview"
                                  onClick={() => openBadgePickerForSlot(slot)}
                                  disabled={!isOwner || isBadgeMutationPending}
                                  title={`Changer ${badge.name}`}
                                >
                                  {badge.imageUrl ? (
                                    <img src={badge.imageUrl} alt={badge.filename} className="settings-badge-slot-image" loading="lazy" decoding="async" />
                                  ) : (
                                    <span className="settings-badge-slot-fallback" aria-hidden="true">?</span>
                                  )}
                                </button>
                                <p className="farm-page-dashboard-badge-slot-label">Slot {slot}</p>
                                <button
                                  type="button"
                                  className="settings-action settings-action--tiny"
                                  onClick={() => handleUnequipFarmBadge(badge.id)}
                                  disabled={!isOwner || isBadgeMutationPending}
                                >
                                  Retirer
                                </button>
                              </article>
                            );
                          })}
                        </div>
                      </section>
                    </div>

                    <section className="farm-page-dashboard-sites" aria-label="Sites gérés">
                      <p className="farm-page-dashboard-sites-title">Sites gérés</p>
                      <div className="farm-page-dashboard-sites-list" role="list" aria-label="Capacité des sites de la ferme">
                        {managedSitesData.map((siteData) => (
                          <article key={`farm-managed-site-${siteData.site}`} className="farm-page-dashboard-site-row" role="listitem">
                            <p>
                              <span>Site {siteData.site}</span>
                              <strong>{siteData.count}</strong>
                            </p>
                            <div
                              className="farm-page-dashboard-site-track"
                              style={{
                                '--site-ratio': siteData.ratio,
                                '--site-color': siteData.color,
                              }}
                              role="img"
                              aria-label={`Site ${siteData.site} : ${siteData.count} sur ${SITE_MANAGED_SITE_CAPACITY}`}
                            >
                              <span>{siteData.count}/{SITE_MANAGED_SITE_CAPACITY}</span>
                            </div>
                          </article>
                        ))}
                      </div>
                    </section>

                  </div>
                ) : (
                  <p className="farm-page-overview-visitor-note">
                    Cette ferme est actuellement <strong>{visibilityLabel.toLowerCase()}</strong>. Le propriétaire peut modifier cette option.
                  </p>
                )}
              </div>
            ) : null}

            {isCustomizationPanelActive ? (
              <div className="farm-page-customization-panel">
                <div className="farm-page-customization-switch" role="tablist" aria-label="Sections de customisation">
                  <button
                    type="button"
                    role="tab"
                    aria-selected={customizationView === CUSTOMIZATION_VIEW_SITES}
                    className={`farm-page-customization-switch-btn ${customizationView === CUSTOMIZATION_VIEW_SITES ? 'is-active' : ''}`}
                    onClick={() => setCustomizationView(CUSTOMIZATION_VIEW_SITES)}
                  >
                    Palette des sites
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={customizationView === CUSTOMIZATION_VIEW_CENTER}
                    className={`farm-page-customization-switch-btn ${customizationView === CUSTOMIZATION_VIEW_CENTER ? 'is-active' : ''}`}
                    onClick={() => setCustomizationView(CUSTOMIZATION_VIEW_CENTER)}
                  >
                    Centre de la ferme
                  </button>
                </div>

                {customizationView === CUSTOMIZATION_VIEW_SITES ? (
                  selectedSiteNumber ? (
                    <div className="farm-page-site-subpanel" role="region" aria-live="polite" aria-label={`Site ${selectedSiteNumber}`}>
                      <div className="farm-page-site-subpanel-head">
                        <span className="farm-page-site-badge">Couleur - Site n°{selectedSiteNumber}</span>
                        <span className="farm-page-site-color-code">{activeSiteColor || DEFAULT_CUSTOM_COLOR}</span>
                      </div>
                      <p className="farm-page-site-subpanel-copy">
                        {isOwner ? 'Palette active: cliquez une couleur pour ce site.' : 'Mode visiteur : couleurs consultables seulement.'}
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
                              className={`farm-page-clay-color ${colorEquals(activeSiteColor, color) ? 'is-active' : ''}`}
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
                      Cliquez sur un site dans l'hexagone pour afficher la palette de couleurs.
                    </p>
                  )
                ) : null}

                {customizationView === CUSTOMIZATION_VIEW_CENTER ? (
                  <div className="farm-page-center-panel" aria-live="polite">
                    {isOwner ? (
                      <section className="farm-page-center-style-card farm-page-center-style-card--modern" role="region" aria-label="Personnalisation du centre">
                        <div className="farm-page-center-heading">
                          <p className="farm-page-center-style-title">Centre de la ferme</p>
                          <p className="farm-page-center-heading-copy">Importez, chargez par URL ou personnalisez le visuel en direct.</p>
                        </div>

                        <input
                          ref={centerFileInputRef}
                          type="file"
                          accept="image/*"
                          className="farm-page-hidden-file-input"
                          onChange={handleCenterImageFileChange}
                        />

                        <div className="farm-page-center-layout">
                          <div className="farm-page-center-controls">
                            <div className="farm-page-center-mode-tabs" role="tablist" aria-label="Modes de personnalisation du centre">
                              <button
                                type="button"
                                role="tab"
                                aria-selected={centerEditorMode === CENTER_MODE_UPLOAD}
                                className={`farm-page-center-mode-tab ${centerEditorMode === CENTER_MODE_UPLOAD ? 'is-active' : ''}`}
                                onClick={() => handleCenterModeChange(CENTER_MODE_UPLOAD)}
                              >
                                Import
                              </button>
                              <button
                                type="button"
                                role="tab"
                                aria-selected={centerEditorMode === CENTER_MODE_URL}
                                className={`farm-page-center-mode-tab ${centerEditorMode === CENTER_MODE_URL ? 'is-active' : ''}`}
                                onClick={() => handleCenterModeChange(CENTER_MODE_URL)}
                              >
                                URL
                              </button>
                              <button
                                type="button"
                                role="tab"
                                aria-selected={centerEditorMode === CENTER_MODE_CUSTOMIZE}
                                className={`farm-page-center-mode-tab ${centerEditorMode === CENTER_MODE_CUSTOMIZE ? 'is-active' : ''}`}
                                onClick={() => handleCenterModeChange(CENTER_MODE_CUSTOMIZE)}
                              >
                                Perso
                              </button>
                            </div>

                            {centerEditorMode === CENTER_MODE_UPLOAD ? (
                              <div className="farm-page-center-mode-pane">
                                <p className="farm-page-center-mode-pane-title">Importer une image</p>
                                <p className="farm-page-center-mode-hint">Chargement local puis recadrage direct dans l'aperçu.</p>
                                <button
                                  type="button"
                                  className="farm-page-btn farm-page-center-action"
                                  onClick={() => centerFileInputRef.current?.click()}
                                  disabled={isCenterStyleSaving}
                                >
                                  Choisir une image
                                </button>
                              </div>
                            ) : null}

                            {centerEditorMode === CENTER_MODE_URL ? (
                              <div className="farm-page-center-mode-pane">
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
                            ) : null}

                            {centerEditorMode === CENTER_MODE_CUSTOMIZE ? (
                              <div className="farm-page-center-mode-pane farm-page-center-mode-customize">
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
                            ) : null}
                          </div>

                          <div className="farm-page-center-preview-card">
                            <p className="farm-page-center-preview-kicker">Aperçu en direct</p>

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
                                ) : (
                                  <p className="farm-page-center-image-controls-help">Importez ou chargez une image pour commencer.</p>
                                )}
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
                      </section>
                    ) : (
                      <p className="farm-page-site-empty">La customisation du centre est réservée au propriétaire de la ferme.</p>
                    )}
                  </div>
                ) : null}
              </div>
            ) : null}

          </div>

          {isBadgePickerOpen ? (
            <div className="settings-badge-picker-backdrop farm-page-badge-picker-backdrop" role="presentation" onMouseDown={closeBadgePicker}>
              <div
                className="settings-badge-picker-modal farm-page-badge-picker-modal"
                role="dialog"
                aria-modal="true"
                aria-labelledby="farm-page-badge-picker-title"
                onMouseDown={(event) => event.stopPropagation()}
              >
                <p className="settings-badge-picker-kicker">Slot {badgePickerSlot || '-'}</p>
                <h4 id="farm-page-badge-picker-title" className="settings-badge-picker-title">
                  {selectedSlotBadge ? 'Changer le badge du slot' : 'Équiper un badge'}
                </h4>
                <p className="settings-badge-picker-subtitle">
                  {freeInventoryBadges.length
                    ? `${freeInventoryBadges.length} badge(s) libre(s) et équipable(s).`
                    : 'Aucun badge libre à équiper pour le moment.'}
                </p>

                {freeInventoryBadges.length ? (
                  <div
                    className={`settings-badge-picker-grid${freeInventoryBadges.length > 8 ? ' is-scrollable' : ''}`}
                    role="list"
                    aria-label="Badges libres équipables"
                  >
                    {freeInventoryBadges.map((badge) => (
                      <button
                        key={`farm-slot-picker-${badge.id}`}
                        type="button"
                        className={`settings-badge-picker-card is-${badge.rarity}`}
                        onClick={() => handleEquipBadgeFromSlotPicker(badge)}
                        disabled={isBadgeMutationPending}
                      >
                        {badge.imageUrl ? (
                          <img src={badge.imageUrl} alt={badge.filename} className="settings-badge-slot-image" loading="lazy" decoding="async" />
                        ) : (
                          <span className="settings-badge-slot-fallback" aria-hidden="true">?</span>
                        )}
                        <span className="settings-badge-picker-name">{badge.name}</span>
                      </button>
                    ))}
                  </div>
                ) : null}

                <div className="settings-badge-picker-actions">
                  <button type="button" className="settings-action" onClick={closeBadgePicker} disabled={isBadgeMutationPending}>
                    Annuler
                  </button>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </section>
    </div>
  );
}

export default FarmPage;
