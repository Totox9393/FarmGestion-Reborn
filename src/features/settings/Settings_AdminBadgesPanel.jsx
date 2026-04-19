import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { RefreshCcw, X } from 'lucide-react';
import { supabase } from '../authentification/supabaseClient';
import { BADGE_RARITY_LABELS, getBadgeImageUrl, normalizeBadgeCatalogRow, sortBadgesByRarityThenName } from '../badges';

const ADMIN_BADGES_QUERY_KEY = ['settings', 'admin', 'badges', 'catalog-reborn'];
const BADGES_BUCKET = 'badges';
const BUCKET_FOLDERS = ['0_auto', '1_common', '2_rare', '3_epic', '4_legendary'];
const RARITY_OPTIONS = ['1_common', '2_rare', '3_epic', '4_legendary', '0_auto'];
const IMAGE_EXTENSIONS = ['gif', 'png', 'jpg', 'jpeg', 'webp', 'avif'];

const emitToast = (type, message) => {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('farmgestion-toast', { detail: { type, message } }));
};

const parseRpcResult = (data) => {
  if (typeof data === 'string') {
    try {
      return JSON.parse(data);
    } catch {
      return null;
    }
  }
  return data;
};

const isRpcSignatureError = (error) => {
  const message = String(error?.message || '').toLowerCase();
  return (
    error?.code === '42883' ||
    error?.code === 'PGRST202' ||
    message.includes('could not find the function') ||
    message.includes('function public.') && message.includes('does not exist') ||
    message.includes('no function matches the given name')
  );
};

const tryRpcVariants = async (functionName, variants) => {
  let lastSignatureError = null;

  for (const params of variants) {
    const { data, error } = await supabase.rpc(functionName, params);
    if (!error) {
      return parseRpcResult(data);
    }
    if (isRpcSignatureError(error)) {
      lastSignatureError = error;
      continue;
    }
    throw error;
  }

  if (lastSignatureError) throw lastSignatureError;
  throw new Error(`Aucune variante RPC valide pour ${functionName}.`);
};

const stripFileExtension = (value) => String(value || '').replace(/\.[^.]+$/i, '');

const normalizeFilenameInput = (value) => {
  const trimmed = String(value || '').trim().replace(/\\/g, '/');
  if (!trimmed) return '';
  const segments = trimmed.split('/');
  return segments[segments.length - 1] || '';
};

const slugifyFilenameBase = (value) => {
  const safe = String(value || '')
    .trim()
    .replace(/\s+/g, '_')
    .replace(/[^a-zA-Z0-9_-]/g, '');
  return safe || `badge_${Date.now()}`;
};

const toSafeInt = (value, fallback = 0) => {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(0, Math.round(number));
};

const inferRarityFromStock = (stock) => {
  const safeStock = Math.max(1, toSafeInt(stock, 1));
  if (safeStock <= 10) return '4_legendary';
  if (safeStock <= 25) return '3_epic';
  if (safeStock <= 60) return '2_rare';
  return '1_common';
};

const inferPriceFromStock = (stock, rarity) => {
  const safeStock = Math.max(1, toSafeInt(stock, 1));
  const rarityBase = {
    '0_auto': 80,
    '1_common': 150,
    '2_rare': 740,
    '3_epic': 2280,
    '4_legendary': 4700,
  };
  const base = rarityBase[rarity] || 150;
  const scarcityFactor = Math.max(0.6, Math.min(3.4, 60 / safeStock));
  const randomnessFactor = [0.94, 1, 1.08, 1.16][safeStock % 4];
  const suggested = base * scarcityFactor * randomnessFactor;
  return Math.max(50, Math.round(suggested / 10) * 10);
};

const buildSuggestionsFromStock = (stock) => {
  const rarity = inferRarityFromStock(stock);
  return {
    rarity,
    price: inferPriceFromStock(stock, rarity),
  };
};

const normalizeLower = (value) => String(value || '').trim().toLowerCase();

const normalizeBase = (value) => stripFileExtension(normalizeLower(value));

const isFilenameMatch = (candidate, needle) => {
  const safeCandidate = normalizeLower(candidate);
  const safeNeedle = normalizeLower(needle);
  if (!safeCandidate || !safeNeedle) return false;
  if (safeCandidate === safeNeedle) return true;
  return normalizeBase(safeCandidate) === normalizeBase(safeNeedle);
};

const hasKnownExtension = (value) => /\.[a-z0-9]+$/i.test(String(value || '').trim());

const uniqueArray = (items) => Array.from(new Set((items || []).filter(Boolean)));

const buildFilenameCandidates = (rawNeedle) => {
  const normalized = normalizeFilenameInput(rawNeedle);
  if (!normalized) return [];

  if (hasKnownExtension(normalized)) {
    const lower = normalizeLower(normalized);
    const upper = normalized.toUpperCase();
    return uniqueArray([normalized, lower, upper]);
  }

  const base = stripFileExtension(normalized);
  const lowerBase = normalizeLower(base);
  const upperBase = String(base).toUpperCase();
  const candidates = [];
  IMAGE_EXTENSIONS.forEach((extension) => {
    candidates.push(`${base}.${extension}`);
    candidates.push(`${lowerBase}.${extension}`);
    candidates.push(`${upperBase}.${extension}`);
  });
  return uniqueArray(candidates);
};

const buildDeleteBadgeRpcVariants = ({ badgeId }) => {
  return [
    { p_badge_id: badgeId },
    { badge_id: badgeId },
    { p_id: badgeId },
    { id: badgeId },
  ];
};

