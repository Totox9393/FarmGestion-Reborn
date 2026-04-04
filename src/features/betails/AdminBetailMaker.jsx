import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowLeft,
  Check,
  ChevronsRight,
  Crown,
  Dice5,
  Fingerprint,
  RefreshCcw,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import './BetailMaker.css';
import './AdminBetailMaker.css';
import digitSound1 from '../../assets/sounds/COUNT_DOWN_10.wav';
import digitSound2 from '../../assets/sounds/COUNT_DOWN_10.wav';
import digitSound3 from '../../assets/sounds/COUNT_DOWN_10.wav';
import digitSound4 from '../../assets/sounds/COUNT_DOWN_3.wav';
import digitSound5 from '../../assets/sounds/COUNT_DOWN_1.wav';
import ageTickSound from '../../assets/sounds/drop_003.ogg';
import defaultProfileImage from '../../assets/defaut_profile.png';
import templateBetail1 from '../../assets/template_betail1.png';
import templateBetail2 from '../../assets/template_betail2.png';
import templateBetail3 from '../../assets/template_betail3.png';
import { useAuth } from '../authentification/AuthContext';
import { supabase } from '../authentification/supabaseClient';
import { BADGE_RARITY_LABELS, getBadgeImageUrl } from '../badges';
import { createSafeAudio, playAudioSafely } from '../utils/safeAudio';

const ADMIN_BADGES_PAGE_SIZE = 18;
const ADMIN_BADGE_ALLOWED_RARITIES = ['0_auto', '1_common', '2_rare', '3_epic', '4_legendary'];

const sanitizeMatriculeInput = (value) => String(value || '').replace(/\D/g, '');
const glowPalette = ['#ff6b6b', '#968eff', '#f2b3ff', '#ffd166', '#a6e3e9', '#c3f0ca'];
const emptyDigitState = ['0', '0', '0', '0', '0'];
const emptyArrivalState = [false, false, false, false, false];
const emptyArrivalCountState = [0, 0, 0, 0, 0];
const defaultGlowState = ['#ff6b6b', '#ff6b6b', '#ff6b6b', '#ff6b6b', '#ff6b6b'];
const templatePhotoZoom = 1.18;
const templatePhotoZoomTight = 1.24;
const templatePhotoOffset = { x: 0, y: 0 };
const templateInvisibleReason = 'produit de développement crée par totox';
const templateLoremIpsum = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed non risus. Suspendisse lectus tortor, dignissim sit amet, adipiscing nec, ultricies sed, dolor.';
const ADMIN_TEMPLATE_OPTIONS = [
  {
    id: 'dev-1ps',
    name: '#DEV Produit 1PS',
    image: templateBetail1,
    previewScale: 1.1,
    photoZoom: templatePhotoZoom,
    age: 12,
    isPremium: false,
    visible: false,
    invisibleReason: null,
    includeInvisibleAt: false,
    commentPrefix: 'Produit de test pour développement 1PS',
  },
  {
    id: 'dev-2p',
    name: '#DEV Produit 2P',
    image: templateBetail2,
    previewScale: 1.16,
    photoZoom: templatePhotoZoomTight,
    age: 12,
    isPremium: true,
    visible: false,
    invisibleReason: templateInvisibleReason,
    includeInvisibleAt: true,
    commentPrefix: 'Produit de test pour développement 2P',
  },
  {
    id: 'dev-3p-long',
    name: '#DEV Produit 3P+Long',
    image: templateBetail3,
    previewScale: 1.1,
    photoZoom: templatePhotoZoom,
    age: 64,
    isPremium: true,
    visible: false,
    invisibleReason: templateInvisibleReason,
    includeInvisibleAt: true,
    commentPrefix: `Produit de test pour développement 3P+Long : ${templateLoremIpsum}`,
  },
];

const getFallbackAuthorLabel = (user) => {
  const username = String(user?.user_metadata?.username || '').trim();
  if (username) return username;
  const email = String(user?.email || '').trim();
  if (email.includes('@')) return email.split('@')[0];
  return email || 'admin';
};

const formatTemplateDateTime = () => {
  try {
    return new Intl.DateTimeFormat('fr-FR', {
      dateStyle: 'short',
      timeStyle: 'medium',
    }).format(new Date());
  } catch {
    return new Date().toLocaleString('fr-FR');
  }
};

const buildTemplateComment = ({ commentPrefix, author, visible }) => {
  const visibilityLabel = visible ? 'true' : 'false';
  return `${commentPrefix}\nCréation : ${formatTemplateDateTime()} par ${author}. Lors de la création VISIBLE = "${visibilityLabel}"`;
};

const normalizeAdminBadgeRow = (row) => {
  const id = String(row?.id || '').trim();
  const filename = String(row?.filename || '').trim();
  const rarity = String(row?.rarity || '').trim();
  if (!id || !filename || !ADMIN_BADGE_ALLOWED_RARITIES.includes(rarity)) return null;

  return {
    id,
    filename,
    name: String(row?.name || filename.replace(/\.[^.]+$/i, '')).trim(),
    rarity,
    rarityLabel: BADGE_RARITY_LABELS[rarity] || rarity,
    imageUrl: getBadgeImageUrl(filename, rarity),
  };
};

const mergeUniqueBadgesById = (rows) => {
  const map = new Map();
  (rows || []).forEach((badge) => {
    if (badge?.id) {
      map.set(badge.id, badge);
    }
  });
  return Array.from(map.values());
};

const fetchAdminBadgeCatalogPage = async ({ search = '', offset = 0, limit = ADMIN_BADGES_PAGE_SIZE }) => {
  let query = supabase
    .from('badges_catalog_reborn')
    .select('id,filename,name,rarity,is_active')
    .eq('is_active', true)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  const safeSearch = String(search || '')
    .trim()
    .replace(/[%]/g, '')
    .replace(/,/g, ' ');
  if (safeSearch.length >= 2) {
    query = query.or(`name.ilike.%${safeSearch}%,filename.ilike.%${safeSearch}%`);
  }

  const { data, error } = await query;
  if (error) throw error;

  return (data || [])
    .map((row) => normalizeAdminBadgeRow(row))
    .filter(Boolean);
};