const createBadgeCatalogDirectly = async ({ filename, name, rarity, price, stockTotal, isShopVisible }) => {
  const basePayload = {
    filename,
    name,
    rarity,
    price: Math.max(0, toSafeInt(price, 0)),
    stock_total: Math.max(1, toSafeInt(stockTotal, 1)),
    sold_count: 0,
    is_active: true,
  };

  const withVisibilityPayload = {
    ...basePayload,
    is_shop_visible: Boolean(isShopVisible),
  };

  const { error } = await supabase.from('badges_catalog_reborn').insert(withVisibilityPayload);

  if (!error) {
    return { success: true, created: true, filename };
  }

  const message = String(error?.message || '').toLowerCase();
  const missingVisibilityColumn = error?.code === '42703' || message.includes('is_shop_visible');

  if (!missingVisibilityColumn) throw error;

  const { error: fallbackError } = await supabase.from('badges_catalog_reborn').insert(basePayload);
  if (fallbackError) throw fallbackError;

  return { success: true, created: true, filename };
};
const reasonToFrenchMessage = (reason, fallback) => {
  const normalized = String(reason || '').toUpperCase();
  if (!normalized) return fallback;
  if (normalized === 'NOT_ADMIN') return 'Action réservée à un administrateur.';
  if (normalized === 'FORBIDDEN') return 'Action refusée par la fonction SQL (FORBIDDEN).';
  if (normalized === 'BADGE_NOT_FOUND') return 'Badge introuvable.';
  if (normalized === 'INVALID_STOCK') return 'Stock invalide.';
  if (normalized === 'INVALID_PRICE') return 'Prix invalide.';
  if (normalized === 'INVALID_RARITY') return 'Rareté invalide.';
  if (normalized === 'BADGE_ALREADY_EXISTS' || normalized === 'FILENAME_ALREADY_EXISTS') return 'Ce fichier badge existe déjà.';
  return fallback;
};

const canFallbackToRpcBadgeDelete = (error) => {
  const message = String(error?.message || '').toLowerCase();
  return (
    error?.code === '42501' ||
    message.includes('403') ||
    message.includes('forbidden') ||
    message.includes('rls') ||
    message.includes('policy') ||
    message.includes('permission') ||
    message.includes('not allowed') ||
    message.includes('denied')
  );
};

const extractRpcFailureReason = (result) => {
  if (!result || typeof result !== 'object') return '';
  const candidates = [
    result.reason,
    result.error,
    result.message,
    result.details,
    result.hint,
    result.code,
  ]
    .map((item) => String(item || '').trim())
    .filter(Boolean);
  if (candidates.length) return candidates.join(' | ');
  try {
    return JSON.stringify(result);
  } catch {
    return '';
  }
};

const ensureRpcSuccess = (result, fallbackMessage) => {
  if (result && typeof result === 'object' && Object.prototype.hasOwnProperty.call(result, 'success') && !result.success) {
    const reason = extractRpcFailureReason(result);
    if (reason) {
      throw new Error(reasonToFrenchMessage(reason, `${fallbackMessage} (${reason})`));
    }
    throw new Error(fallbackMessage);
  }
  return result;
};

const fetchAdminBadgeCatalog = async () => {
  const baseSelect = 'id,filename,name,rarity,price,stock_total,sold_count,is_active,created_at,updated_at';
  const fullSelect = `${baseSelect},is_shop_visible`;

  const { data, error } = await supabase
    .from('badges_catalog_reborn')
    .select(fullSelect)
    .order('created_at', { ascending: false });

  if (error) {
    const message = String(error?.message || '').toLowerCase();
    const isMissingColumn = error?.code === '42703' || message.includes('is_shop_visible');

    if (!isMissingColumn) throw error;

    const { data: fallbackData, error: fallbackError } = await supabase
      .from('badges_catalog_reborn')
      .select(baseSelect)
      .order('created_at', { ascending: false });

    if (fallbackError) throw fallbackError;

    return {
      supportsShopVisibility: false,
      badges: sortBadgesByRarityThenName(
        (fallbackData || [])
          .map((row) => normalizeBadgeCatalogRow(row))
          .filter(Boolean),
      ),
    };
  }

  return {
    supportsShopVisibility: true,
    badges: sortBadgesByRarityThenName(
      (data || [])
        .map((row) => normalizeBadgeCatalogRow(row))
        .filter(Boolean),
    ),
  };
};

const fetchRealSoldCountsByBadge = async () => {
  const { data, error } = await supabase
    .from('badges_inventory_reborn')
    .select('badge_id');

  if (error) throw error;

  return (data || []).reduce((acc, row) => {
    const badgeId = String(row?.badge_id || '').trim();
    if (!badgeId) return acc;
    acc[badgeId] = (acc[badgeId] || 0) + 1;
    return acc;
  }, {});
};

const increaseBadgeStockDirectly = async ({ badgeId, increaseBy }) => {
  const safeIncreaseBy = Math.max(1, toSafeInt(increaseBy, 1));

  const { data: row, error: readError } = await supabase
    .from('badges_catalog_reborn')
    .select('id,stock_total,sold_count')
    .eq('id', badgeId)
    .maybeSingle();

  if (readError) throw readError;
  if (!row?.id) throw new Error('Badge introuvable.');

  const currentStockTotal = toSafeInt(row.stock_total, 0);
  const soldCount = toSafeInt(row.sold_count, 0);
  const nextStockTotal = Math.max(soldCount, currentStockTotal + safeIncreaseBy);

  const { error: updateError } = await supabase
    .from('badges_catalog_reborn')
    .update({ stock_total: nextStockTotal })
    .eq('id', badgeId);

  if (updateError) throw updateError;
  return { success: true, stock_total: nextStockTotal };
};

const addBadgeAvailabilityDirectly = async ({ badgeId, addBy }) => {
  const safeAddBy = Math.max(1, toSafeInt(addBy, 1));

  const { data: row, error: readError } = await supabase
    .from('badges_catalog_reborn')
    .select('id,stock_total,sold_count')
    .eq('id', badgeId)
    .maybeSingle();

  if (readError) throw readError;
  if (!row?.id) throw new Error('Badge introuvable.');

  const stockTotal = toSafeInt(row.stock_total, 0);
  const soldCount = toSafeInt(row.sold_count, 0);
  const stockLeft = Math.max(0, stockTotal - soldCount);

  if (stockLeft >= stockTotal || soldCount <= 0) {
    throw new Error('Stock deja plein: impossible d ajouter un badge disponible.');
  }

  const effectiveAddBy = Math.min(safeAddBy, soldCount);
  const nextSoldCount = Math.max(0, soldCount - effectiveAddBy);

  const { error: updateError } = await supabase
    .from('badges_catalog_reborn')
    .update({ sold_count: nextSoldCount })
    .eq('id', badgeId);

  if (updateError) throw updateError;
  return { success: true, added: effectiveAddBy };
};

const listFolderPage = async (storage, folder, options = {}) => {
  const { data, error } = await storage.list(folder, options);
  if (error) throw error;
  return Array.isArray(data) ? data : [];
};

const findMatchingFileInFolder = async (storage, folder, needle) => {
  const candidates = buildFilenameCandidates(needle);
  if (!candidates.length) return null;

  const searchTerms = uniqueArray([
    normalizeFilenameInput(needle),
    stripFileExtension(normalizeFilenameInput(needle)),
    ...candidates.map((candidate) => stripFileExtension(candidate)),
  ]).slice(0, 6);

  for (const term of searchTerms) {
    if (!term) continue;
    const page = await listFolderPage(storage, folder, { limit: 100, search: term });
    const exact = page.find((item) => candidates.some((candidate) => isFilenameMatch(item?.name, candidate)));
    if (exact?.name) return exact.name;
  }

  for (let offset = 0; offset <= 4000; offset += 200) {
    const page = await listFolderPage(storage, folder, {
      limit: 200,
      offset,
      sortBy: { column: 'name', order: 'asc' },
    });
    if (!page.length) break;
    const exact = page.find((item) => candidates.some((candidate) => isFilenameMatch(item?.name, candidate)));
    if (exact?.name) return exact.name;
    if (page.length < 200) break;
  }

  return null;
};

const findBadgeInBucketByName = async (rawNeedle) => {
  const needle = normalizeFilenameInput(rawNeedle);
  if (!needle) return null;

  const storage = supabase.storage.from(BADGES_BUCKET);

  for (const folder of BUCKET_FOLDERS) {
    const foundFilename = await findMatchingFileInFolder(storage, folder, needle);
    if (foundFilename) {
      const { data: publicData } = storage.getPublicUrl(`${folder}/${foundFilename}`);
      return {
        filename: foundFilename,
        name: stripFileExtension(foundFilename),
        rarity: folder,
        imageUrl: publicData?.publicUrl || getBadgeImageUrl(foundFilename, folder),
      };
    }
  }

  return null;
};

const uploadBadgeImageToBucket = async ({ file, rarity, preferredFilename }) => {
  if (!file) throw new Error('Aucun fichier à envoyer.');
  if (!rarity) throw new Error('Rareté manquante pour upload.');

  const rawFileName = normalizeFilenameInput(preferredFilename || file.name);
  const extension = String(rawFileName.split('.').pop() || file.name.split('.').pop() || '').toLowerCase();
  const safeExt = IMAGE_EXTENSIONS.includes(extension) ? extension : 'png';
  const base = slugifyFilenameBase(stripFileExtension(rawFileName || file.name));
  const storage = supabase.storage.from(BADGES_BUCKET);

  const candidates = uniqueArray([
    `${base}.${safeExt}`,
    `${base}_${Date.now()}.${safeExt}`,
    `${base}_${Date.now()}_${Math.floor(Math.random() * 10000)}.${safeExt}`,
  ]);

  let lastError = null;

  for (const candidateFilename of candidates) {
    const objectPath = `${rarity}/${candidateFilename}`;
    const { error } = await storage.upload(objectPath, file, {
      cacheControl: '3600',
      upsert: false,
      contentType: file.type || undefined,
    });

    if (!error) {
      return {
        filename: candidateFilename,
        path: objectPath,
      };
    }

    lastError = error;
    const message = normalizeLower(error?.message);
    const canRetry =
      error?.statusCode === '409' ||
      message.includes('already exists') ||
      message.includes('duplicate') ||
      message.includes('resource already exists');

    if (!canRetry) break;
  }

  const errorMessage = String(lastError?.message || 'Upload bucket impossible.');
  throw new Error(`Upload bucket impossible: ${errorMessage}`);
};