function AdminBetailMaker({ onExitAdmin }) {
  const { user } = useAuth();
  const [currentStep, setCurrentStep] = useState(0);
  const [prenom, setPrenom] = useState('');
  const [age, setAge] = useState(1);
  const [ageInputValue, setAgeInputValue] = useState('1');
  const [isEditingAge, setIsEditingAge] = useState(false);
  const [photoUrl, setPhotoUrl] = useState('');
  const [photoFilePreview, setPhotoFilePreview] = useState('');
  const [photoSource, setPhotoSource] = useState('file');
  const [photoZoom, setPhotoZoom] = useState(1);
  const [photoPosition, setPhotoPosition] = useState({ x: 0, y: 0 });
  const [isDraggingPhoto, setIsDraggingPhoto] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [dragOrigin, setDragOrigin] = useState({ x: 0, y: 0 });
  const [isDragActive, setIsDragActive] = useState(false);
  const [imageNaturalSize, setImageNaturalSize] = useState({ width: 0, height: 0 });
  const [matriculeMode, setMatriculeMode] = useState('auto');
  const [matricule, setMatricule] = useState('');
  const [matriculeStatus, setMatriculeStatus] = useState('idle');
  const [displayedDigits, setDisplayedDigits] = useState(['0', '0', '0', '0', '0']);
  const [arrivedDigits, setArrivedDigits] = useState([false, false, false, false, false]);
  const [digitArrivalCount, setDigitArrivalCount] = useState([0, 0, 0, 0, 0]);
  const [digitGlowColors, setDigitGlowColors] = useState(['#ff6b6b', '#ff6b6b', '#ff6b6b', '#ff6b6b', '#ff6b6b']);
  const [isMatriculeAnimating, setIsMatriculeAnimating] = useState(false);
  const [customMatricule, setCustomMatricule] = useState('');
  const [customMatriculeStatus, setCustomMatriculeStatus] = useState('idle');
  const [customMatriculeMessage, setCustomMatriculeMessage] = useState('');
  const [isPremium, setIsPremium] = useState(false);
  const [commentaire, setCommentaire] = useState('');
  const [selectedBadges, setSelectedBadges] = useState([]);
  const [badgeSearchInput, setBadgeSearchInput] = useState('');
  const [adminBadgeRows, setAdminBadgeRows] = useState([]);
  const [adminBadgeKnownRows, setAdminBadgeKnownRows] = useState([]);
  const [adminBadgeOffset, setAdminBadgeOffset] = useState(0);
  const [adminBadgeHasMore, setAdminBadgeHasMore] = useState(true);
  const [adminBadgeLoading, setAdminBadgeLoading] = useState(false);
  const [adminBadgeLoadingMore, setAdminBadgeLoadingMore] = useState(false);
  const [adminBadgeError, setAdminBadgeError] = useState('');
  const [authorLabel, setAuthorLabel] = useState(() => getFallbackAuthorLabel(user));
  const [isTemplatePickerOpen, setIsTemplatePickerOpen] = useState(false);
  const [activeTemplateId, setActiveTemplateId] = useState('');
  const [betailVisible, setBetailVisible] = useState(true);
  const [invisibleReason, setInvisibleReason] = useState(null);
  const [invisibleAt, setInvisibleAt] = useState(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [successMatricule, setSuccessMatricule] = useState('');

  const previewSize = 220;
  const totalSteps = 8;
  const defaultPhotoZoom = 1.15;
  const defaultPhotoOffset = { x: 0, y: 12 };
  const adminBadgeMap = new Map((adminBadgeKnownRows || []).map((badge) => [badge.id, badge]));
  const selectedBadgeItems = selectedBadges
    .map((badgeId) => adminBadgeMap.get(badgeId))
    .filter(Boolean);
  const animationTimersRef = useRef({ intervals: [], timeouts: [] });
  const digitSounds = [digitSound1, digitSound2, digitSound3, digitSound4, digitSound5];
  const digitAudiosRef = useRef([]);
  const lastAgeRef = useRef(age);
  const adminBadgeRequestRef = useRef(0);
  const adminBadgeSearchDebounceRef = useRef(null);
  const adminBadgeOffsetRef = useRef(0);
  const adminBadgeHasMoreRef = useRef(true);
  const adminBadgeLoadingRef = useRef(false);

  const resetPhotoPlacement = () => {
    setPhotoZoom(1);
    setPhotoPosition({ x: 0, y: 0 });
    setIsDraggingPhoto(false);
    setDragStart({ x: 0, y: 0 });
    setDragOrigin({ x: 0, y: 0 });
    setIsDragActive(false);
    setImageNaturalSize({ width: 0, height: 0 });
  };

  const clearAnimationTimers = () => {
    animationTimersRef.current.intervals.forEach(clearInterval);
    animationTimersRef.current.timeouts.forEach(clearTimeout);
    animationTimersRef.current.intervals = [];
    animationTimersRef.current.timeouts = [];
  };

  const playAgeTick = () => {
    try {
      const audio = createSafeAudio(ageTickSound, { volume: 0.6 });
      void playAudioSafely(audio);
    } catch {
      // ignore audio play errors
    }
  };

  const playDigitSound = (index) => {
    const src = digitSounds[index];
    if (!src) return;
    try {
      const audio = createSafeAudio(src, { volume: 0.8 });
      void playAudioSafely(audio);
      digitAudiosRef.current.push(audio);
    } catch {
      // ignore audio play errors
    }
  };

  const applyAdminAge = (nextValue, options = {}) => {
    const { playSound = false } = options;
    const parsed = Number(nextValue);
    const normalizedAge = Number.isFinite(parsed)
      ? Math.max(1, Math.min(9999, Math.trunc(parsed)))
      : 1;

    setAge(normalizedAge);
    setAgeInputValue(String(normalizedAge));

    if (playSound && normalizedAge !== lastAgeRef.current) {
      playAgeTick();
    }
    lastAgeRef.current = normalizedAge;
    return normalizedAge;
  };

  const resetAdminMaker = () => {
    clearAnimationTimers();
    setCurrentStep(0);
    setPrenom('');
    setAge(1);
    setAgeInputValue('1');
    setIsEditingAge(false);
    setPhotoUrl('');
    setPhotoFilePreview('');
    setPhotoSource('file');
    resetPhotoPlacement();
    setMatriculeMode('auto');
    setMatricule('');
    setMatriculeStatus('idle');
    setDisplayedDigits(emptyDigitState);
    setArrivedDigits(emptyArrivalState);
    setDigitArrivalCount(emptyArrivalCountState);
    setDigitGlowColors(defaultGlowState);
    setIsMatriculeAnimating(false);
    setCustomMatricule('');
    setCustomMatriculeStatus('idle');
    setCustomMatriculeMessage('');
    setIsPremium(false);
    setCommentaire('');
    setSelectedBadges([]);
    setBadgeSearchInput('');
    setAdminBadgeRows([]);
    setAdminBadgeKnownRows([]);
    setAdminBadgeOffset(0);
    setAdminBadgeHasMore(true);
    setAdminBadgeLoading(false);
    setAdminBadgeLoadingMore(false);
    setAdminBadgeError('');
    setAuthorLabel(getFallbackAuthorLabel(user));
    setIsTemplatePickerOpen(false);
    setActiveTemplateId('');
    setBetailVisible(true);
    setInvisibleReason(null);
    setInvisibleAt(null);
    setIsSaving(false);
    setSaveError('');
    setSuccessMatricule('');
    lastAgeRef.current = 1;
    digitAudiosRef.current.forEach((audio) => {
      try {
        audio.pause();
        audio.currentTime = 0;
      } catch {
        // ignore audio stop errors
      }
    });
    digitAudiosRef.current = [];
    adminBadgeRequestRef.current += 1;
    adminBadgeOffsetRef.current = 0;
    adminBadgeHasMoreRef.current = true;
    adminBadgeLoadingRef.current = false;
    if (adminBadgeSearchDebounceRef.current) {
      clearTimeout(adminBadgeSearchDebounceRef.current);
      adminBadgeSearchDebounceRef.current = null;
    }
  };

  const getBaseScale = () => {
    if (!imageNaturalSize.width || !imageNaturalSize.height) {
      return 1;
    }
    return Math.max(
      previewSize / imageNaturalSize.width,
      previewSize / imageNaturalSize.height,
    );
  };

  const clampPhotoPosition = (position, zoom) => {
    if (!imageNaturalSize.width || !imageNaturalSize.height) {
      return { x: 0, y: 0 };
    }
    const baseScale = getBaseScale();
    const scaledWidth = imageNaturalSize.width * baseScale * zoom;
    const scaledHeight = imageNaturalSize.height * baseScale * zoom;
    const maxOffsetX = Math.max(0, (scaledWidth - previewSize) * 0.5);
    const maxOffsetY = Math.max(0, (scaledHeight - previewSize) * 0.5);
    return {
      x: Math.max(-maxOffsetX, Math.min(maxOffsetX, position.x)),
      y: Math.max(-maxOffsetY, Math.min(maxOffsetY, position.y)),
    };
  };

  const handlePhotoFileChange = (event) => {
    const file = event.target.files?.[0];
    if (!file) {
      setPhotoFilePreview('');
      return;
    }
    setPhotoSource('file');
    resetPhotoPlacement();
    const reader = new FileReader();
    reader.onloadend = () => {
      setPhotoFilePreview(reader.result?.toString() || '');
    };
    reader.readAsDataURL(file);
  };

  const handlePhotoUrlChange = (value) => {
    setPhotoSource('url');
    setPhotoUrl(value);
    resetPhotoPlacement();
  };

  const handleUseDefaultPhoto = () => {
    setPhotoSource('file');
    setPhotoUrl('');
    setPhotoFilePreview(defaultProfileImage);
    setPhotoZoom(defaultPhotoZoom);
    setPhotoPosition(defaultPhotoOffset);
    setImageNaturalSize({ width: 0, height: 0 });
  };

  const handleRemovePhoto = () => {
    setPhotoFilePreview('');
    setPhotoUrl('');
    resetPhotoPlacement();
  };

  const handlePhotoDrop = (event) => {
    event.preventDefault();
    setIsDragActive(false);
    const file = event.dataTransfer?.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onloadend = () => {
      setPhotoSource('file');
      setPhotoFilePreview(reader.result?.toString() || '');
      resetPhotoPlacement();
    };
    reader.readAsDataURL(file);
  };

  const handlePhotoDragOver = (event) => {
    event.preventDefault();
    setIsDragActive(true);
  };

  const handlePhotoDragLeave = () => {
    setIsDragActive(false);
  };

  const handlePhotoPointerDown = (event) => {
    if (!(photoFilePreview || photoUrl)) {
      return;
    }
    event.preventDefault();
    setIsDraggingPhoto(true);
    setDragStart({ x: event.clientX, y: event.clientY });
    setDragOrigin({ x: photoPosition.x, y: photoPosition.y });
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };

  const handlePhotoPointerMove = (event) => {
    if (!isDraggingPhoto) {
      return;
    }
    const dx = event.clientX - dragStart.x;
    const dy = event.clientY - dragStart.y;
    const nextPosition = { x: dragOrigin.x + dx, y: dragOrigin.y + dy };
    setPhotoPosition(clampPhotoPosition(nextPosition, photoZoom));
  };

  const handlePhotoPointerUp = (event) => {
    if (!isDraggingPhoto) {
      return;
    }
    setIsDraggingPhoto(false);
    event.currentTarget.releasePointerCapture?.(event.pointerId);
  };

  const getActiveImageSource = () => {
    if (photoSource === 'url') {
      return photoUrl.trim();
    }
    return photoFilePreview || defaultProfileImage;
  };

  const loadNaturalImageSize = async (source) => {
    if (!source) {
      return { width: 0, height: 0 };
    }

    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.src = source;

    try {
      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = reject;
      });
      return { width: img.naturalWidth || 0, height: img.naturalHeight || 0 };
    } catch {
      return { width: 0, height: 0 };
    }
  };

  const createCroppedAvatarBlob = async (overrideSource = '') => {
    const source = overrideSource || getActiveImageSource();
    if (!source) return null;

    const outputSize = 512;
    const loadImage = async (src) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.src = src;
      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = reject;
      });
      return img;
    };

    let img;
    try {
      img = await loadImage(source);
    } catch {
      if (source !== defaultProfileImage) {
        try {
          img = await loadImage(defaultProfileImage);
        } catch {
          return null;
        }
      } else {
        return null;
      }
    }

    const canvas = document.createElement('canvas');
    canvas.width = outputSize;
    canvas.height = outputSize;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    ctx.clearRect(0, 0, outputSize, outputSize);
    ctx.save();
    ctx.beginPath();
    ctx.arc(outputSize / 2, outputSize / 2, outputSize / 2, 0, Math.PI * 2);
    ctx.closePath();
    ctx.clip();

    const baseScale = Math.max(
      previewSize / img.naturalWidth,
      previewSize / img.naturalHeight,
    );
    const scaleFactor = outputSize / previewSize;
    const isDefault = (!photoFilePreview && !photoUrl) || photoFilePreview === defaultProfileImage;
    const position = isDefault ? defaultPhotoOffset : photoPosition;
    const zoom = isDefault ? defaultPhotoZoom : photoZoom;

    ctx.translate(
      outputSize / 2 + position.x * scaleFactor,
      outputSize / 2 + position.y * scaleFactor,
    );
    ctx.scale(baseScale * zoom * scaleFactor, baseScale * zoom * scaleFactor);
    ctx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2);
    ctx.restore();

    return new Promise((resolve) => {
      canvas.toBlob((blob) => resolve(blob), 'image/png');
    });
  };

  const uploadCroppedAvatar = async () => {
    let overrideSource = '';
    if (photoSource === 'url' && photoUrl.trim()) {
      const { data, error } = await supabase.functions.invoke('fetch-image', {
        body: { imageUrl: photoUrl.trim() },
      });
      if (error || !data?.dataUrl) {
        return null;
      }
      overrideSource = data.dataUrl;
    }

    const blob = await createCroppedAvatarBlob(overrideSource);
    if (!blob || !user?.id) return null;
    const filePath = `${Date.now()}-${user.id}-betail-admin.png`;
    const { error } = await supabase.storage
      .from('betails')
      .upload(filePath, blob, {
        cacheControl: '3600',
        upsert: true,
        contentType: 'image/png',
      });

    if (error) {
      return null;
    }

    const { data } = supabase.storage.from('betails').getPublicUrl(filePath);
    return data?.publicUrl || null;
  };

  const applyTemplate = async (templateId) => {
    const template = ADMIN_TEMPLATE_OPTIONS.find((item) => item.id === templateId);
    if (!template) {
      return;
    }

    setSaveError('');
    setIsSaving(false);
    const generated = await generateUniqueMatricule();
    if (!generated) {
      setSaveError("Impossible de générer un matricule admin unique.");
      return;
    }

    clearAnimationTimers();
    const author = authorLabel || getFallbackAuthorLabel(user);
    const nextInvisibleAt = template.includeInvisibleAt ? new Date().toISOString() : null;
    const naturalSize = await loadNaturalImageSize(template.image);

    setCurrentStep(8);
    setActiveTemplateId(template.id);
    setPrenom(template.name);
    applyAdminAge(template.age);
    setPhotoSource('file');
    setPhotoUrl('');
    setPhotoFilePreview(template.image);
    setPhotoZoom(template.photoZoom || templatePhotoZoom);
    setPhotoPosition(templatePhotoOffset);
    setImageNaturalSize(naturalSize);
    setIsDraggingPhoto(false);
    setIsDragActive(false);
    setMatriculeMode('auto');
    setMatricule(generated);
    setMatriculeStatus('done');
    setDisplayedDigits(generated.split(''));
    setArrivedDigits([true, true, true, true, true]);
    setDigitArrivalCount([1, 1, 1, 1, 1]);
    setDigitGlowColors(generated.split('').map((_, index) => glowPalette[index % glowPalette.length]));
    setIsMatriculeAnimating(false);
    setCustomMatricule('');
    setCustomMatriculeStatus('idle');
    setCustomMatriculeMessage('');
    setIsPremium(template.isPremium);
    setSelectedBadges([]);
    setCommentaire(
      buildTemplateComment({
        commentPrefix: template.commentPrefix,
        author,
        visible: template.visible,
      }),
    );
    setBetailVisible(template.visible);
    setInvisibleReason(template.invisibleReason);
    setInvisibleAt(nextInvisibleAt);
    setSuccessMatricule('');
    setIsTemplatePickerOpen(false);
  };

  const isMatriculeUnique = async (value) => {
    const { data, error } = await supabase
      .from('betails')
      .select('id')
      .eq('matricule', value)
      .limit(1);
    if (error) {
      return false;
    }
    return !data || data.length === 0;
  };

  const generateMatricule = () => {
    return String(10000 + Math.floor(Math.random() * 90000));
  };

  const generateUniqueMatricule = async (attempts = 12) => {
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const candidate = generateMatricule();
      // eslint-disable-next-line no-await-in-loop
      const unique = await isMatriculeUnique(candidate);
      if (unique) {
        return candidate;
      }
    }
    return null;
  };

  const handleGenerateMatricule = async () => {
    setMatriculeMode('auto');
    setMatriculeStatus('generating');
    setCustomMatriculeStatus('idle');
    setCustomMatriculeMessage('');
    const generated = await generateUniqueMatricule();
    if (!generated) {
      setMatriculeStatus('idle');
      setSaveError("Impossible de générer un matricule admin unique.");
      return;
    }
    setSaveError('');
    setMatricule(generated);
    clearAnimationTimers();
    digitAudiosRef.current.forEach((audio) => {
      try {
        audio.pause();
        audio.currentTime = 0;
      } catch {
        // ignore audio stop errors
      }
    });
    digitAudiosRef.current = [];
    setIsMatriculeAnimating(true);
    setDisplayedDigits(emptyDigitState);
    setArrivedDigits(emptyArrivalState);
    setDigitArrivalCount(emptyArrivalCountState);
    setDigitGlowColors(defaultGlowState);

    generated.split('').forEach((digit, index) => {
      const startDelay = index * 900;
      const startTimeout = setTimeout(() => {
        const interval = setInterval(() => {
          setDisplayedDigits((prev) => {
            const next = [...prev];
            next[index] = Math.floor(Math.random() * 10).toString();
            return next;
          });
        }, 60);
        animationTimersRef.current.intervals.push(interval);

        const stopTimeout = setTimeout(() => {
          clearInterval(interval);
          setDisplayedDigits((prev) => {
            const next = [...prev];
            next[index] = digit;
            return next;
          });
          setArrivedDigits((prev) => {
            const next = [...prev];
            next[index] = true;
            return next;
          });
          setDigitGlowColors((prev) => {
            const next = [...prev];
            let nextColor = glowPalette[Math.floor(Math.random() * glowPalette.length)];
            const previousNeighbor = index > 0 ? next[index - 1] : null;
            let guard = 0;
            while (previousNeighbor && nextColor === previousNeighbor && guard < 10) {
              nextColor = glowPalette[Math.floor(Math.random() * glowPalette.length)];
              guard += 1;
            }
            next[index] = nextColor;
            return next;
          });
          setDigitArrivalCount((prev) => {
            const next = [...prev];
            next[index] += 1;
            return next;
          });
          playDigitSound(index);
          if (index === 4) {
            setIsMatriculeAnimating(false);
            setMatriculeStatus('done');
          }
        }, 800);
        animationTimersRef.current.timeouts.push(stopTimeout);
      }, startDelay);
      animationTimersRef.current.timeouts.push(startTimeout);
    });
  };

  const handleCustomMatriculeChange = (value) => {
    const sanitized = sanitizeMatriculeInput(value).slice(0, 5);
    setCustomMatricule(sanitized);
    setMatricule(sanitized);
    setCustomMatriculeStatus('idle');
    setCustomMatriculeMessage('');
    setSaveError('');
    setDisplayedDigits(sanitized.padEnd(5, '0').slice(0, 5).split(''));
    setArrivedDigits(sanitized.length === 5 ? [true, true, true, true, true] : [false, false, false, false, false]);
    setDigitArrivalCount(sanitized.length === 5 ? [1, 1, 1, 1, 1] : [0, 0, 0, 0, 0]);
    setDigitGlowColors(['#ff6b6b', '#ff6b6b', '#ff6b6b', '#ff6b6b', '#ff6b6b']);
    setIsMatriculeAnimating(false);
  };

  const handleVerifyCustomMatricule = async () => {
    const sanitized = sanitizeMatriculeInput(customMatricule).slice(0, 5);
    setCustomMatricule(sanitized);
    setMatricule(sanitized);

    if (sanitized.length !== 5) {
      setCustomMatriculeStatus('invalid');
      setCustomMatriculeMessage('Le matricule doit contenir exactement 5 chiffres.');
      return;
    }

    setCustomMatriculeStatus('checking');
    const unique = await isMatriculeUnique(sanitized);
    if (!unique) {
      setCustomMatriculeStatus('invalid');
      setCustomMatriculeMessage('Ce matricule existe deja en base.');
      return;
    }

    setCustomMatriculeStatus('valid');
    setCustomMatriculeMessage('Matricule disponible et valide.');
  };

  const skipMatriculeAnimation = () => {
    clearAnimationTimers();
    digitAudiosRef.current.forEach((audio) => {
      try {
        audio.pause();
        audio.currentTime = 0;
      } catch {
        // ignore audio stop errors
      }
    });
    digitAudiosRef.current = [];
    if (!matricule) return;
    const digits = matricule.split('');
    setDisplayedDigits(digits);
    setArrivedDigits([true, true, true, true, true]);
    setDigitGlowColors([
      ...digits.map((_, index) => glowPalette[index % glowPalette.length]),
    ]);
    setDigitArrivalCount([1, 1, 1, 1, 1]);
    setIsMatriculeAnimating(false);
    setMatriculeStatus('done');
  };

  const loadAdminBadges = useCallback(async ({ reset = false, search = '' } = {}) => {
    if (!reset && (!adminBadgeHasMoreRef.current || adminBadgeLoadingRef.current)) {
      return;
    }

    const trimmedSearch = String(search || '').trim();
    const offset = reset ? 0 : adminBadgeOffsetRef.current;
    const requestId = adminBadgeRequestRef.current + 1;
    adminBadgeRequestRef.current = requestId;
    adminBadgeLoadingRef.current = true;
    if (reset) {
      setAdminBadgeLoading(true);
    } else {
      setAdminBadgeLoadingMore(true);
    }
    setAdminBadgeError('');

    try {
      const rows = await fetchAdminBadgeCatalogPage({
        search: trimmedSearch,
        offset,
        limit: ADMIN_BADGES_PAGE_SIZE,
      });

      if (requestId !== adminBadgeRequestRef.current) {
        return;
      }

      const nextOffset = offset + rows.length;
      const hasMore = rows.length === ADMIN_BADGES_PAGE_SIZE;

      setAdminBadgeRows((current) => (reset ? rows : mergeUniqueBadgesById([...current, ...rows])));
      setAdminBadgeKnownRows((current) => mergeUniqueBadgesById([...current, ...rows]));
      setAdminBadgeOffset(nextOffset);
      setAdminBadgeHasMore(hasMore);

      adminBadgeOffsetRef.current = nextOffset;
      adminBadgeHasMoreRef.current = hasMore;
    } catch {
      if (requestId !== adminBadgeRequestRef.current) {
        return;
      }
      if (reset) {
        setAdminBadgeRows([]);
        setAdminBadgeOffset(0);
        setAdminBadgeHasMore(false);
        adminBadgeOffsetRef.current = 0;
        adminBadgeHasMoreRef.current = false;
      }
      setAdminBadgeError('Impossible de charger les badges. Reessaie.');
    } finally {
      if (requestId === adminBadgeRequestRef.current) {
        adminBadgeLoadingRef.current = false;
        setAdminBadgeLoading(false);
        setAdminBadgeLoadingMore(false);
      }
    }
  }, []);

  const handleToggleBadge = (badgeId) => {
    setSaveError('');
    setSelectedBadges((current) => {
      if (current.includes(badgeId)) {
        return current.filter((id) => id !== badgeId);
      }
      if (current.length >= 3) {
        return current;
      }
      return [...current, badgeId];
    });
  };

  const handleGoBack = () => {
    if (currentStep <= 0) {
      onExitAdmin?.();
      return;
    }
    if (currentStep === 9) {
      setCurrentStep(8);
      return;
    }
    setCurrentStep((prev) => Math.max(0, prev - 1));
  };

  const handleLoadMoreAdminBadges = () => {
    loadAdminBadges({
      reset: false,
      search: badgeSearchInput,
    });
  };

  useEffect(() => {
    adminBadgeOffsetRef.current = adminBadgeOffset;
  }, [adminBadgeOffset]);

  useEffect(() => {
    adminBadgeHasMoreRef.current = adminBadgeHasMore;
  }, [adminBadgeHasMore]);

  useEffect(() => {
    if (currentStep !== 6) {
      return undefined;
    }
    if (adminBadgeSearchDebounceRef.current) {
      clearTimeout(adminBadgeSearchDebounceRef.current);
    }
    adminBadgeSearchDebounceRef.current = setTimeout(() => {
      loadAdminBadges({
        reset: true,
        search: badgeSearchInput,
      });
    }, 260);

    return () => {
      if (adminBadgeSearchDebounceRef.current) {
        clearTimeout(adminBadgeSearchDebounceRef.current);
        adminBadgeSearchDebounceRef.current = null;
      }
    };
  }, [badgeSearchInput, currentStep, loadAdminBadges]);

  useEffect(() => {
    if (currentStep !== 4) {
      clearAnimationTimers();
      setIsMatriculeAnimating(false);
      if (matriculeMode === 'auto') {
        setMatriculeStatus((prev) => (prev === 'done' ? 'done' : 'idle'));
      }
    }
    return () => {
      clearAnimationTimers();
    };
  }, [currentStep, matriculeMode]);

  useEffect(() => {
    return () => {
      adminBadgeRequestRef.current += 1;
      adminBadgeLoadingRef.current = false;
      if (adminBadgeSearchDebounceRef.current) {
        clearTimeout(adminBadgeSearchDebounceRef.current);
        adminBadgeSearchDebounceRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    setAgeInputValue(String(age));
  }, [age]);

  useEffect(() => {
    let isMounted = true;
    const fallbackAuthor = getFallbackAuthorLabel(user);
    setAuthorLabel(fallbackAuthor);

    const loadAuthorLabel = async () => {
      if (!user?.id) {
        return;
      }

      const { data, error } = await supabase
        .from('users_profiles')
        .select('username, email')
        .eq('id', user.id)
        .maybeSingle();

      if (!isMounted || error) {
        return;
      }

      const username = String(data?.username || '').trim();
      const email = String(data?.email || '').trim();
      setAuthorLabel(username || (email.includes('@') ? email.split('@')[0] : email) || fallbackAuthor);
    };

    loadAuthorLabel();

    return () => {
      isMounted = false;
    };
  }, [user]);

  const handleSaveBetail = async () => {
    if (!user?.id) {
      setSaveError('Utilisateur non connecte.');
      return;
    }

    if (!prenom.trim()) {
      setSaveError('Le prenom est requis.');
      return;
    }

    if (!Number.isFinite(Number(age)) || Number(age) < 1) {
      setSaveError("L'age doit etre superieur ou egal a 1.");
      return;
    }

    if (!matricule || sanitizeMatriculeInput(matricule).length !== 5) {
      setSaveError('Le matricule admin doit contenir exactement 5 chiffres.');
      return;
    }

    if (matriculeMode === 'manual' && customMatriculeStatus !== 'valid') {
      setSaveError('Verifie le matricule personnalise avant de valider.');
      return;
    }

    setIsSaving(true);
    setSaveError('');

    let avatarUrl = null;
    try {
      avatarUrl = await uploadCroppedAvatar();
    } catch {
      avatarUrl = null;
    }

    if (!avatarUrl) {
      setSaveError("Impossible d'enregistrer l'image.");
      setIsSaving(false);
      return;
    }

    let finalMatricule = sanitizeMatriculeInput(matricule);

    if (matriculeMode === 'manual') {
      const unique = await isMatriculeUnique(finalMatricule);
      if (!unique) {
        setCustomMatriculeStatus('invalid');
        setCustomMatriculeMessage('Ce matricule n’est plus disponible. Verifie-en un autre.');
        setSaveError('Le matricule personnalise n’est plus disponible.');
        setIsSaving(false);
        return;
      }
    } else {
      const unique = await isMatriculeUnique(finalMatricule);
      if (!unique) {
        const regenerated = await generateUniqueMatricule();
        if (!regenerated) {
          setSaveError("Impossible de générer un matricule admin unique.");
          setIsSaving(false);
          return;
        }
        finalMatricule = regenerated;
        setMatricule(regenerated);
        setMatriculeStatus('done');
      }
    }

    const createAdminBetail = (matriculeValue, includeRewardBadges = true) => {
      const payload = {
        p_name: prenom.trim(),
        p_age: Number(age),
        p_avatar_url: avatarUrl,
        p_matricule: matriculeValue,
        p_premium: isPremium,
        p_comments: commentaire?.trim() || null,
        p_visible: betailVisible,
        p_invisible_reason: betailVisible ? null : invisibleReason,
        p_invisible_at: betailVisible ? null : invisibleAt,
      };
      if (includeRewardBadges) {
        payload.p_reward_badge_ids = selectedBadges;
      }
      return supabase.rpc('create_admin_betail_reborn', payload);
    };

    let usedLegacySignature = false;
    let { data, error } = await createAdminBetail(finalMatricule, true);
    if (error) {
      const rawMessage = String(error?.message || '').toLowerCase();
      const rawDetails = String(error?.details || '').toLowerCase();
      const isMissingFunctionOrSignature = error?.status === 404
        || rawMessage.includes('create_admin_betail_reborn')
        || rawMessage.includes('schema cache')
        || rawDetails.includes('schema cache')
        || String(error?.code || '').toUpperCase().startsWith('PGRST');

      if (isMissingFunctionOrSignature) {
        const legacyAttempt = await createAdminBetail(finalMatricule, false);
        if (!legacyAttempt.error) {
          data = legacyAttempt.data;
          error = null;
          usedLegacySignature = true;
        }
      }
    }

    if (!error && data?.reason === 'DUPLICATE_MATRICULE' && matriculeMode === 'auto') {
      const regenerated = await generateUniqueMatricule();
      if (regenerated) {
        finalMatricule = regenerated;
        setMatricule(regenerated);
        const retry = await createAdminBetail(regenerated, !usedLegacySignature);
        data = retry.data;
        error = retry.error;
      }
    }

    if (error) {
      const errorMessage = String(error?.message || '').toLowerCase();
      if (error?.status === 404 || error?.code === '42883' || errorMessage.includes('create_admin_betail_reborn')) {
        setSaveError("Fonction SQL admin absente. Execute supabase/create_admin_betail_reborn.sql puis recharge la page.");
      } else {
        setSaveError("Erreur lors de l'enregistrement admin.");
      }
      setIsSaving(false);
      return;
    }

    if (!data?.success) {
      const reason = String(data?.reason || 'UNKNOWN');
      if (reason === 'NOT_AUTHENTICATED') {
        setSaveError('Utilisateur non connecte.');
      } else if (reason === 'PROFILE_NOT_FOUND') {
        setSaveError('Profil utilisateur introuvable.');
      } else if (reason === 'NOT_ADMIN') {
        setSaveError('Acces reserve aux administrateurs.');
      } else if (reason === 'INVALID_MATRICULE_FORMAT') {
        setSaveError('Le matricule admin doit contenir uniquement des chiffres et exactement 5 chiffres.');
      } else if (reason === 'DUPLICATE_MATRICULE') {
        setSaveError('Ce matricule existe deja.');
      } else if (reason === 'INVALID_REWARD_BADGES') {
        setSaveError('Un ou plusieurs badges selectionnes ne sont plus valides.');
      } else if (reason === 'TOO_MANY_REWARD_BADGES') {
        setSaveError('Maximum 3 badges cadeaux par betail.');
      } else {
        setSaveError("Erreur lors de l'enregistrement admin.");
      }
      setIsSaving(false);
      return;
    }

    setSuccessMatricule(finalMatricule);
    setIsSaving(false);
    setCurrentStep(9);
  };

  const renderStepContent = () => {
    switch (currentStep) {
      case 0:
        if (isTemplatePickerOpen) {
          return (
            <div className="step-content fade-in admin-template-stage">
              <div className="admin-maker-hero">
                <div className="admin-maker-hero__badge">
                  <Sparkles size={18} />
                  Templates admin
                </div>
                <h1 className="step-title">Choisir un template</h1>
                <p className="quality-subtitle admin-maker-hero__text">
                  Sélectionne l&apos;un des 3 modèles pour préremplir le bétail admin puis arriver directement au récapitulatif.
                </p>
              </div>

              <div className="admin-template-grid">
                {ADMIN_TEMPLATE_OPTIONS.map((template) => (
                  <button
                    key={template.id}
                    type="button"
                    className={`admin-template-card ${activeTemplateId === template.id ? 'is-active' : ''}`}
                    onClick={() => applyTemplate(template.id)}
                    >
                      <span className="admin-template-card__preview">
                        <img
                          src={template.image}
                          alt={template.name}
                          style={{ transform: `scale(${template.previewScale || 1.1})` }}
                        />
                      </span>
                    <span className="admin-template-card__body">
                      <strong>{template.name}</strong>
                      <span className="admin-template-card__meta">{template.age} ans · {template.isPremium ? 'Premium' : 'Standard'}</span>
                      <span className="admin-template-card__status">{template.visible ? 'Visible' : 'Invisible'} à la création</span>
                    </span>
                  </button>
                ))}
              </div>

              <div className="maker-entry-actions maker-entry-actions--admin">
                <button
                  type="button"
                  className="photo-action"
                  onClick={() => setIsTemplatePickerOpen(false)}
                >
                  <ArrowLeft size={16} />
                  Retour au choix
                </button>
                <button type="button" className="photo-action ghost admin-maker-exit" onClick={onExitAdmin}>
                  Retour standard
                </button>
              </div>
            </div>
          );
        }
        return (
          <div className="step-content fade-in">
            <div className="admin-maker-hero">
              <div className="admin-maker-hero__badge">
                <ShieldCheck size={18} />
                Mode administration
              </div>
              <h1 className="step-title">Créer un bétail admin</h1>
              <p className="quality-subtitle admin-maker-hero__text">
                Version libre du maker: pas de gain d&apos;argent, pas de mini-jeux qualite, matricule manuel possible et section badges en apercu UI.
              </p>
            </div>
            <div className="maker-entry-actions maker-entry-actions--admin">
              <button
                type="button"
                className="create-button create-button--admin"
                onClick={() => {
                  setActiveTemplateId('');
                  setIsTemplatePickerOpen(false);
                  setBetailVisible(true);
                  setInvisibleReason(null);
                  setInvisibleAt(null);
                  setCurrentStep(1);
                }}
              >
                <ShieldCheck size={18} />
                Ouvrir le maker admin
              </button>
              <button
                type="button"
                className="photo-action admin-template-toggle"
                onClick={() => setIsTemplatePickerOpen(true)}
              >
                <Sparkles size={17} />
                Choisir un template
              </button>
              <button type="button" className="photo-action ghost admin-maker-exit" onClick={onExitAdmin}>
                <ArrowLeft size={16} />
                Retour standard
              </button>
            </div>
            {isTemplatePickerOpen ? (
              <div className="admin-template-panel">
                <div className="admin-template-panel__head">
                  <strong>Templates rapides</strong>
                  <span>Un clic préremplit le bétail admin puis ouvre directement le récapitulatif.</span>
                </div>
                <div className="admin-template-grid">
                  {ADMIN_TEMPLATE_OPTIONS.map((template) => (
                    <button
                      key={template.id}
                      type="button"
                      className={`admin-template-card ${activeTemplateId === template.id ? 'is-active' : ''}`}
                      onClick={() => applyTemplate(template.id)}
                    >
                      <span className="admin-template-card__preview">
                        <img
                          src={template.image}
                          alt={template.name}
                          style={{ transform: `scale(${template.previewScale || 1.1})` }}
                        />
                      </span>
                      <span className="admin-template-card__body">
                        <strong>{template.name}</strong>
                        <span className="admin-template-card__meta">{template.age} ans · {template.isPremium ? 'Premium' : 'Standard'}</span>
                        <span className="admin-template-card__status">{template.visible ? 'Visible' : 'Invisible'} à la création</span>
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        );

      case 1:
        return (
          <div className="step-content fade-in">
            <h2 className="step-title">Quel est le prénom ?</h2>
            <p className="quality-subtitle">Aucune limite speciale ici, tant que le nom n&apos;est pas vide.</p>
            <input
              type="text"
              className="step-input"
              placeholder="Entrez le prenom..."
              value={prenom}
              onChange={(event) => setPrenom(event.target.value)}
              autoFocus
              onKeyDown={(event) => {
                if (event.key === 'Enter' && prenom.trim()) {
                  setCurrentStep(2);
                }
              }}
            />
            <button className="next-button" type="button" onClick={() => setCurrentStep(2)} disabled={!prenom.trim()}>
              Suivant
              <span className="arrow">→</span>
            </button>
          </div>
        );

      case 2:
        return (
          <div className="step-content fade-in">
            <h2 className="step-title">Quel est son âge ?</h2>
            <div className="age-selector admin-age-selector">
              <div className="age-display admin-age-display">
                {isEditingAge ? (
                  <input
                    type="number"
                    min={1}
                    max={9999}
                    className="admin-age-inline-input"
                    value={ageInputValue}
                    autoFocus
                    onChange={(event) => setAgeInputValue(sanitizeMatriculeInput(event.target.value).slice(0, 4) || '')}
                    onBlur={() => {
                      applyAdminAge(ageInputValue);
                      setIsEditingAge(false);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        applyAdminAge(ageInputValue);
                        setIsEditingAge(false);
                      }
                      if (event.key === 'Escape') {
                        setAgeInputValue(String(age));
                        setIsEditingAge(false);
                      }
                    }}
                  />
                ) : (
                  <button
                    type="button"
                    className="admin-age-edit-trigger"
                    onClick={() => {
                      setAgeInputValue(String(age));
                      setIsEditingAge(true);
                    }}
                    title="Cliquer pour saisir l'âge"
                  >
                    <span className="age-number">{age}</span>
                  </button>
                )}
                <span className="age-label">an{age > 1 ? 's' : ''}</span>
              </div>
              <p className="admin-age-inline-hint">Clique sur le chiffre pour le modifier directement.</p>
              <div className="age-slider-container">
                <input
                  type="range"
                  min="1"
                  max="9999"
                  value={age}
                  onChange={(event) => applyAdminAge(event.target.value, { playSound: true })}
                  className="age-slider admin-age-slider"
                />
                <div className="age-markers admin-age-markers">
                  {[1, 18, 100, 1000, 9999].map((marker) => (
                    <span key={marker} className="age-marker">{marker}</span>
                  ))}
                </div>
              </div>
            </div>
            <button className="next-button" type="button" onClick={() => setCurrentStep(3)}>
              Suivant
              <span className="arrow">→</span>
            </button>
          </div>
        );

      case 3:
        return (
          <div className="step-content fade-in">
            <h2 className="step-title">Choisis une photo</h2>
            <p className="quality-subtitle">Même système que le maker normal, avec URL, upload ou image par défaut.</p>

            <div className="photo-choice">
              <div className="photo-input">
                <input
                  type="url"
                  className="step-input"
                  placeholder="Collez une URL d'image..."
                  value={photoUrl}
                  onChange={(event) => handlePhotoUrlChange(event.target.value)}
                />
              </div>
            </div>

            <div
              className="photo-preview"
              onPointerDown={photoFilePreview === defaultProfileImage ? undefined : handlePhotoPointerDown}
              onPointerMove={photoFilePreview === defaultProfileImage ? undefined : handlePhotoPointerMove}
              onPointerUp={photoFilePreview === defaultProfileImage ? undefined : handlePhotoPointerUp}
              onPointerLeave={photoFilePreview === defaultProfileImage ? undefined : handlePhotoPointerUp}
              onDragOver={handlePhotoDragOver}
              onDragLeave={handlePhotoDragLeave}
              onDrop={handlePhotoDrop}
            >
              {(photoSource === 'file' && photoFilePreview) || (photoSource === 'url' && photoUrl) ? (
                <img
                  src={photoSource === 'file' ? photoFilePreview : photoUrl}
                  alt="Aperçu"
                  className="photo-preview-image"
                  draggable={false}
                  onDragStart={(event) => event.preventDefault()}
                  onLoad={(event) => {
                    setImageNaturalSize({
                      width: event.currentTarget.naturalWidth,
                      height: event.currentTarget.naturalHeight,
                    });
                    if (photoFilePreview === defaultProfileImage) {
                      setPhotoPosition(defaultPhotoOffset);
                      setPhotoZoom(defaultPhotoZoom);
                    } else {
                      setPhotoPosition((prev) => clampPhotoPosition(prev, photoZoom));
                    }
                  }}
                  style={{
                    width: `${imageNaturalSize.width ? imageNaturalSize.width * getBaseScale() : previewSize}px`,
                    height: `${imageNaturalSize.height ? imageNaturalSize.height * getBaseScale() : previewSize}px`,
                    transform:
                      photoFilePreview === defaultProfileImage
                        ? `translate(-50%, -50%) translate(${defaultPhotoOffset.x}px, ${defaultPhotoOffset.y}px) scale(${defaultPhotoZoom})`
                        : `translate(-50%, -50%) translate(${photoPosition.x}px, ${photoPosition.y}px) scale(${photoZoom})`,
                  }}
                />
              ) : (
                <label className={`photo-preview-placeholder ${isDragActive ? 'active' : ''}`}>
                  <input
                    type="file"
                    accept="image/*"
                    className="file-input"
                    onChange={handlePhotoFileChange}
                  />
                  <span>Cliquer ou glisser une photo ici</span>
                </label>
              )}
            </div>

            {((photoSource === 'file' && photoFilePreview) || (photoSource === 'url' && photoUrl)) &&
              photoFilePreview !== defaultProfileImage ? (
                <div className="photo-controls">
                  <label className="photo-zoom-label">
                    Zoom
                    <input
                      type="range"
                      min="1"
                      max="2.5"
                      step="0.01"
                      value={photoZoom}
                      onChange={(event) => {
                        const nextZoom = Number(event.target.value);
                        setPhotoZoom(nextZoom);
                        setPhotoPosition((prev) => clampPhotoPosition(prev, nextZoom));
                      }}
                      className="photo-zoom-slider"
                    />
                  </label>
                  <p className="photo-hint">Fais glisser l&apos;image pour la positionner dans le cercle.</p>
                </div>
              ) : null}

            <div className="photo-actions">
              {photoFilePreview === defaultProfileImage ? (
                <label className="photo-action" style={{ cursor: 'pointer' }}>
                  Choisir une photo parmi la galerie
                  <input
                    type="file"
                    accept="image/*"
                    className="file-input"
                    style={{ display: 'none' }}
                    onChange={handlePhotoFileChange}
                  />
                </label>
              ) : (
                <button className="photo-action" type="button" onClick={handleUseDefaultPhoto}>
                  Utiliser la photo par défaut
                </button>
              )}
              {(photoFilePreview || photoUrl) && photoFilePreview !== defaultProfileImage ? (
                <button className="photo-action ghost" type="button" onClick={handleRemovePhoto}>
                  Supprimer la photo
                </button>
              ) : null}
            </div>

            <button
              className="next-button"
              type="button"
              onClick={() => setCurrentStep(4)}
              disabled={!photoFilePreview && !photoUrl.trim()}
            >
              Suivant
              <span className="arrow">→</span>
            </button>
          </div>
        );

      case 4:
        return (
          <div className="step-content fade-in">
            <h2 className="step-title">Définir le matricule</h2>
            <p className="quality-subtitle">Auto ou personnalisé, avec exactement 5 chiffres uniques.</p>

            <div className="admin-choice-grid">
              <button
                type="button"
                className={`admin-choice-card ${matriculeMode === 'auto' ? 'is-active' : ''}`}
                onClick={() => {
                  setMatriculeMode('auto');
                  setSaveError('');
                }}
              >
                <Dice5 size={20} />
                <strong>Auto</strong>
                <span>Le système génère un matricule admin unique.</span>
              </button>
              <button
                type="button"
                className={`admin-choice-card ${matriculeMode === 'manual' ? 'is-active' : ''}`}
                onClick={() => {
                  setMatriculeMode('manual');
                  setMatriculeStatus('idle');
                  setSaveError('');
                }}
              >
                <Fingerprint size={20} />
                <strong>Personnalisé</strong>
                <span>Choisis toi-même le matricule puis vérifie sa disponibilité.</span>
              </button>
            </div>

            {matriculeMode === 'auto' ? (
              <div className="matricule-card">
                <div className="matricule-icon" aria-hidden="true">
                  <Fingerprint size={40} color="#ff6b6b" />
                </div>
                <p className="matricule-label">Matricule admin automatique</p>
                <div className={`matricule-number ${isMatriculeAnimating ? 'animating' : ''}`}>
                  {displayedDigits.map((digit, index) => (
                    <span
                      key={`${digit}-${index}-${digitArrivalCount[index]}`}
                      className={`matricule-digit ${arrivedDigits[index] ? 'arriving' : ''}`}
                      style={{ '--glow-color': digitGlowColors[index] }}
                    >
                      {digit}
                    </span>
                  ))}
                </div>
                <p className="matricule-hint">Le matricule admin généré est toujours unique et sur 5 chiffres.</p>
              </div>
            ) : (
              <div className="matricule-card admin-matricule-card">
                <div className="matricule-icon" aria-hidden="true">
                  <Fingerprint size={40} color="#ff6b6b" />
                </div>
                <p className="matricule-label">Matricule admin personnalisé</p>
                <div className="matricule-number">
                  {(customMatricule || '00000').padEnd(5, '0').slice(0, 5).split('').map((digit, index) => (
                    <span key={`manual-digit-${index}`} className="matricule-digit">
                      {digit}
                    </span>
                  ))}
                </div>
                <div className="admin-manual-matricule">
                  <input
                    type="text"
                    inputMode="numeric"
                    className="step-input admin-matricule-input"
                    placeholder="Ex: 12345"
                    maxLength={5}
                    value={customMatricule}
                    onChange={(event) => handleCustomMatriculeChange(event.target.value)}
                  />
                  <button type="button" className="photo-action" onClick={handleVerifyCustomMatricule}>
                    Vérifier
                  </button>
                </div>
                <p
                  className={`admin-inline-status ${customMatriculeStatus === 'valid' ? 'is-valid' : customMatriculeStatus === 'invalid' ? 'is-error' : ''}`}
                >
                  {customMatriculeMessage || 'Uniquement des chiffres, exactement 5 chiffres.'}
                </p>
              </div>
            )}

            {matriculeMode === 'auto' && matriculeStatus !== 'done' && !isMatriculeAnimating ? (
              <button type="button" className="next-button" onClick={handleGenerateMatricule}>
                <RefreshCcw size={18} />
                {matricule ? 'Regénérer un matricule' : 'Générer un matricule'}
              </button>
            ) : null}

            {saveError ? (
              <p className="quality-subtitle" role="alert">
                {saveError}
              </p>
            ) : null}

            {matriculeMode === 'auto' && isMatriculeAnimating ? (
              <button
                className="next-button skip-matricule"
                type="button"
                onClick={skipMatriculeAnimation}
                title="Passer l'animation"
              >
                <ChevronsRight size={22} style={{ marginRight: 8, verticalAlign: 'middle' }} />
                Skip
              </button>
            ) : null}

            {(matriculeMode === 'auto' && matriculeStatus === 'done') || (matriculeMode === 'manual' && customMatriculeStatus === 'valid') ? (
              <button
                className="next-button"
                type="button"
                onClick={() => setCurrentStep(5)}
              >
                Suivant
                <span className="arrow">→</span>
              </button>
            ) : null}
          </div>
        );

      case 5:
        return (
          <div className="step-content fade-in">
            <h2 className="step-title">Définir la qualité</h2>
            <p className="quality-subtitle">Pas de mini-jeu ici: il suffit de cocher Premium si besoin.</p>
            <button
              type="button"
              className={`admin-premium-card ${isPremium ? 'is-premium' : ''}`}
              onClick={() => setIsPremium((prev) => !prev)}
            >
              <div className="admin-premium-card__icon" aria-hidden="true">
                {isPremium ? <Crown size={24} /> : <Sparkles size={24} />}
              </div>
              <div className="admin-premium-card__content">
                <strong>{isPremium ? 'Bétail Premium' : 'Bétail Standard'}</strong>
                <span>{isPremium ? 'La case Premium est cochée.' : 'La case Premium est décochée.'}</span>
              </div>
              <span className={`admin-premium-check ${isPremium ? 'is-on' : ''}`} aria-hidden="true">
                {isPremium ? <Check size={18} /> : null}
              </span>
            </button>
            <button className="next-button" type="button" onClick={() => setCurrentStep(6)}>
              Suivant
              <span className="arrow">→</span>
            </button>
          </div>
        );

      case 6:
        return (
          <div className="step-content fade-in">
            <h2 className="step-title">Badges du b&eacute;tail</h2>
            <p className="quality-subtitle">
              S&eacute;lectionne jusqu&apos;&agrave; 3 badges cach&eacute;s. Ils seront attribu&eacute;s &agrave; l&apos;achat (sans d&eacute;compter le stock) et auto-&eacute;quip&eacute;s seulement si l&apos;utilisateur ne les poss&egrave;de pas d&eacute;j&agrave;.
            </p>
            <div className="admin-badge-head">
              <span className="admin-badge-counter">{selectedBadges.length}/3</span>
              <span className="admin-badge-note">Chargement pagin&eacute;: {ADMIN_BADGES_PAGE_SIZE} badges par page.</span>
            </div>
            <div className="admin-badge-tools">
              <input
                type="text"
                className="step-input admin-badge-search"
                placeholder="Rechercher un badge (nom ou fichier)"
                value={badgeSearchInput}
                onChange={(event) => setBadgeSearchInput(event.target.value)}
              />
              <button
                type="button"
                className="photo-action admin-badge-reload"
                onClick={() => loadAdminBadges({ reset: true, search: badgeSearchInput })}
                disabled={adminBadgeLoading}
              >
                {adminBadgeLoading ? 'Chargement...' : 'Rafraichir'}
              </button>
            </div>
            {adminBadgeError ? (
              <p className="quality-subtitle" role="alert">
                {adminBadgeError}
              </p>
            ) : null}
            {!adminBadgeLoading && !adminBadgeRows.length ? (
              <p className="admin-badge-empty">Aucun badge actif trouve pour cette recherche.</p>
            ) : null}
            <div className="admin-badge-grid" role="list" aria-label="Selection de badges cadeaux">
              {adminBadgeRows.map((badge) => {
                const isSelected = selectedBadges.includes(badge.id);
                const isDisabled = !isSelected && selectedBadges.length >= 3;
                return (
                  <button
                    key={badge.id}
                    type="button"
                    className={`admin-badge-card is-${badge.rarity} ${isSelected ? 'is-selected' : ''}`}
                    onClick={() => handleToggleBadge(badge.id)}
                    disabled={isDisabled}
                    role="listitem"
                  >
                    <span className="admin-badge-card__media" aria-hidden="true">
                      <img src={badge.imageUrl} alt={badge.name} loading="lazy" />
                    </span>
                    <span className="admin-badge-card__title">{badge.name}</span>
                    <span className="admin-badge-card__rarity">{badge.rarityLabel}</span>
                    <span className="admin-badge-card__filename">{badge.filename}</span>
                  </button>
                );
              })}
            </div>
            {adminBadgeHasMore ? (
              <button
                type="button"
                className="photo-action admin-badge-load-more"
                onClick={handleLoadMoreAdminBadges}
                disabled={adminBadgeLoading || adminBadgeLoadingMore}
              >
                {adminBadgeLoadingMore ? 'Chargement...' : 'Charger plus'}
              </button>
            ) : null}
            {selectedBadgeItems.length ? (
              <div className="admin-selected-badges">
                {selectedBadgeItems.map((badge) => (
                  <span key={badge.id} className={`admin-selected-badge is-${badge.rarity}`}>
                    {badge.name}
                  </span>
                ))}
              </div>
            ) : null}
            <button className="next-button" type="button" onClick={() => setCurrentStep(7)}>
              Suivant
              <span className="arrow">→</span>
            </button>
          </div>
        );
      case 7:
        return (
          <div className="step-content fade-in">
            <h2 className="step-title">Ajouter un commentaire</h2>
            <p className="quality-subtitle">Aucune limite spécifique côté UI pour la version admin.</p>
            <textarea
              className="comment-input"
              rows={5}
              placeholder="Écris un commentaire libre pour ce bétail..."
              value={commentaire}
              onChange={(event) => setCommentaire(event.target.value)}
            />
            <button className="next-button" type="button" onClick={() => setCurrentStep(8)}>
              Voir le récap
              <span className="arrow">→</span>
            </button>
          </div>
        );

      case 8:
        return (
          <div className="step-content fade-in recap-step">
            <h2 className="step-title">Récapitulatif admin</h2>
            <p className="quality-subtitle">Voici un récapitulatif du bétail admin, avec une dernière retouche possible avant validation.</p>

            <div className="recap-photo-block">
              <div className="recap-photo-label" style={{ display: 'block', width: 130, height: 130 }}>
                {(() => {
                  const recapSize = 110;
                  const scaleRatio = recapSize / previewSize;
                  const baseScale = getBaseScale();
                  const imgWidth = imageNaturalSize.width ? imageNaturalSize.width * baseScale * scaleRatio : recapSize;
                  const imgHeight = imageNaturalSize.height ? imageNaturalSize.height * baseScale * scaleRatio : recapSize;
                  const isDefault = (!photoFilePreview && !photoUrl) || photoFilePreview === defaultProfileImage;
                  const transform = isDefault
                    ? `translate(-50%, -50%) translate(${defaultPhotoOffset.x * scaleRatio}px, ${defaultPhotoOffset.y * scaleRatio}px) scale(${defaultPhotoZoom})`
                    : `translate(-50%, -50%) translate(${photoPosition.x * scaleRatio}px, ${photoPosition.y * scaleRatio}px) scale(${photoZoom})`;

                  return (
                    <div
                      className="recap-photo-preview"
                      style={{
                        width: recapSize,
                        height: recapSize,
                        borderRadius: '50%',
                        border: '3px solid #ffd166',
                        overflow: 'hidden',
                        position: 'relative',
                        background: '#fff',
                        margin: '0 auto',
                      }}
                    >
                      <img
                        src={photoFilePreview || photoUrl || defaultProfileImage}
                        alt="Photo du bétail"
                        className="recap-photo"
                        draggable={false}
                        onLoad={(event) => {
                          setImageNaturalSize({
                            width: event.currentTarget.naturalWidth,
                            height: event.currentTarget.naturalHeight,
                          });
                        }}
                        style={{
                          position: 'absolute',
                          left: '50%',
                          top: '50%',
                          width: imgWidth,
                          height: imgHeight,
                          transform,
                          objectFit: 'cover',
                          userSelect: 'none',
                          pointerEvents: 'none',
                        }}
                      />
                    </div>
                  );
                })()}
              </div>
            </div>

            <div className="recap-fields">
              <div className="recap-row">
                <span className="recap-label">Prénom :</span>
                <input
                  className="recap-input"
                  value={prenom}
                  onChange={(event) => setPrenom(event.target.value)}
                  style={{ minWidth: 80 }}
                />
              </div>
              <div className="recap-row">
                <span className="recap-label">Âge :</span>
                <input
                  className="recap-input"
                  type="number"
                  min={1}
                  max={9999}
                  value={age}
                  onChange={(event) => applyAdminAge(event.target.value)}
                  style={{ width: 90 }}
                />
                <span className="recap-unit">an{age > 1 ? 's' : ''}</span>
              </div>
              <div className="recap-row">
                <span className="recap-label">Qualité :</span>
                <button
                  type="button"
                  className={`admin-recap-quality-toggle ${isPremium ? 'is-premium' : ''}`}
                  onClick={() => setIsPremium((prev) => !prev)}
                >
                  {isPremium ? 'Premium' : 'Standard'}
                </button>
              </div>
              <div className="recap-row">
                <span className="recap-label">Matricule :</span>
                <span className="recap-matricule">{matricule}</span>
              </div>
              <div className="recap-row">
                <span className="recap-label">Commentaire :</span>
                <textarea
                  className="recap-input"
                  value={commentaire}
                  onChange={(event) => setCommentaire(event.target.value)}
                  rows={3}
                  style={{ minWidth: 180, maxWidth: 320, resize: 'vertical' }}
                  placeholder="Aucun commentaire"
                />
              </div>
            </div>

            <div className="admin-recap-badges">
              <span className="admin-recap-badges__label">Badges cadeaux cachés :</span>
              <div className="admin-selected-badges">
                {selectedBadgeItems.length ? (
                  selectedBadgeItems.map((badge) => (
                    <span key={badge.id} className={`admin-selected-badge is-${badge.rarity}`}>
                      {badge.name}
                    </span>
                  ))
                ) : (
                  <span className="admin-selected-badge is-empty">Aucun badge sélectionné</span>
                )}
              </div>
            </div>

            {saveError ? (
              <p className="quality-subtitle" role="alert">
                {saveError}
              </p>
            ) : null}

            <div className="recap-actions">
              <button type="button" className="restart-button" onClick={resetAdminMaker} disabled={isSaving}>
                Recommencer
              </button>
              <button className="next-button" type="button" onClick={handleSaveBetail} disabled={isSaving}>
                {isSaving ? 'Enregistrement...' : 'Valider'}
                <span className="arrow">→</span>
              </button>
            </div>
          </div>
        );

      case 9:
        return (
          <div className="step-content fade-in">
            <div className="admin-success-badge">
              <ShieldCheck size={18} />
              Création admin réussie
            </div>
            <h2 className="step-title">Bétail admin enregistré</h2>
            <p className="quality-subtitle">
              Aucun gain d&apos;argent n&apos;a été attribué. Matricule final: <strong>{successMatricule || matricule}</strong>.
            </p>
            <Link to="/betail-register" className="registry-link">
              Voir le registre du bétail
              <span className="arrow">→</span>
            </Link>
            <button type="button" className="registry-link registry-link-button" onClick={resetAdminMaker}>
              Créer un autre bétail admin
              <span className="arrow">→</span>
            </button>
            <button type="button" className="photo-action ghost admin-maker-exit" onClick={onExitAdmin}>
              Retour au maker standard
            </button>
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <div className="betail-maker admin-betail-maker">
      <div className="betail-container admin-betail-container">
        <div className="stepper-card admin-stepper-card">
          {currentStep > 0 && currentStep < 9 ? (
            <>
              <button type="button" className="admin-step-back" onClick={handleGoBack}>
                <ArrowLeft size={16} />
                Retour
              </button>
              <div className="progress-bar">
                <div className="progress-fill" style={{ width: `${Math.min(100, (currentStep / totalSteps) * 100)}%` }} />
              </div>
            </>
          ) : null}
          {renderStepContent()}
        </div>
      </div>
    </div>
  );
}

export default AdminBetailMaker;