function Settings_AdminBadgesPanel({ isActive, canAccessAdministration }) {
  const queryClient = useQueryClient();
  const [feedback, setFeedback] = useState({ type: '', message: '' });
  const [searchValue, setSearchValue] = useState('');
  const [sourceMode, setSourceMode] = useState('bucket');
  const [bucketLookupInput, setBucketLookupInput] = useState('');
  const [bucketPreview, setBucketPreview] = useState(null);
  const [name, setName] = useState('');
  const [filename, setFilename] = useState('');
  const [rarity, setRarity] = useState('1_common');
  const [price, setPrice] = useState(150);
  const [stockTotal, setStockTotal] = useState(50);
  const [uploadFile, setUploadFile] = useState(null);
  const [uploadPreviewUrl, setUploadPreviewUrl] = useState('');
  const [isPriceManual, setIsPriceManual] = useState(false);
  const [isRarityManual, setIsRarityManual] = useState(false);
  const [isShopVisible, setIsShopVisible] = useState(true);
  const [stockIncreaseById, setStockIncreaseById] = useState({});
  const [confirmDeleteBadgeId, setConfirmDeleteBadgeId] = useState('');

  useEffect(() => {
    if (!isActive) return;
    setFeedback({ type: '', message: '' });
  }, [isActive]);

  useEffect(() => {
    const suggestion = buildSuggestionsFromStock(stockTotal);
    if (!isRarityManual) setRarity(suggestion.rarity);
    if (!isPriceManual) setPrice(suggestion.price);
  }, [stockTotal, isPriceManual, isRarityManual]);

  useEffect(() => {
    return () => {
      if (uploadPreviewUrl && uploadPreviewUrl.startsWith('blob:')) {
        URL.revokeObjectURL(uploadPreviewUrl);
      }
    };
  }, [uploadPreviewUrl]);

  const badgesQuery = useQuery({
    queryKey: ADMIN_BADGES_QUERY_KEY,
    queryFn: fetchAdminBadgeCatalog,
    enabled: Boolean(isActive && canAccessAdministration),
    staleTime: 15_000,
    gcTime: 300_000,
    retry: 1,
    refetchOnWindowFocus: false,
  });

  const soldCountsQuery = useQuery({
    queryKey: ['settings', 'admin', 'badges', 'sold-counts-reborn'],
    queryFn: fetchRealSoldCountsByBadge,
    enabled: Boolean(isActive && canAccessAdministration),
    staleTime: 15_000,
    gcTime: 300_000,
    retry: 1,
    refetchOnWindowFocus: false,
  });

  const supportsShopVisibility = badgesQuery.data?.supportsShopVisibility !== false;

  const filteredBadges = useMemo(() => {
    const rows = badgesQuery.data?.badges || [];
    const needle = normalizeLower(searchValue);
    if (!needle) return rows;
    return rows.filter((badge) => {
      const haystack = `${badge.filename} ${badge.name} ${badge.rarity}`.toLowerCase();
      return haystack.includes(needle);
    });
  }, [badgesQuery.data, searchValue]);

  const createBadgeMutation = useMutation({
    mutationFn: async () => {
      const safeName = String(name || '').trim();
      const safeRarity = String(rarity || '').trim();
      const safeStock = Math.max(1, toSafeInt(stockTotal, 1));
      const safePrice = toSafeInt(price, 0);

      if (!RARITY_OPTIONS.includes(safeRarity)) {
        throw new Error('Sélectionne une rareté valide.');
      }

      if (!safeName) {
        throw new Error('Le nom du badge est obligatoire.');
      }

      let finalFilename = normalizeFilenameInput(filename);
      let uploadedPath = '';

      try {
        if (sourceMode === 'upload') {
          if (!uploadFile) {
            throw new Error('Ajoute une image avant de créer le badge.');
          }
          const uploaded = await uploadBadgeImageToBucket({
            file: uploadFile,
            rarity: safeRarity,
            preferredFilename: filename || uploadFile.name,
          });
          finalFilename = uploaded.filename;
          uploadedPath = uploaded.path;
        } else if (!finalFilename) {
          throw new Error('Charge un badge du bucket ou saisis un nom de fichier.');
        }

        const safeDisplayName = safeName || stripFileExtension(finalFilename);
        await createBadgeCatalogDirectly({
          filename: finalFilename,
          name: safeDisplayName,
          rarity: safeRarity,
          price: safePrice,
          stockTotal: safeStock,
          isShopVisible,
        });

        return {
          filename: finalFilename,
          uploadedPath,
        };
      } catch (error) {
        if (uploadedPath) {
          await supabase.storage.from(BADGES_BUCKET).remove([uploadedPath]).catch(() => {});
        }
        throw error;
      }
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ADMIN_BADGES_QUERY_KEY });
      queryClient.invalidateQueries({ queryKey: ['settings', 'badges'] });
      setFeedback({ type: 'success', message: `Badge ${result?.filename || ''} créé.` });
      emitToast('success', `Badge ${result?.filename || ''} créé.`);

      setName('');
      setFilename('');
      setBucketLookupInput('');
      setBucketPreview(null);
      setUploadFile(null);
      if (uploadPreviewUrl && uploadPreviewUrl.startsWith('blob:')) {
        URL.revokeObjectURL(uploadPreviewUrl);
      }
      setUploadPreviewUrl('');
      setStockTotal(50);
      setIsShopVisible(true);
      setIsPriceManual(false);
      setIsRarityManual(false);
    },
    onError: (error) => {
      const message = String(error?.message || 'Création badge impossible.');
      if (error?.code === '42501' || message.includes('403')) {
        setFeedback({ type: 'error', message: 'Permission refusée. Vérifie les policies RLS SQL (badges_catalog_reborn + storage.objects badges).' });
        emitToast('error', 'Permission refusée pour création badge (RLS).');
        return;
      }
      setFeedback({ type: 'error', message });
      emitToast('error', message);
    },
  });

  const addBadgeMutation = useMutation({
    mutationFn: async ({ badgeId, amount }) => {
      const safeAmount = Math.max(1, toSafeInt(amount, 1));
      const result = await addBadgeAvailabilityDirectly({ badgeId, addBy: safeAmount });
      ensureRpcSuccess(result, 'Ajout badge disponible impossible.');
      return { badgeId, amount: toSafeInt(result?.added, safeAmount) };
    },
    onSuccess: ({ badgeId, amount }) => {
      queryClient.invalidateQueries({ queryKey: ADMIN_BADGES_QUERY_KEY });
      setFeedback({ type: 'success', message: `Badge disponible ajoute +${amount}.` });
      emitToast('success', `Badge disponible ajoute +${amount}.`);
      setStockIncreaseById((current) => ({ ...current, [badgeId]: '1' }));
    },
    onError: (error) => {
      const message = String(error?.message || 'Ajout badge disponible impossible.');
      if (error?.code === '42501' || message.includes('403')) {
        setFeedback({ type: 'error', message: 'Permission refusée pour ajouter un badge disponible (RLS).' });
        emitToast('error', 'Permission refusée pour ajouter un badge disponible.');
        return;
      }
      setFeedback({ type: 'error', message });
      emitToast('error', message);
    },
  });

  const increaseStockMutation = useMutation({
    mutationFn: async ({ badgeId, amount }) => {
      const safeAmount = Math.max(1, toSafeInt(amount, 1));
      const result = await increaseBadgeStockDirectly({ badgeId, increaseBy: safeAmount });
      ensureRpcSuccess(result, 'Augmentation de stock impossible.');
      return { badgeId, amount: safeAmount };
    },
    onSuccess: ({ badgeId, amount }) => {
      queryClient.invalidateQueries({ queryKey: ADMIN_BADGES_QUERY_KEY });
      setFeedback({ type: 'success', message: `Capacite stock augmentee de +${amount}.` });
      emitToast('success', `Capacite stock augmentee de +${amount}.`);
      setStockIncreaseById((current) => ({ ...current, [badgeId]: '1' }));
    },
    onError: (error) => {
      const message = String(error?.message || 'Augmentation de stock impossible.');
      if (error?.code === '42501' || message.includes('403')) {
        setFeedback({ type: 'error', message: 'Permission refusée pour augmenter le stock (RLS). Vérifie les policies admin update sur badges_catalog_reborn.' });
        emitToast('error', 'Permission refusée pour augmenter le stock.');
        return;
      }
      setFeedback({ type: 'error', message });
      emitToast('error', message);
    },
  });

  const deleteBadgeMutation = useMutation({
    mutationFn: async ({ badgeId, rarity: badgeRarity, filename: badgeFilename }) => {
      let usedRpcFallback = false;
      try {
        const { error: deleteError } = await supabase
          .from('badges_catalog_reborn')
          .delete()
          .eq('id', badgeId);

        if (deleteError) throw deleteError;
      } catch (directDeleteError) {
        if (!canFallbackToRpcBadgeDelete(directDeleteError)) {
          throw directDeleteError;
        }

        const result = await tryRpcVariants(
          'admin_delete_badge_reborn',
          buildDeleteBadgeRpcVariants({ badgeId }),
        );
        ensureRpcSuccess(result, 'Suppression badge impossible.');
        usedRpcFallback = true;
      }

      let storageErrorMessage = '';
      const storagePath = `${badgeRarity}/${badgeFilename}`;
      if (badgeRarity && badgeFilename) {
        const { error: storageError } = await supabase.storage.from(BADGES_BUCKET).remove([storagePath]);
        if (storageError) {
          storageErrorMessage = `Badge supprimé en DB, mais suppression bucket en échec (${storagePath}).`;
        }
      }

      return { badgeFilename, storageErrorMessage, usedRpcFallback };
    },
    onSuccess: ({ badgeFilename, storageErrorMessage, usedRpcFallback }) => {
      setConfirmDeleteBadgeId('');
      queryClient.invalidateQueries({ queryKey: ADMIN_BADGES_QUERY_KEY });
      queryClient.invalidateQueries({ queryKey: ['settings', 'badges'] });
      queryClient.invalidateQueries({ queryKey: ['settings', 'admin', 'badges', 'sold-counts-reborn'] });

      if (storageErrorMessage) {
        setFeedback({ type: 'error', message: storageErrorMessage });
        emitToast('error', storageErrorMessage);
        return;
      }

      const successMessage = usedRpcFallback
        ? `Badge ${badgeFilename || ''} supprimé (mode RPC).`
        : `Badge ${badgeFilename || ''} supprimé.`;
      setFeedback({ type: 'success', message: successMessage });
      emitToast('success', successMessage);
    },
    onError: (error) => {
      const message = String(error?.message || 'Suppression badge impossible.');
      if (error?.code === '42501' || message.includes('403')) {
        setFeedback({ type: 'error', message: 'Permission refusée pour supprimer ce badge (RLS).' });
        emitToast('error', 'Permission refusée pour supprimer ce badge (RLS).');
        return;
      }
      if (isRpcSignatureError(error) || message.toLowerCase().includes('admin_delete_badge_reborn')) {
        setFeedback({ type: 'error', message: 'Fonction SQL admin_delete_badge_reborn absente ou signature différente.' });
        emitToast('error', 'Fonction SQL admin_delete_badge_reborn absente ou signature différente.');
        return;
      }
      setFeedback({ type: 'error', message });
      emitToast('error', message);
    },
  });

  const toggleShopVisibilityMutation = useMutation({
    mutationFn: async ({ badgeId, nextVisible }) => {
      const { error } = await supabase
        .from('badges_catalog_reborn')
        .update({ is_shop_visible: Boolean(nextVisible) })
        .eq('id', badgeId);

      if (error) throw error;
      return { nextVisible };
    },
    onSuccess: ({ nextVisible }) => {
      queryClient.invalidateQueries({ queryKey: ADMIN_BADGES_QUERY_KEY });
      queryClient.invalidateQueries({ queryKey: ['shop', 'catalog'] });
      setFeedback({
        type: 'success',
        message: nextVisible ? 'Badge rendu visible en boutique.' : 'Badge masque de la boutique.',
      });
    },
    onError: (error) => {
      const message = String(error?.message || 'Mise a jour de visibilite impossible.');
      setFeedback({ type: 'error', message });
      emitToast('error', message);
    },
  });

  const isMutating =
    createBadgeMutation.isPending ||
    addBadgeMutation.isPending ||
    increaseStockMutation.isPending ||
    deleteBadgeMutation.isPending ||
    toggleShopVisibilityMutation.isPending;

  const previewUrl = useMemo(() => {
    if (sourceMode === 'upload') {
      return uploadPreviewUrl || '';
    }
    if (bucketPreview?.imageUrl) return bucketPreview.imageUrl;
    if (filename && rarity) return getBadgeImageUrl(filename, rarity);
    return '';
  }, [bucketPreview?.imageUrl, filename, rarity, sourceMode, uploadPreviewUrl]);
  const stockSuggestion = useMemo(() => buildSuggestionsFromStock(stockTotal), [stockTotal]);
  const hasDisplayName = Boolean(name.trim());
  const hasAssetSource = sourceMode === 'upload' ? Boolean(uploadFile) : Boolean(filename.trim());
  const canSubmitCreateBadge = !isMutating && hasDisplayName && Boolean(rarity) && hasAssetSource;

  if (!isActive || !canAccessAdministration) return null;

  const handleLoadFromBucket = async () => {
    const needle = normalizeFilenameInput(bucketLookupInput);
    if (!needle) {
      setFeedback({ type: 'error', message: 'Saisis un nom de badge à chercher (ex: BR489.gif).' });
      return;
    }

    setFeedback({ type: '', message: '' });

    try {
      const found = await findBadgeInBucketByName(needle);
      if (!found) {
        setBucketPreview(null);
        setFeedback({ type: 'error', message: `Aucun badge trouvé pour ${needle}.` });
        emitToast('error', `Aucun badge trouvé pour ${needle}.`);
        return;
      }

      setBucketPreview(found);
      setFilename(found.filename);
      setName(found.name);
      setRarity(found.rarity);
      setIsRarityManual(true);
      setSourceMode('bucket');
      setFeedback({ type: 'success', message: `Badge bucket chargé: ${found.filename}.` });
      emitToast('success', `Badge bucket chargé: ${found.filename}.`);
    } catch (error) {
      const message = String(error?.message || 'Recherche bucket impossible.');
      setFeedback({ type: 'error', message });
      emitToast('error', message);
    }
  };

  const handleRefresh = () => {
    queryClient.invalidateQueries({ queryKey: ADMIN_BADGES_QUERY_KEY });
    queryClient.invalidateQueries({ queryKey: ['settings', 'admin', 'badges', 'sold-counts-reborn'] });
  };

  const handleUploadSelection = (event) => {
    const file = event.target?.files?.[0] || null;
    setUploadFile(file);
    setBucketPreview(null);
    setSourceMode('upload');

    if (uploadPreviewUrl && uploadPreviewUrl.startsWith('blob:')) {
      URL.revokeObjectURL(uploadPreviewUrl);
    }
    setUploadPreviewUrl('');

    if (!file) return;
    const objectUrl = URL.createObjectURL(file);
    setUploadPreviewUrl(objectUrl);
    if (!name.trim()) {
      setName(stripFileExtension(file.name));
    }
    setFilename(normalizeFilenameInput(file.name));
  };

  const handleCreateBadge = () => {
    setFeedback({ type: '', message: '' });
    createBadgeMutation.mutate();
  };

  const handleIncreaseStock = (badge) => {
    const rawAmount = stockIncreaseById[badge.id];
    const amount = Math.max(1, toSafeInt(rawAmount, 1));
    increaseStockMutation.mutate({ badgeId: badge.id, amount });
  };

  const handleAddBadge = (badge, canAddBadge) => {
    if (!canAddBadge) {
      return;
    }
    const rawAmount = stockIncreaseById[badge.id];
    const amount = Math.max(1, toSafeInt(rawAmount, 1));
    addBadgeMutation.mutate({ badgeId: badge.id, amount });
  };

  const handleDeleteBadge = (badge) => {
    deleteBadgeMutation.mutate({
      badgeId: badge.id,
      rarity: badge.rarity,
      filename: badge.filename,
    });
  };

  return (
    <div className="settings-section">
      <h3 className="settings-section-title">Administration badges</h3>

      {feedback?.message ? (
        <p className={`settings-admin-feedback ${feedback.type === 'error' ? 'is-error' : 'is-success'}`}>
          {feedback.message}
        </p>
      ) : null}

      <div className="settings-admin-badges-create">
        <div className="settings-admin-badges-create-header">
          <p className="settings-admin-badges-create-kicker">Création guidée</p>
          <h4 className="settings-admin-badges-create-title">Ajouter un badge au catalogue</h4>
          <p className="settings-item-subtitle settings-admin-badges-create-subtitle">
            Le fonctionnement reste identique: choisis la source de l'image, renseigne les informations du badge, puis valide.
          </p>
        </div>

        <div className="settings-admin-badges-step">
          <div className="settings-admin-badges-step-head">
            <span className="settings-admin-badges-step-index" aria-hidden="true">1</span>
            <div>
              <p className="settings-admin-badges-step-title">Choisir la source de l'image</p>
              <p className="settings-item-subtitle">Utilise un badge déjà présent dans le bucket ou importe un nouveau fichier.</p>
            </div>
          </div>

          <div className="settings-admin-badge-source-switch">
            <button
              type="button"
              className={`settings-admin-view-btn ${sourceMode === 'bucket' ? 'active' : ''}`}
              onClick={() => setSourceMode('bucket')}
              disabled={isMutating}
            >
              Utiliser le bucket
            </button>
            <button
              type="button"
              className={`settings-admin-view-btn ${sourceMode === 'upload' ? 'active' : ''}`}
              onClick={() => setSourceMode('upload')}
              disabled={isMutating}
            >
              Importer une image
            </button>
          </div>

          {sourceMode === 'bucket' ? (
            <div className="settings-admin-badges-loader-row">
              <label className="settings-admin-badge-label">
                Nom du fichier dans le bucket
                <input
                  type="text"
                  className="settings-admin-badge-input"
                  value={bucketLookupInput}
                  onChange={(event) => setBucketLookupInput(event.target.value)}
                  placeholder="Ex: BR489.gif"
                  maxLength={80}
                  disabled={isMutating}
                />
              </label>
              <button
                type="button"
                className="settings-action settings-action--tiny"
                onClick={handleLoadFromBucket}
                disabled={isMutating}
              >
                Rechercher
              </button>
            </div>
          ) : (
            <label className="settings-admin-badge-label">
              Fichier image à importer
              <input
                type="file"
                accept="image/gif,image/png,image/jpeg,image/webp,image/avif"
                className="settings-admin-badge-input settings-admin-badge-file-input"
                onChange={handleUploadSelection}
                disabled={isMutating}
              />
            </label>
          )}
        </div>

        <div className="settings-admin-badges-step">
          <div className="settings-admin-badges-step-head">
            <span className="settings-admin-badges-step-index" aria-hidden="true">2</span>
            <div>
              <p className="settings-admin-badges-step-title">Compléter les informations du badge</p>
              <p className="settings-item-subtitle">Les suggestions se mettent à jour automatiquement selon le stock.</p>
            </div>
          </div>

          <div className="settings-admin-badges-create-layout">
            <div className="settings-admin-badges-form-grid">
              <label className="settings-admin-badge-label">
                Nom affiché
                <input
                  type="text"
                  className="settings-admin-badge-input"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="Ex: BR489"
                  maxLength={80}
                  disabled={isMutating}
                />
              </label>

              <label className="settings-admin-badge-label">
                Nom fichier
                <input
                  type="text"
                  className="settings-admin-badge-input"
                  value={filename}
                  onChange={(event) => setFilename(normalizeFilenameInput(event.target.value))}
                  placeholder="Ex: BR489.gif"
                  maxLength={120}
                  disabled={isMutating || sourceMode === 'upload'}
                />
              </label>

              <label className="settings-admin-badge-label">
                Rareté
                <select
                  className="settings-admin-badge-input"
                  value={rarity}
                  onChange={(event) => {
                    setRarity(event.target.value);
                    setIsRarityManual(true);
                  }}
                  disabled={isMutating}
                >
                  {RARITY_OPTIONS.map((rarityValue) => (
                    <option key={rarityValue} value={rarityValue}>
                      {BADGE_RARITY_LABELS[rarityValue] || rarityValue}
                    </option>
                  ))}
                </select>
              </label>

              <label className="settings-admin-badge-label">
                Prix
                <input
                  type="number"
                  className="settings-admin-badge-input"
                  value={price}
                  min={0}
                  step={10}
                  onChange={(event) => {
                    setPrice(toSafeInt(event.target.value, 0));
                    setIsPriceManual(true);
                  }}
                  disabled={isMutating}
                />
              </label>

              <label className="settings-admin-badge-label">
                Stock total
                <input
                  type="number"
                  className="settings-admin-badge-input"
                  value={stockTotal}
                  min={1}
                  step={1}
                  onChange={(event) => setStockTotal(Math.max(1, toSafeInt(event.target.value, 1)))}
                  disabled={isMutating}
                />
              </label>

              <label className="settings-admin-badge-label">
                Visible en boutique
                <select
                  className="settings-admin-badge-input"
                  value={isShopVisible ? 'yes' : 'no'}
                  onChange={(event) => setIsShopVisible(event.target.value === 'yes')}
                  disabled={isMutating || !supportsShopVisibility}
                >
                  <option value="yes">Oui</option>
                  <option value="no">Non (badge spécial)</option>
                </select>
              </label>
            </div>

            <aside className="settings-admin-badge-preview-panel" aria-live="polite">
              <p className="settings-admin-badge-preview-title">Aperçu</p>
              {previewUrl ? (
                <img
                  src={previewUrl}
                  alt={filename || 'Badge preview'}
                  className="settings-admin-badge-preview"
                  loading="lazy"
                  decoding="async"
                />
              ) : (
                <div className="settings-admin-badge-preview-placeholder" aria-hidden="true">?
                </div>
              )}
              <div className="settings-admin-badge-preview-meta">
                <p className="settings-item-subtitle">Source active: {sourceMode === 'upload' ? 'import image' : 'bucket'}</p>
                <p className="settings-item-subtitle">Rareté suggérée: {BADGE_RARITY_LABELS[stockSuggestion.rarity] || stockSuggestion.rarity}</p>
                <p className="settings-item-subtitle">Prix suggéré: {Number(stockSuggestion.price || 0).toLocaleString('fr-FR')} 💸</p>
                <p className="settings-item-subtitle">
                  Mode manuel: rareté {isRarityManual ? 'actif' : 'auto'} | prix {isPriceManual ? 'actif' : 'auto'}
                </p>
              </div>
            </aside>
          </div>

          {!supportsShopVisibility ? (
            <p className="settings-item-subtitle">
              Option visible boutique indisponible: applique la migration SQL surprise_codes_referral_system.sql.
            </p>
          ) : null}
        </div>

        <div className="settings-admin-badges-step">
          <div className="settings-admin-badges-step-head">
            <span className="settings-admin-badges-step-index" aria-hidden="true">3</span>
            <div>
              <p className="settings-admin-badges-step-title">Vérifier puis créer</p>
              <p className="settings-item-subtitle">Cette vérification aide les modérateurs à valider rapidement avant création.</p>
            </div>
          </div>

          <div className="settings-admin-badge-checklist" role="list" aria-label="Vérification avant création">
            <p className={`settings-admin-badge-checkitem ${hasDisplayName ? 'is-ready' : 'is-missing'}`} role="listitem">
              {hasDisplayName ? 'Prêt' : 'À compléter'} - Nom affiché
            </p>
            <p className={`settings-admin-badge-checkitem ${hasAssetSource ? 'is-ready' : 'is-missing'}`} role="listitem">
              {hasAssetSource ? 'Prêt' : 'À compléter'} - Source image
            </p>
            <p className={`settings-admin-badge-checkitem ${rarity ? 'is-ready' : 'is-missing'}`} role="listitem">
              {rarity ? 'Prêt' : 'À compléter'} - Rareté
            </p>
          </div>

          <div className="settings-admin-badges-create-actions">
            <button
              type="button"
              className={`settings-action ${!canSubmitCreateBadge ? 'settings-action--is-disabled' : ''}`}
              onClick={handleCreateBadge}
              disabled={!canSubmitCreateBadge}
              title={!canSubmitCreateBadge ? 'Complète les champs requis pour créer le badge.' : 'Créer le badge'}
            >
              {createBadgeMutation.isPending ? 'Création...' : 'Créer le badge'}
            </button>
          </div>
        </div>
      </div>

      <div className="settings-admin-toolbar settings-admin-toolbar--badges">
        <label className="settings-admin-search-wrap" htmlFor="settings-admin-badges-search">
          <input
            id="settings-admin-badges-search"
            type="search"
            className="settings-admin-search"
            value={searchValue}
            onChange={(event) => setSearchValue(event.target.value)}
            placeholder="Rechercher un badge..."
            maxLength={80}
          />
        </label>
        <button
          type="button"
          className="settings-admin-refresh-icon-btn"
          onClick={handleRefresh}
          aria-label="Rafraîchir les badges"
          title="Rafraîchir"
          disabled={badgesQuery.isFetching}
        >
          <RefreshCcw
            size={16}
            className={`settings-admin-refresh-icon ${badgesQuery.isFetching ? 'is-spinning' : ''}`}
          />
        </button>
      </div>

      {badgesQuery.isLoading ? <p className="settings-loading">Chargement des badges...</p> : null}
      {badgesQuery.error ? (
        <p className="settings-admin-feedback is-error">{badgesQuery.error?.message || 'Chargement badges impossible.'}</p>
      ) : null}

      <div className="settings-admin-badges-list">
        {(filteredBadges || []).map((badge) => {
          const stockInput = stockIncreaseById[badge.id] ?? '1';
          const canAddBadge = badge.stockLeft < badge.stockTotal;
          const realSoldCount = Number(soldCountsQuery.data?.[badge.id] ?? badge.soldCount ?? 0);
          const isDeleteConfirmOpen = confirmDeleteBadgeId === badge.id;
          return (
            <article key={badge.id} className={`settings-admin-badge-row is-${badge.rarity}`}>
              <button
                type="button"
                className={`settings-admin-badge-delete-icon-btn ${isDeleteConfirmOpen ? 'is-active' : ''}`}
                onClick={() => setConfirmDeleteBadgeId((current) => (current === badge.id ? '' : badge.id))}
                disabled={isMutating}
                aria-label={`Supprimer ${badge.name}`}
                title="Supprimer"
              >
                <X size={14} strokeWidth={2.6} aria-hidden="true" />
              </button>

              <div className="settings-admin-badge-row-main">
                {badge.imageUrl ? (
                  <img
                    src={badge.imageUrl}
                    alt={badge.filename}
                    className="settings-admin-badge-avatar"
                    width={54}
                    height={54}
                    loading="lazy"
                    decoding="async"
                  />
                ) : (
                  <span className="settings-badge-slot-fallback settings-admin-badge-avatar" aria-hidden="true">?</span>
                )}
                <div>
                  <p className="settings-item-title">{badge.name}</p>
                  <p className="settings-item-subtitle">{badge.filename}</p>
                  <p className="settings-item-subtitle">
                    {badge.rarityLabel} | Prix: {Number(badge.price || 0).toLocaleString('fr-FR')} 💸
                  </p>
                  <p className="settings-item-subtitle">
                    Stock: {badge.stockLeft}/{badge.stockTotal} (vendus: {realSoldCount}) {badge.isActive ? '' : '| Inactif'}
                  </p>
                  <p className="settings-item-subtitle">
                    Boutique: {badge.isShopVisible === false ? 'non visible' : 'visible'}
                  </p>
                </div>
              </div>

              <div className="settings-admin-badge-actions">
                {isDeleteConfirmOpen ? (
                  <div className="settings-admin-badge-delete-confirm" role="alert">
                    <p className="settings-admin-badge-delete-confirm-text">
                      Confirmer la suppression de ce badge ?
                    </p>
                    <div className="settings-admin-badge-delete-confirm-actions">
                      <button
                        type="button"
                        className="settings-action settings-action--tiny settings-action--danger"
                        onClick={() => handleDeleteBadge(badge)}
                        disabled={isMutating}
                      >
                        Confirmer
                      </button>
                      <button
                        type="button"
                        className="settings-action settings-action--tiny"
                        onClick={() => setConfirmDeleteBadgeId('')}
                        disabled={isMutating}
                      >
                        Annuler
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="settings-admin-badge-stock-panel">
                    <p className="settings-admin-badge-stock-help">
                      Quantite a appliquer
                    </p>
                    <div className="settings-admin-badge-stock-edit">
                      <input
                        type="number"
                        className="settings-admin-badge-input"
                        min={1}
                        step={1}
                        value={stockInput}
                        onChange={(event) =>
                          setStockIncreaseById((current) => ({
                            ...current,
                            [badge.id]: event.target.value,
                          }))
                        }
                        disabled={isMutating}
                      />
                      <button
                        type="button"
                        className="settings-action settings-action--tiny"
                        onClick={() => handleAddBadge(badge, canAddBadge)}
                        disabled={isMutating || !canAddBadge}
                        title={canAddBadge ? 'Ajoute des badges disponibles sans changer la capacite' : 'Stock deja plein'}
                      >
                        Ajouter badge
                      </button>
                      <button
                        type="button"
                        className="settings-action settings-action--tiny"
                        onClick={() => toggleShopVisibilityMutation.mutate({ badgeId: badge.id, nextVisible: badge.isShopVisible === false })}
                        disabled={isMutating || !supportsShopVisibility}
                        title="Rendre ce badge visible ou non dans la boutique"
                      >
                        {badge.isShopVisible === false ? 'Rendre visible boutique' : 'Masquer de la boutique'}
                      </button>
                      <button
                        type="button"
                        className="settings-action settings-action--tiny"
                        onClick={() => handleIncreaseStock(badge)}
                        disabled={isMutating}
                        title="Augmente la capacite maximale du stock"
                      >
                        Augmenter capacite
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </article>
          );
        })}
      </div>

      {!badgesQuery.isLoading && !filteredBadges.length ? (
        <p className="settings-item-subtitle">Aucun badge trouvé.</p>
      ) : null}
    </div>
  );
}

export default Settings_AdminBadgesPanel;
