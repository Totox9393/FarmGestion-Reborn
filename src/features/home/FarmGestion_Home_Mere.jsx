import { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Icon } from '@iconify/react';
import { useAuth } from '../authentification/AuthContext';
import { supabase } from '../authentification/supabaseClient';
import { Heart, Crown, CalendarDays, PlusCircle, ShoppingCart, Tractor, ListChecks, ArrowRight, ShoppingBag, LifeBuoy } from 'lucide-react';
import { createSafeAudio, restartAudioSafely } from '../utils/safeAudio';
import { getFullVersionLabel } from '../utils/appVersion';
import HomeWelcomeGuidesModal from './HomeWelcomeHelpModal';
import HomeAuctionBanner from './HomeAuctionBanner';
import './FarmGestionHome.css';
import logoFg from '../../assets/img/logo_milo_fg.png';
import defaultProfileUser from '../../assets/defaut_profile_user.png';
import likeConfirmSound from '../../assets/sounds/confirmation_003.ogg';

// Import images des bétails
import betail1 from '../../assets/img/betails/betail1.jpeg';
import betail2 from '../../assets/img/betails/betail2.jpg';
import betail3 from '../../assets/img/betails/betail3.png';
import betail5 from '../../assets/img/betails/betail5.jpg';
import betail7 from '../../assets/img/betails/betail7.jpg';
import betail9 from '../../assets/img/betails/betail9.jpg';
import betail11 from '../../assets/img/betails/betail11.jpg';
import betail13 from '../../assets/img/betails/betail13.jpg';
import gupna1 from '../../assets/img/gupna/gupna1.png';
import gupna3 from '../../assets/img/gupna/gupna3.png';
import gupna4 from '../../assets/img/gupna/gupna4.png';
import gupna6 from '../../assets/img/gupna/gupna6.png';
import gupna8 from '../../assets/img/gupna/gupna8.png';
import gupna9 from '../../assets/img/gupna/gupna9.png';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const MILO_REFECTOIRE_URL = supabaseUrl
  ? `${supabaseUrl}/storage/v1/object/public/ressources/milo_refectoire.png`
  : '';
const FARMS_BG_URL = supabaseUrl
  ? `${supabaseUrl}/storage/v1/object/public/ressources/farms.png`
  : '';
const BETAILS_CACHE_TTL_MS = 15000;
const PARIS_TIMEZONE = 'Europe/Paris';
const WEEK_LABELS = ['LUN', 'MAR', 'MER', 'JEU', 'VEN', 'SAM', 'DIM'];
const USER_SETTING_ARCHIVED_BETAILS = 'archived_betails';
const betailsCache = {
  timestamp: 0,
  latest: [],
  top: [],
  authorMap: {},
  likedIds: [],
  viewerId: null,
};

const isNotAuthenticatedError = (error) => {
  const message = String(error?.message || '').toLowerCase();
  return message.includes('not authenticated');
};

const getWeekStart = (value) => {
  const date = value instanceof Date ? new Date(value) : new Date(value);
  const weekDay = date.getDay();
  const mondayOffset = weekDay === 0 ? -6 : 1 - weekDay;
  date.setDate(date.getDate() + mondayOffset);
  date.setHours(0, 0, 0, 0);
  return date;
};

const getDateKeyInParis = (value) => {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const parts = new Intl.DateTimeFormat('fr-FR', {
    timeZone: PARIS_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const year = parts.find((part) => part.type === 'year')?.value;
  const month = parts.find((part) => part.type === 'month')?.value;
  const day = parts.find((part) => part.type === 'day')?.value;
  if (!year || !month || !day) return '';
  return `${year}-${month}-${day}`;
};

const buildWeeklyShippingPlaceholder = () =>
  Array.from({ length: 7 }, (_, index) => ({
    id: `weekday-${index}`,
    label: WEEK_LABELS[index],
    dayNumber: '--',
    avatars: [],
    count: 0,
    hasShipping: false,
    isToday: false,
  }));

const parseVisibilityFromState = (value) => {
  if (typeof value === 'boolean') return value;
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return null;
  if (normalized === 'true' || normalized === 'public' || normalized === 'publique') return true;
  if (normalized === 'false' || normalized === 'private' || normalized === 'privee' || normalized === 'privée') return false;
  return null;
};

const normalizeSettingBetailIds = (value) => {
  let parsed = value;
  if (typeof parsed === 'string') {
    const trimmed = parsed.trim();
    if (!trimmed) return [];
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      return [];
    }
  }

  if (!Array.isArray(parsed)) return [];
  return Array.from(new Set(parsed.filter((item) => typeof item === 'string' && item.trim().length > 0).map((item) => item.trim())));
};

const mockBetails = [
  { id: 1, name: 'Marguerite', matricule: 'BT-7539', race: '⭐ Premium', img: betail1, likes: 24 },
  { id: 2, name: 'Belle', matricule: 'BT-2814', race: 'Standard', img: betail2, likes: 12 },
  { id: 3, name: 'Rosalie', matricule: 'BT-9021', race: 'Standard', img: betail3, likes: 31 },
  { id: 4, name: 'Capucine', matricule: 'BT-4567', race: 'Standard', img: betail5, likes: 9 },
  { id: 5, name: 'Duchesse', matricule: 'BT-1234', race: '⭐ Premium', img: betail7, likes: 27 },
  { id: 6, name: 'Fleur', matricule: 'BT-8890', race: 'Standard', img: betail9, likes: 6 },
  { id: 7, name: 'Praline', matricule: 'BT-5512', race: 'Standard', img: betail11, likes: 18 },
  { id: 8, name: 'Candy', matricule: 'BT-6677', race: '⭐ Premium', img: betail13, likes: 22 },
];

function FarmGestion_Home_Mere() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const likeConfirmAudio = useMemo(() => createSafeAudio(likeConfirmSound), []);
  const [profile, setProfile] = useState(null);
  const [farm, setFarm] = useState(null);
  const [loading, setLoading] = useState(true);
  const [latestBetails, setLatestBetails] = useState([]);
  const [authorMap, setAuthorMap] = useState({});
  const [topBetailsData, setTopBetailsData] = useState([]);
  const [likedBetailIds, setLikedBetailIds] = useState([]);
  const [pendingLikeIds, setPendingLikeIds] = useState([]);
  const [showLatestCreator, setShowLatestCreator] = useState(false);
  const [carouselIndex, setCarouselIndex] = useState(0);
  const [isCarouselPaused, setIsCarouselPaused] = useState(false);
  const [visibleBetails, setVisibleBetails] = useState(4);
  const [isWelcomeHelpOpen, setIsWelcomeHelpOpen] = useState(false);
  const carouselTouchStartXRef = useRef(null);
  const carouselTouchStartYRef = useRef(null);

  const weeklyShippingQuery = useQuery({
    queryKey: ['home', 'weekly-shipping', user?.id],
    queryFn: async () => {
      try {
        if (!user?.id) {
          return { days: buildWeeklyShippingPlaceholder(), total: 0 };
        }

        const weekStart = getWeekStart(new Date());
        const weekEnd = new Date(weekStart);
        weekEnd.setDate(weekStart.getDate() + 7);

        const { data: shippingRows, error: shippingError } = await supabase
          .from('shipping')
          .select('id, betail_id, scheduled_for, status, scheduled_by_uuid')
          .gte('scheduled_for', weekStart.toISOString())
          .lt('scheduled_for', weekEnd.toISOString())
          .order('scheduled_for', { ascending: true });

        if (shippingError || !Array.isArray(shippingRows) || shippingRows.length === 0) {
          return { days: buildWeeklyShippingPlaceholder(), total: 0 };
        }

        const { data: archivedData } = await supabase
          .from('user_settings')
          .select('setting_value')
          .eq('user_id', user.id)
          .eq('setting_name', USER_SETTING_ARCHIVED_BETAILS)
          .maybeSingle();
        const archivedBetailSet = new Set(normalizeSettingBetailIds(archivedData?.setting_value));

        const betailIds = [...new Set(shippingRows.map((row) => row.betail_id).filter(Boolean))];
        let betailMap = new Map();
        if (betailIds.length) {
          const { data: betailsRows, error: betailsError } = await supabase
            .from('betails')
            .select('id, name, avatar_url, owner_id, farm_id')
            .in('id', betailIds);

          if (!betailsError && Array.isArray(betailsRows)) {
            betailMap = new Map(betailsRows.map((row) => [row.id, row]));
          }
        }

        const farmIds = [...new Set(Array.from(betailMap.values()).map((row) => row?.farm_id).filter(Boolean))];
        let farmMap = new Map();
        if (farmIds.length) {
          const { data: farmsRows, error: farmsError } = await supabase
            .from('farms_list')
            .select('id, visible')
            .in('id', farmIds);

          if (!farmsError && Array.isArray(farmsRows)) {
            farmMap = new Map(farmsRows.map((row) => [row.id, row]));
          }
        }

        const visibleRows = shippingRows.filter((row) => {
          const betail = betailMap.get(row.betail_id);
          const farm = betail?.farm_id ? farmMap.get(betail.farm_id) : null;
          const isOwner = Boolean(betail?.owner_id) && betail.owner_id === user.id;
          const shouldHidePrivateFarm = farm?.visible === false && !isOwner;
          const shouldHideArchived = isOwner && archivedBetailSet.has(String(betail?.id || row.betail_id || ''));
          return !shouldHidePrivateFarm && !shouldHideArchived;
        });

        const groupedByDay = new Map();
        visibleRows.forEach((row) => {
          const key = getDateKeyInParis(row.scheduled_for);
          if (!key) return;
          if (!groupedByDay.has(key)) groupedByDay.set(key, []);
          groupedByDay.get(key).push(row);
        });

        const todayKey = getDateKeyInParis(new Date());

        const days = Array.from({ length: 7 }, (_, index) => {
          const date = new Date(weekStart);
          date.setDate(weekStart.getDate() + index);
          const key = getDateKeyInParis(date);
          const rows = groupedByDay.get(key) || [];
          const unique = [];
          const seen = new Set();
          rows.forEach((row) => {
            const betail = betailMap.get(row.betail_id);
            const uniq = row.betail_id || row.id;
            if (seen.has(uniq)) return;
            seen.add(uniq);
            unique.push({
              id: uniq,
              name: betail?.name || 'Bétail',
              avatarUrl: betail?.avatar_url || '',
            });
          });

          return {
            id: key || `weekday-${index}`,
            label: WEEK_LABELS[index],
            dayNumber: new Intl.DateTimeFormat('fr-FR', { day: '2-digit', timeZone: PARIS_TIMEZONE }).format(date),
            avatars: unique,
            count: rows.length,
            hasShipping: rows.length > 0,
            isToday: key === todayKey,
          };
        });

        return { days, total: visibleRows.length };
      } catch {
        return { days: buildWeeklyShippingPlaceholder(), total: 0 };
      }
    },
    enabled: !!user?.id,
    staleTime: 60_000,
    gcTime: 300_000,
    refetchOnWindowFocus: false,
    retry: 0,
    placeholderData: { days: buildWeeklyShippingPlaceholder(), total: 0 },
  });

  const normalizeAvatar = (url) => {
    if (!url) return betail1;
    if (url.startsWith('http://') || url.startsWith('https://')) return url;
    const clean = url.startsWith('/') ? url : `/storage/v1/object/public/betails/${url}`;
    return `${supabaseUrl}${clean}`;
  };

  const normalizeProfileAvatar = (url) => {
    const raw = String(url || '').trim();
    if (!raw) return defaultProfileUser;
    if (raw.startsWith('http://') || raw.startsWith('https://')) return raw;
    if (!supabaseUrl) return raw;
    if (raw.startsWith('/storage/v1/object/public/')) return `${supabaseUrl}${raw}`;
    if (raw.startsWith('storage/v1/object/public/')) return `${supabaseUrl}/${raw}`;
    if (raw.startsWith('/')) return `${supabaseUrl}${raw}`;
    if (raw.includes('/')) return `${supabaseUrl}/storage/v1/object/public/${raw}`;
    return `${supabaseUrl}/storage/v1/object/public/avatars/${raw}`;
  };

  const currentMonthLabel = useMemo(
    () =>
      new Intl.DateTimeFormat('fr-FR', {
        month: 'long',
        timeZone: PARIS_TIMEZONE,
      }).format(new Date()),
    []
  );
  const currentYear = useMemo(() => new Date().getFullYear(), []);
  const versionLabel = getFullVersionLabel();

  const handleImgError = (e) => {
    e.currentTarget.onerror = null;
    e.currentTarget.src = betail1;
    if (e.currentTarget.parentElement) {
      e.currentTarget.parentElement.style.backgroundImage = `url(${betail1})`;
    }
  };

  useEffect(() => {
    if (!user) return;
    setLoading(true);
    supabase
      .from('users_profiles')
      .select('*')
      .eq('id', user.id)
      .maybeSingle()
      .then(async ({ data }) => {
        setProfile(data);
        if (data?.farm_id) {
          const { data: farmData } = await supabase
            .from('farms_list')
            .select('name, state')
            .eq('id', data.farm_id)
            .maybeSingle();
          setFarm(farmData || null);
        } else {
          setFarm(null);
        }
        setLoading(false);
      });
  }, [user]);

  const fetchBetailsData = useCallback(async () => {
    const now = Date.now();
    if (now - betailsCache.timestamp < BETAILS_CACHE_TTL_MS && betailsCache.viewerId === (user?.id || null)) {
      setLatestBetails(betailsCache.latest);
      setTopBetailsData(betailsCache.top);
      setAuthorMap(betailsCache.authorMap);
      setLikedBetailIds(betailsCache.likedIds || []);
      return;
    }

    const [latestResponse, topResponse] = await Promise.all([
      supabase
        .from('betails')
        .select('id, name, matricule, avatar_url, like_count, created_at, author_id, visible, owner_id, farm_id, purchased_at')
        .eq('visible', true)
        .order('created_at', { ascending: false })
        .limit(8),
      supabase
        .from('betails')
        .select('id, name, matricule, avatar_url, like_count, author_id')
        .eq('visible', true)
        .order('like_count', { ascending: false })
        .limit(3)
    ]);

    if (latestResponse.error || topResponse.error) {
      setLatestBetails([]);
      setTopBetailsData([]);
      setAuthorMap({});
      setLikedBetailIds([]);
      return;
    }

    const latest = latestResponse.data || [];
    const top = topResponse.data || [];
    setLatestBetails(latest);
    setTopBetailsData(top);

    const likeTargetIds = Array.from(new Set(latest.map((item) => item?.id).filter(Boolean)));
    let likedIds = [];
    if (user?.id && likeTargetIds.length) {
      const { data: likesRows, error: likesError } = await supabase
        .from('betail_likes')
        .select('betail_id')
        .eq('user_id', user.id)
        .in('betail_id', likeTargetIds);

      if (!likesError) {
        likedIds = (likesRows || []).map((row) => String(row?.betail_id || '')).filter(Boolean);
      }
    }
    setLikedBetailIds(likedIds);

    const authorIds = [...new Set([...latest, ...top].map((item) => item.author_id).filter(Boolean))];
    if (!authorIds.length) {
      setAuthorMap({});
      betailsCache.timestamp = now;
      betailsCache.latest = latest;
      betailsCache.top = top;
      betailsCache.authorMap = {};
      betailsCache.likedIds = likedIds;
      betailsCache.viewerId = user?.id || null;
      return;
    }

    const { data: authorsData, error: authorsError } = await supabase
      .from('users_profiles')
      .select('id, username, avatar_url')
      .in('id', authorIds);

    if (authorsError) {
      setAuthorMap({});
      betailsCache.timestamp = now;
      betailsCache.latest = latest;
      betailsCache.top = top;
      betailsCache.authorMap = {};
      betailsCache.likedIds = likedIds;
      betailsCache.viewerId = user?.id || null;
      return;
    }

    const nextMap = (authorsData || []).reduce((acc, author) => {
      acc[author.id] = {
        username: author.username,
        avatarUrl: author.avatar_url || '',
      };
      return acc;
    }, {});
    setAuthorMap(nextMap);
    betailsCache.timestamp = now;
    betailsCache.latest = latest;
    betailsCache.top = top;
    betailsCache.authorMap = nextMap;
    betailsCache.likedIds = likedIds;
    betailsCache.viewerId = user?.id || null;
  }, [user?.id]);

  useEffect(() => {
    fetchBetailsData();
  }, [fetchBetailsData]);

  const { data: farmStats = {}, isLoading: isLoadingFarmStats } = useQuery({
    queryKey: ['home', 'farm-stats', user?.id, profile?.farm_id],
    queryFn: async () => {
      try {
        if (!user?.id || !profile?.farm_id) return { farmId: null, farmState: null, betailCount: 0, farmName: null, farmVisible: null, badgeCount: 0 }

        const [farmRes, countRes, badgesInventoryRes] = await Promise.all([
          supabase.from('farms_list').select('id,name,state,visible').eq('id', profile.farm_id).maybeSingle(),
          supabase.from('betails').select('id', { count: 'exact' }).eq('owner_id', user.id).eq('farm_id', profile.farm_id).eq('visible', true),
          supabase.from('badges_inventory_reborn').select('id', { count: 'exact', head: true }).eq('user_id', user.id),
        ])

        const farmObj = farmRes?.data ?? null
        const count = typeof countRes?.count === 'number' ? countRes.count : 0
        const badgeCount = typeof badgesInventoryRes?.count === 'number' ? badgesInventoryRes.count : 0
        const stateVisibility = parseVisibilityFromState(farmObj?.state)
        const resolvedVisibility = stateVisibility ?? (typeof farmObj?.visible === 'boolean' ? farmObj.visible : null)

        return {
          farmId: farmObj?.id ?? profile.farm_id ?? null,
          farmState: farmObj?.state ?? null,
          betailCount: count,
          farmName: farmObj?.name ?? null,
          farmVisible: resolvedVisibility,
          badgeCount,
        }
      } catch (err) {
        // Ne pas jeter pour éviter une erreur 500 côté UI ; retourner des valeurs sûres
        return { farmId: profile?.farm_id ?? null, farmState: null, betailCount: 0, farmName: null, farmVisible: null, badgeCount: 0 }
      }
    },
    enabled: !!user?.id && !!profile?.farm_id,
    staleTime: 15_000,
    cacheTime: 60_000,
  })

  const { data: lastPurchasedBetail = null, isLoading: isLoadingLastPurchased } = useQuery({
    queryKey: ['home', 'last-purchased-betail', user?.id],
    queryFn: async () => {
      try {
        if (!user?.id) return null;

        const { data: candidates, error } = await supabase
          .from('betails')
          .select('id,name,matricule,avatar_url,purchased_at')
          .eq('owner_id', user.id)
          .not('purchased_at', 'is', null)
          .order('purchased_at', { ascending: false, nullsFirst: false })
          .limit(50);

        if (error) return null;
        if (!candidates?.length) return null;

        const candidateIds = candidates.map((item) => item.id).filter(Boolean);
        const { data: wonAuctionSlots, error: auctionSlotsError } = await supabase
          .from('auction_slots_reborn')
          .select('betail_id,updated_at')
          .eq('winner_user_id', user.id)
          .eq('status', 'sold')
          .in('betail_id', candidateIds)
          .order('updated_at', { ascending: false });

        if (auctionSlotsError) return candidates[0] ?? null;

        const latestAuctionWinByBetail = new Map();
        (wonAuctionSlots || []).forEach((slot) => {
          const betailId = String(slot?.betail_id || '');
          const wonAt = new Date(slot?.updated_at || 0).getTime();
          if (!betailId || !Number.isFinite(wonAt)) return;
          const previous = latestAuctionWinByBetail.get(betailId) || 0;
          if (wonAt > previous) latestAuctionWinByBetail.set(betailId, wonAt);
        });

        const AUCTION_TRANSFER_TIME_TOLERANCE_MS = 10_000;
        return candidates.find((item) => {
          const purchasedAt = new Date(item?.purchased_at || 0).getTime();
          const auctionWonAt = latestAuctionWinByBetail.get(String(item?.id || ''));
          if (!auctionWonAt || !Number.isFinite(purchasedAt)) return true;
          return Math.abs(purchasedAt - auctionWonAt) > AUCTION_TRANSFER_TIME_TOLERANCE_MS;
        }) ?? null;
      } catch {
        return null;
      }
    },
    enabled: !!user?.id,
    staleTime: 60_000,
    gcTime: 300_000,
    refetchOnWindowFocus: false,
    retry: 0,
  });

  // Refresh periodically instead of realtime to avoid websocket errors
  useEffect(() => {
    const intervalId = setInterval(fetchBetailsData, 15000);
    return () => clearInterval(intervalId);
  }, [fetchBetailsData]);

  const initial = useMemo(() => (profile?.username ? profile.username[0]?.toUpperCase() : '?'), [profile]);

  const likedIdsSet = useMemo(() => new Set((likedBetailIds || []).map((id) => String(id))), [likedBetailIds]);
  const isLikeableId = useCallback((value) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(value || '')), []);
  const carouselBetails = useMemo(() => {
    if (!latestBetails.length) return mockBetails;
    const mappedLatest = latestBetails.map((betail, index) => ({
      id: betail.id || `db-${index}`,
      name: betail.name,
      matricule: betail.matricule,
      author: authorMap[betail.author_id]?.username || 'Auteur inconnu',
      img: normalizeAvatar(betail.avatar_url),
      likes: betail.like_count ?? 0,
      likedByMe: Boolean(betail.liked_by_me) || likedIdsSet.has(String(betail.id || '')),
      canLike: isLikeableId(betail.id),
    }));
    const merged = [...mockBetails];
    const count = Math.min(mappedLatest.length, merged.length);
    for (let i = 0; i < count; i += 1) {
      merged[i] = mappedLatest[i];
    }
    return merged;
  }, [latestBetails, authorMap, likedIdsSet, isLikeableId]);
  const maxIndex = Math.max(0, carouselBetails.length - visibleBetails);

  const nextSlide = () => setCarouselIndex(prev => Math.min(prev + 1, maxIndex));
  const prevSlide = () => setCarouselIndex(prev => Math.max(prev - 1, 0));

  const handleCarouselTouchStart = useCallback((event) => {
    const touch = event.changedTouches?.[0];
    if (!touch) return;
    carouselTouchStartXRef.current = touch.clientX;
    carouselTouchStartYRef.current = touch.clientY;
    setIsCarouselPaused(true);
  }, []);

  const handleCarouselTouchEnd = useCallback((event) => {
    const touch = event.changedTouches?.[0];
    const startX = carouselTouchStartXRef.current;
    const startY = carouselTouchStartYRef.current;
    carouselTouchStartXRef.current = null;
    carouselTouchStartYRef.current = null;
    if (!touch || startX == null || startY == null) return;

    const deltaX = touch.clientX - startX;
    const deltaY = touch.clientY - startY;
    const isHorizontalSwipe = Math.abs(deltaX) >= 40 && Math.abs(deltaX) > Math.abs(deltaY);
    if (!isHorizontalSwipe) {
      setIsCarouselPaused(false);
      return;
    }

    if (deltaX < 0) {
      nextSlide();
    } else {
      prevSlide();
    }

    window.setTimeout(() => {
      setIsCarouselPaused(false);
    }, 900);
  }, [nextSlide, prevSlide]);
  const openCommunityPage = useCallback(() => {
    navigate('/community');
  }, [navigate]);
  const openFarmPage = useCallback(() => {
    if (!profile?.farm_id) return;
    navigate(`/farm/${profile.farm_id}`);
  }, [navigate, profile?.farm_id]);
  const handleWidgetKeyDown = useCallback((event, action) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      action();
    }
  }, []);
  const openBetailRegister = useCallback(() => {
    navigate('/betail-register');
  }, [navigate]);
  const openBetailMaker = useCallback(() => {
    navigate('/betail-maker');
  }, [navigate]);
  const openMyBetailsPage = useCallback(() => {
    navigate('/mes-betails');
  }, [navigate]);
  const openShopPage = useCallback(() => {
    navigate('/boutique');
  }, [navigate]);
  const openWelcomeHelp = useCallback(() => {
    setIsWelcomeHelpOpen(true);
  }, []);
  const closeWelcomeHelp = useCallback(() => {
    setIsWelcomeHelpOpen(false);
  }, []);
  const navigateFromWelcomeHelp = useCallback((path) => {
    setIsWelcomeHelpOpen(false);
    if (!path) return;
    navigate(path);
  }, [navigate]);
  const farmName = farmStats.farmName ?? farm?.name ?? '—';
  const farmState = farmStats.farmState ?? farm?.state ?? 'Inconnu';
  const hasBetailCount = typeof farmStats.betailCount === 'number';
  const farmBetailDisplay = hasBetailCount ? farmStats.betailCount : '—';
  const farmIdDisplay = farmStats.farmId ?? profile?.farm_id ?? '—';
  const farmNameDisplay = farmIdDisplay !== '—' ? `${farmName} #${farmIdDisplay}` : farmName;
  const farmVisibilityLabel = farmStats.farmVisible === true ? 'Publique' : farmStats.farmVisible === false ? 'Privee' : '—';
  const farmBadgeCount = typeof farmStats.badgeCount === 'number' ? farmStats.badgeCount : 0;
  const canOpenFarm = Boolean(profile?.farm_id);
  const hasLastPurchasedBetail = Boolean(lastPurchasedBetail?.id);
  const hasOwnedBetails = hasBetailCount ? farmStats.betailCount > 0 : false;
  const shouldCreateFirstBetail = !isLoadingFarmStats && !hasOwnedBetails;
  const shouldBuyFirstBetail = !isLoadingLastPurchased && !hasLastPurchasedBetail;
  const heroQuickActions = useMemo(() => {
    const actions = [];

    if (shouldCreateFirstBetail) {
      actions.push({
        key: 'create-first-betail',
        title: 'Créer mon premier bétail',
        subtitle: 'Lance ton élevage en quelques secondes.',
        onClick: openBetailMaker,
        variant: 'priority',
        icon: PlusCircle,
      });
    }

    if (shouldBuyFirstBetail) {
      actions.push({
        key: 'buy-first-betail',
        title: 'Acheter mon premier bétail',
        subtitle: 'Va dans le registre pour choisir ton premier compagnon.',
        onClick: openBetailRegister,
        variant: shouldCreateFirstBetail ? 'secondary' : 'priority',
        icon: ShoppingCart,
      });
    }

    if (actions.length === 0) {
      actions.push(
        {
          key: 'my-betails',
          title: 'Voir mes bétails',
          subtitle: 'Retrouve tous tes bétails en un clic.',
          onClick: openMyBetailsPage,
          variant: 'secondary',
          icon: ListChecks,
        },
        {
          key: 'register',
          title: 'Ouvrir le registre',
          subtitle: 'Achète de nouveaux bétails pour ta ferme.',
          onClick: openBetailRegister,
          variant: 'secondary',
          icon: ShoppingCart,
        },
      );
    }

    actions.push({
      key: 'shop',
      title: 'Accéder à la boutique',
      subtitle: 'Découvre les badges et packs disponibles.',
      onClick: openShopPage,
      variant: 'secondary',
      icon: ShoppingBag,
    });

    return actions;
  }, [
    openBetailMaker,
    openBetailRegister,
    openMyBetailsPage,
    openShopPage,
    shouldBuyFirstBetail,
    shouldCreateFirstBetail,
  ]);
  const lastPurchasedAvatar = hasLastPurchasedBetail ? normalizeAvatar(lastPurchasedBetail?.avatar_url) : '';
  const lastPurchasedName = hasLastPurchasedBetail ? lastPurchasedBetail?.name || 'Sans nom' : 'Aucun bétail acheté';
  const lastPurchasedMatricule = hasLastPurchasedBetail
    ? lastPurchasedBetail?.matricule || 'Matricule inconnu'
    : 'Ton prochain achat apparaitra ici';

  const toggleLikeMutation = useMutation({
    mutationFn: async ({ betailId, currentlyLiked }) => {
      const rpcName = currentlyLiked ? 'unlike_betail' : 'like_betail';
      const { data: rpcResult, error: rpcError } = await supabase.rpc(rpcName, { p_betail_id: betailId });
      if (rpcError) throw rpcError;
      const payload = Array.isArray(rpcResult) ? rpcResult[0] : rpcResult;
      return {
        betailId,
        liked: Boolean(payload?.liked),
        likeCount: Number(payload?.like_count),
      };
    },
    onError: (error) => {
      if (isNotAuthenticatedError(error)) {
        window.dispatchEvent(new CustomEvent('farmgestion-toast', { detail: { type: 'error', message: 'Connectez-vous pour aimer un bétail.' } }));
        return;
      }
      window.dispatchEvent(new CustomEvent('farmgestion-toast', { detail: { type: 'error', message: 'Impossible de mettre a jour le like pour le moment.' } }));
    },
  });

  const applyLikeToCollections = useCallback((betailId, liked, likeCount) => {
    const resolvedCount = Number.isFinite(Number(likeCount)) ? Math.max(0, Number(likeCount)) : null;

    setLatestBetails((current) => {
      const next = (current || []).map((item) =>
        item?.id === betailId
          ? {
              ...item,
              liked_by_me: liked,
              like_count: resolvedCount ?? Number(item?.like_count ?? 0),
            }
          : item,
      );
      betailsCache.latest = next;
      return next;
    });

    setTopBetailsData((current) => {
      const next = (current || []).map((item) =>
        item?.id === betailId
          ? {
              ...item,
              like_count: resolvedCount ?? Number(item?.like_count ?? 0),
            }
          : item,
      );
      betailsCache.top = next;
      return next;
    });

    setLikedBetailIds((current) => {
      const currentSet = new Set((current || []).map((id) => String(id)));
      if (liked) {
        currentSet.add(String(betailId));
      } else {
        currentSet.delete(String(betailId));
      }
      const next = Array.from(currentSet);
      betailsCache.likedIds = next;
      return next;
    });
  }, []);

  const handleToggleCarouselLike = useCallback((event, betail) => {
    event.stopPropagation();
    if (!betail?.canLike || pendingLikeIds.includes(String(betail.id))) return;
    if (!user?.id) {
      window.dispatchEvent(new CustomEvent('farmgestion-toast', { detail: { type: 'error', message: 'Connectez-vous pour aimer un bétail.' } }));
      return;
    }

    const betailId = String(betail.id);
    const currentlyLiked = Boolean(betail.likedByMe);
    const optimisticCount = Math.max(0, Number(betail.likes || 0) + (currentlyLiked ? -1 : 1));

    setPendingLikeIds((current) => Array.from(new Set([...(current || []), betailId])));
    applyLikeToCollections(betailId, !currentlyLiked, optimisticCount);

    toggleLikeMutation.mutate(
      { betailId, currentlyLiked },
      {
        onSuccess: ({ liked, likeCount }) => {
          applyLikeToCollections(betailId, liked, likeCount);
          if (liked) {
            void restartAudioSafely(likeConfirmAudio);
          }
        },
        onError: () => {
          applyLikeToCollections(betailId, currentlyLiked, Number(betail.likes || 0));
        },
        onSettled: () => {
          setPendingLikeIds((current) => (current || []).filter((id) => id !== betailId));
        },
      },
    );
  }, [applyLikeToCollections, likeConfirmAudio, pendingLikeIds, toggleLikeMutation, user?.id]);

  const isLikeButtonTarget = (target) => target instanceof Element && Boolean(target.closest('.betail-like'));

  const handleImportCardClick = (event, betail) => {
    if (isLikeButtonTarget(event.target)) {
      return;
    }
    if (isLikeableId(betail?.id)) {
      navigate(`/betail-register/${betail.id}`);
      return;
    }
    openBetailRegister();
  };

  const handleImportCardKeyDown = (event, betail) => {
    if (isLikeButtonTarget(event.target)) {
      return;
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      if (isLikeableId(betail?.id)) {
        navigate(`/betail-register/${betail.id}`);
        return;
      }
      openBetailRegister();
    }
  };

  const preventImageDrag = useCallback((event) => {
    event.preventDefault();
  }, []);

  const topBetails = useMemo(
    () => topBetailsData.map((betail) => ({
      id: betail.id,
      name: betail.name,
      matricule: betail.matricule,
      author: authorMap[betail.author_id]?.username || 'Auteur inconnu',
      img: normalizeAvatar(betail.avatar_url),
      likes: betail.like_count ?? 0,
    })),
    [topBetailsData, authorMap]
  );

  const latestCreatedBetail = useMemo(() => {
    const latest = latestBetails[0];
    if (!latest) return null;
    const author = authorMap[latest.author_id] || {};
    const isPublicRegisterBetail = latest.visible === true && !latest.owner_id && !latest.farm_id && !latest.purchased_at;
    return {
      authorId: latest.author_id || '',
      authorName: author.username || 'Auteur inconnu',
      authorHandle: author.username || '',
      authorAvatar: normalizeProfileAvatar(author.avatarUrl),
      betailId: latest.id || '',
      betailName: latest.name || 'Sans nom',
      betailAvatar: normalizeAvatar(latest.avatar_url),
      isPublicRegisterBetail,
    };
  }, [latestBetails, authorMap]);

  const handleOpenLatestCreatorProfile = useCallback(() => {
    const handle = String(latestCreatedBetail?.authorHandle || '').trim();
    if (!handle) return;
    navigate(`/community/profile/${encodeURIComponent(handle)}`);
  }, [latestCreatedBetail?.authorHandle, navigate]);

  const handleOpenLatestCreatorBetail = useCallback(() => {
    if (!latestCreatedBetail?.isPublicRegisterBetail || !latestCreatedBetail?.betailId) return;
    navigate(`/betail-register/${latestCreatedBetail.betailId}`);
  }, [latestCreatedBetail, navigate]);

  const roleInfo = useMemo(() => {
    const role = (profile?.role || 'STANDARD').toUpperCase();
    const roleMap = {
      ADMIN: { label: 'Admin', className: 'home-hero__tag--admin' },
      MODERATION: { label: 'Modération', className: 'home-hero__tag--moderation' },
      STANDARD: { label: 'Standard', className: 'home-hero__tag--standard' }
    };
    return roleMap[role] || roleMap.STANDARD;
  }, [profile?.role]);

  const updateWidgetOverflow = useCallback(() => {
    const wraps = document.querySelectorAll('.home-hero__scroll-wrap');
    wraps.forEach((wrap) => {
      const content = wrap.querySelector('.home-hero__scroll');
      if (!content) return;
      const overflow = content.scrollWidth - wrap.clientWidth;
      const isOverflowing = overflow > 4;
      wrap.classList.toggle('is-overflowing', isOverflowing);
      if (isOverflowing) {
        wrap.style.setProperty('--scroll-distance', `${overflow + 16}px`);
      } else {
        wrap.style.removeProperty('--scroll-distance');
      }
    });
  }, []);

  useEffect(() => {
    const updateVisibleBetails = () => {
      const viewportWidth = window.innerWidth;
      if (viewportWidth <= 640) {
        setVisibleBetails(1);
        return;
      }
      if (viewportWidth <= 900) {
        setVisibleBetails(2);
        return;
      }
      setVisibleBetails(4);
    };

    updateVisibleBetails();
    window.addEventListener('resize', updateVisibleBetails);
    return () => window.removeEventListener('resize', updateVisibleBetails);
  }, []);

  useEffect(() => {
    setCarouselIndex((prev) => Math.min(prev, maxIndex));
  }, [maxIndex]);

  useEffect(() => {
    if (maxIndex === 0 || isCarouselPaused) return;
    const intervalId = setInterval(() => {
      setCarouselIndex((prev) => (prev >= maxIndex ? 0 : prev + 1));
    }, 3500);
    return () => clearInterval(intervalId);
  }, [maxIndex, isCarouselPaused]);

  useEffect(() => {
    const rafId = requestAnimationFrame(updateWidgetOverflow);
    const timeoutId = window.setTimeout(updateWidgetOverflow, 120);
    window.addEventListener('resize', updateWidgetOverflow);
    return () => {
      cancelAnimationFrame(rafId);
      window.clearTimeout(timeoutId);
      window.removeEventListener('resize', updateWidgetOverflow);
    };
  }, [updateWidgetOverflow, profile?.username, user?.email, farm?.name]);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setShowLatestCreator((prev) => !prev);
    }, 6000);

    return () => window.clearInterval(intervalId);
  }, []);

  if (loading)
    return (
      <div className="home-loader">
        <div className="loader-dots" aria-hidden="true">
          <div className="dot" />
          <div className="dot" />
          <div className="dot" />
          <div className="dot" />
          <div className="dot" />
          <div className="dot" />
          <div className="dot" />
          <div className="dot" />
        </div>
        <p>Chargement...</p>
      </div>
    );
  if (!profile) return <div className="home-loader">Profil introuvable.</div>;

  return (
    <>
      <div className="home-shell">
      <HomeAuctionBanner />
      <div className="home-hero">
        <div
          className="home-hero__title-block"
          style={{ '--hero-logo': `url(${logoFg})` }}
        >
          <div className="home-hero__header">
            <div>
              <h1 className="home-hero__title">Bienvenue, {profile.username || 'fermier·e'} !</h1>
            </div>
            <div className="home-hero__header-side">
              <div className="home-hero__tags">
                <span className="home-hero__tag">Profil actif</span>
                <span className={`home-hero__tag ${roleInfo.className}`}>
                  {roleInfo.label}
                </span>
              </div>
              <button
                type="button"
                className="home-hero__help-launch"
                onClick={openWelcomeHelp}
                aria-haspopup="dialog"
                aria-expanded={isWelcomeHelpOpen}
                aria-label="Ouvrir l'aide de bienvenue"
              >
                <LifeBuoy size={15} aria-hidden="true" />
                Besoin d'aide ?
              </button>
            </div>
          </div>
          <p className="home-hero__subtitle">Prêt à gérer ta ferme et tes bétails en quelques clics ?</p>
          <div className="home-hero__layout">
            <div className="home-hero__content">
              <div className="home-hero__quick-access" role="group" aria-label="Actions rapides">
                {heroQuickActions.map((action) => {
                  const ActionIcon = action.icon;
                  return (
                    <button
                      key={action.key}
                      type="button"
                      className={`home-hero__quick-btn home-hero__quick-btn--${action.variant}`}
                      onClick={action.onClick}
                      disabled={Boolean(action.disabled)}
                    >
                      <span className="home-hero__quick-btn-icon" aria-hidden="true">
                        <ActionIcon size={17} strokeWidth={2.1} />
                      </span>
                      <span className="home-hero__quick-btn-text">
                        <span className="home-hero__quick-btn-title">{action.title}</span>
                        <span className="home-hero__quick-btn-subtitle">{action.subtitle}</span>
                      </span>
                      <ArrowRight size={16} className="home-hero__quick-btn-arrow" aria-hidden="true" />
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="home-hero__widgets">
              <div
                className="home-hero__widget home-hero__widget--community home-hero__widget--interactive"
                style={{ '--community-bg': MILO_REFECTOIRE_URL ? `url(${MILO_REFECTOIRE_URL})` : 'none' }}
                role="button"
                tabIndex={0}
                onClick={openCommunityPage}
                onKeyDown={(event) => handleWidgetKeyDown(event, openCommunityPage)}
                aria-label="Ouvrir la communauté"
              >
                <p className="home-hero__widget-title">Communauté</p>
                <p className="home-hero__widget-value">Visites les fermes et les profils des autres</p>
                <p className="home-hero__widget-meta">Découvre les membres actifs.</p>
                <p className="home-hero__widget-cta" aria-hidden="true">
                  <span>Explorer la communauté</span>
                  <span>→</span>
                </p>
              </div>
              <div
                className="home-hero__widget home-hero__widget--farm home-hero__widget--interactive"
                style={{ '--farm-bg': FARMS_BG_URL ? `url(${FARMS_BG_URL})` : 'none' }}
                role="button"
                tabIndex={0}
                onClick={openFarmPage}
                onKeyDown={(event) => handleWidgetKeyDown(event, openFarmPage)}
                aria-label="Ouvrir la ferme liée"
                aria-disabled={!canOpenFarm}
              >
                <p className="home-hero__widget-title">Ferme liée</p>
                <p className="home-hero__widget-value">
                  <span className="home-hero__scroll-wrap">
                    <span className="home-hero__scroll">{farm?.name || 'À créer'}</span>
                  </span>
                </p>
                <p className="home-hero__widget-meta">Bétails dans la ferme : {hasBetailCount ? farmStats.betailCount : 0}</p>
                <p className="home-hero__widget-cta" aria-hidden="true">
                  <span>{canOpenFarm ? 'Aller à ma ferme' : 'Aucune ferme disponible'}</span>
                  <span aria-hidden>{canOpenFarm ? '→' : ''}</span>
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Carrousel de bétails */}
      <div
        className="home-carousel-section"
        onMouseEnter={() => setIsCarouselPaused(true)}
        onMouseLeave={() => setIsCarouselPaused(false)}
      >
        <div className="home-carousel-header">
          <h2 className="home-carousel-title">Dernières importations</h2>
          <div className="home-carousel-controls">
            <button
              type="button"
              className="carousel-btn"
              onClick={prevSlide}
              disabled={carouselIndex === 0}
              aria-label="Précédent"
            >
              <span className="carousel-btn__arrow" aria-hidden="true">‹</span>
            </button>
            <button
              type="button"
              className="carousel-btn"
              onClick={nextSlide}
              disabled={carouselIndex >= maxIndex}
              aria-label="Suivant"
            >
              <span className="carousel-btn__arrow" aria-hidden="true">›</span>
            </button>
          </div>
        </div>
        <div className="home-carousel">
          <div
            className="home-carousel-track"
            style={{ transform: `translateX(-${carouselIndex * (100 / visibleBetails)}%)` }}
            onTouchStart={handleCarouselTouchStart}
            onTouchEnd={handleCarouselTouchEnd}
            onTouchCancel={handleCarouselTouchEnd}
          >
            {carouselBetails.map(betail => (
              <div
                key={betail.id}
                className="betail-card"
                role="button"
                tabIndex={0}
                onClick={(event) => handleImportCardClick(event, betail)}
                onKeyDown={(event) => handleImportCardKeyDown(event, betail)}
                aria-label={`Voir ${betail.name} dans le registre`}
              >
                <button
                  type="button"
                  className={`betail-like ${betail.likedByMe ? 'is-liked' : ''}`}
                  aria-label={betail.likedByMe ? `Retirer le like de ${betail.name}` : `Aimer ${betail.name}`}
                  title={betail.likedByMe ? 'Retirer le like' : 'Aimer'}
                  onClick={(event) => handleToggleCarouselLike(event, betail)}
                  disabled={!betail.canLike || pendingLikeIds.includes(String(betail.id))}
                >
                  <Heart size={16} fill={betail.likedByMe ? 'currentColor' : 'none'} />
                  <span>{betail.likes ?? 0}</span>
                </button>
                <div
                  className="betail-avatar"
                  style={{ backgroundImage: `url(${betail.img})`, backgroundSize: 'cover', backgroundPosition: 'center' }}
                  onDragStart={preventImageDrag}
                >
                  <img src={betail.img} alt={betail.name} onError={handleImgError} draggable={false} onDragStart={preventImageDrag} />
                </div>
                <div className="betail-info">
                  <h3 className="betail-name">{betail.name}</h3>
                  <p className="betail-matricule">{betail.matricule}</p>
                  <p className="betail-race">Par {betail.author || 'Auteur inconnu'}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="home-podium">
          <h3 className="home-podium-title">
            {showLatestCreator ? 'Dernier créateur de bétail' : 'Podium des bétails les plus likés'}
          </h3>

          <div className="home-podium-decor" aria-hidden="true">
            <img className="gupna gupna-a" src={gupna1} alt="" />
            <img className="gupna gupna-c" src={gupna3} alt="" />
            <img className="gupna gupna-d" src={gupna4} alt="" />
            <img className="gupna gupna-f" src={gupna6} alt="" />
            <img className="gupna gupna-h" src={gupna8} alt="" />
            <img className="gupna gupna-i" src={gupna9} alt="" />
          </div>

          <div className="home-podium-switcher">
            <div className={`home-podium-panel home-podium-panel--podium ${showLatestCreator ? 'is-hidden' : 'is-visible'}`}>
              <div className="home-podium-stand">
                {[1, 0, 2].map((podiumIndex) => {
                  const betail = topBetails[podiumIndex];
                  if (!betail) return null;
                  const rank = podiumIndex + 1;
                  return (
                    <div key={betail.id} className={`podium-slot podium-${rank}`}>
                      {rank === 1 && (
                        <div className="podium-crown" aria-hidden="true">
                          <Crown size={22} />
                        </div>
                      )}
                      <div className="podium-avatar" style={{ backgroundImage: `url(${betail.img})`, backgroundSize: 'cover', backgroundPosition: 'center' }}>
                        <img src={betail.img} alt={betail.name} onError={handleImgError} />
                      </div>
                      <div className="podium-rank">- {rank} -</div>
                      <div className="podium-info">
                        <p className="podium-name">{betail.name}</p>
                        <p className="podium-meta">#{betail.matricule}</p>
                        <p className="podium-likes"><Heart size={14} /> {betail.likes ?? 0}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div
              className={`home-podium-panel home-podium-panel--latest ${showLatestCreator ? 'is-visible' : 'is-hidden'}`}
              role="status"
              aria-live="polite"
            >
              <div className="home-latest-creator">
                {latestCreatedBetail ? (
                  <>
                    <div className="home-latest-creator-row">
                      <div className="home-latest-creator-item">
                        <span className="home-latest-creator-label">Mère</span>
                        <button
                          type="button"
                          className="home-latest-creator-hit"
                          onClick={handleOpenLatestCreatorProfile}
                          disabled={!latestCreatedBetail.authorHandle}
                          aria-label={`Ouvrir le profil de ${latestCreatedBetail.authorName}`}
                        >
                          <span className="home-latest-creator-avatar">
                            <img
                              src={latestCreatedBetail.authorAvatar}
                              alt={`Avatar de ${latestCreatedBetail.authorName}`}
                              onError={(event) => {
                                event.currentTarget.onerror = null;
                                event.currentTarget.src = defaultProfileUser;
                              }}
                            />
                          </span>
                          <p className="home-latest-creator-user">{latestCreatedBetail.authorName}</p>
                        </button>
                      </div>

                      <span className="home-latest-creator-plus" aria-hidden="true">→</span>

                      <div className="home-latest-creator-item">
                        <span className="home-latest-creator-label">Dernière création</span>
                        <span
                          className={`home-latest-creator-tooltip-wrap ${latestCreatedBetail.isPublicRegisterBetail ? '' : 'is-disabled'}`}
                          data-tooltip="Zut ! Ce bétail a déjà été acheté par quelqu'un d'autre"
                        >
                          <button
                            type="button"
                            className="home-latest-creator-hit"
                            onClick={handleOpenLatestCreatorBetail}
                            disabled={!latestCreatedBetail.isPublicRegisterBetail}
                            aria-label={latestCreatedBetail.isPublicRegisterBetail
                              ? `Ouvrir ${latestCreatedBetail.betailName} dans le registre`
                              : `${latestCreatedBetail.betailName} n'est plus disponible dans le registre public`
                            }
                          >
                            <span className="home-latest-creator-avatar home-latest-creator-avatar--betail">
                              <img
                                src={latestCreatedBetail.betailAvatar}
                                alt={latestCreatedBetail.betailName}
                                onError={handleImgError}
                              />
                            </span>
                            <p className="home-latest-creator-betail">{latestCreatedBetail.betailName}</p>
                          </button>
                        </span>
                      </div>
                    </div>
                  </>
                ) : (
                  <p className="home-latest-creator-empty">Aucune création récente disponible.</p>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="home-grid">
        <button type="button" className="home-card home-card--shipping-week" onClick={() => navigate('/gce')}>
          <div className="home-meeting-card" aria-label="Expéditions de la semaine">
            <div className="home-meeting-card__header">
              <h3 className="home-meeting-card__title">Expéditions semaine</h3>
              <span className="home-meeting-card__date-selector">
                <span>{currentMonthLabel}</span>
                <CalendarDays size={14} />
              </span>
            </div>

            <div className="home-meeting-card__calls-info">
              <CalendarDays size={15} />
              <span>{weeklyShippingQuery.data?.total || 0} expédition{(weeklyShippingQuery.data?.total || 0) > 1 ? 's' : ''} cette semaine</span>
            </div>

            <div className="home-meeting-card__date-nav-and-indicators" aria-hidden="true">
              <div className="home-meeting-card__date-nav-container">
                {(weeklyShippingQuery.data?.days || []).map((day) => (
                  <div
                    key={day.id}
                    className={`home-meeting-card__day-item${day.isToday ? ' is-active' : ''}`}
                    title={day.count > 0 ? `${day.count} expédition${day.count > 1 ? 's' : ''}` : 'Aucune expédition'}
                  >
                    <span className="home-meeting-card__day-number">{day.dayNumber}</span>
                    <span className="home-meeting-card__day-name">{day.label}</span>
                  </div>
                ))}
              </div>

              <div className="home-meeting-card__indicator-container">
                <span className="home-meeting-card__indicator-line" />
                {(weeklyShippingQuery.data?.days || []).map((day) => (
                  <span
                    key={`${day.id}-indicator`}
                    className={`home-meeting-card__indicator-dot${day.hasShipping ? ' is-active' : ''}`}
                    title={day.count > 0 ? `${day.count} expédition${day.count > 1 ? 's' : ''}` : 'Aucune expédition'}
                  />
                ))}
              </div>
            </div>

          </div>

          <div className="home-weekly-ship__avatars-row" aria-hidden="true">
            {(weeklyShippingQuery.data?.days || []).map((day) => (
              <div key={`${day.id}-avatars`} className="home-weekly-ship__avatars-cell">
                <span className="home-weekly-ship__avatars">
                  {day.avatars.slice(0, 3).map((avatar) => (
                    <span key={avatar.id} className="home-weekly-ship__avatar" title={avatar.name}>
                      {avatar.avatarUrl ? (
                        <img
                          src={normalizeAvatar(avatar.avatarUrl)}
                          alt=""
                          loading="lazy"
                          decoding="async"
                          onError={(event) => {
                            event.currentTarget.onerror = null;
                            event.currentTarget.src = betail1;
                          }}
                        />
                      ) : (
                        <span className="home-weekly-ship__avatar-dot" aria-hidden="true" />
                      )}
                    </span>
                  ))}
                  {day.avatars.length === 0 ? (
                    <span className="home-weekly-ship__avatar is-empty" aria-hidden="true">
                      <span className="home-weekly-ship__avatar-dot" />
                    </span>
                  ) : null}
                  {day.avatars.length > 3 ? <span className="home-weekly-ship__avatar is-more">+{day.avatars.length - 3}</span> : null}
                </span>
              </div>
            ))}
          </div>

          <div className="home-meeting-card__open-btn" aria-hidden="true">
            Ouvrir le GCE
            <span aria-hidden>→</span>
          </div>
        </button>

        <div className="home-card home-card--farm">
          <div className="home-meeting-card__header home-farm-card__header">
            <h3 className="home-meeting-card__title">Ferme</h3>
            <span className="home-meeting-card__date-selector home-farm-card__state">{farmState}</span>
          </div>

          <p className="home-farm-card__subtitle">{farmNameDisplay}</p>

          <div className="home-farm-card__metrics" aria-hidden="true">
            <div className="home-farm-card__metric">
              <span className="home-farm-card__metric-label">Bétails</span>
              <strong className="home-farm-card__metric-value">{farmBetailDisplay}</strong>
            </div>
            <div className="home-farm-card__metric">
              <span className="home-farm-card__metric-label">Visibilite</span>
              <strong className="home-farm-card__metric-value">{farmVisibilityLabel}</strong>
            </div>
            <div className="home-farm-card__metric">
              <span className="home-farm-card__metric-label">Badges</span>
              <strong className="home-farm-card__metric-value">{farmBadgeCount}</strong>
            </div>
          </div>

          <div className="home-farm-card__decor" aria-hidden="true">
            <span className="home-farm-card__decor-orb orb-a" />
            <span className="home-farm-card__decor-orb orb-b" />
            <span className="home-farm-card__decor-orb orb-c" />
          </div>

          <div className="home-farm-card__actions">
            <button
              type="button"
              className="home-farm-card__cta-btn"
              onClick={openFarmPage}
              disabled={!canOpenFarm}
            >
              <span>{canOpenFarm ? 'Ouvrir la ferme' : 'Crée une ferme pour activer'}</span>
              <span aria-hidden>→</span>
            </button>
            <button
              type="button"
              className="home-farm-card__secondary-btn"
              onClick={openCommunityPage}
            >
              Voir toutes les fermes
            </button>
          </div>
        </div>

        <div className="home-card home-card--quick-actions">
          <div className="home-card__header">
            <h3 className="home-meeting-card__title home-quick-actions__title">Dernier achat</h3>
          </div>
          <div className={`home-last-betail${isLoadingLastPurchased ? ' is-loading' : ''}`} aria-busy={isLoadingLastPurchased}>
            <div className="home-last-betail__decor" aria-hidden="true">
              <span className="home-last-betail__spark spark-a" />
              <span className="home-last-betail__spark spark-b" />
              <span className="home-last-betail__spark spark-c" />
            </div>

            <div className="home-last-betail__avatar" aria-hidden={!hasLastPurchasedBetail}>
              {hasLastPurchasedBetail ? (
                <img src={lastPurchasedAvatar} alt={lastPurchasedName} loading="lazy" decoding="async" onError={handleImgError} />
              ) : (
                <span>?</span>
              )}
            </div>

            <p className="home-last-betail__name">{lastPurchasedName}</p>
            <p className="home-last-betail__matricule">{lastPurchasedMatricule}</p>

            <div className="home-last-betail__actions">
              <button type="button" className="home-last-betail__cta" onClick={openMyBetailsPage}>
                Accéder à mes bétails
                <span aria-hidden>→</span>
              </button>
              <button
                type="button"
                className="home-last-betail__secondary-btn"
                onClick={() => navigate('/betail-register')}
              >
                Voir tous les bétails
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="home-footer">
        <a
          className="home-footer__link"
          href="https://discord.farmgestion.fr"
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Ouvrir le Discord FarmGestion"
        >
          <Icon icon="logos:discord-icon" width={18} height={18} aria-hidden="true" />
          <span>Discord FarmGestion</span>
        </a>

        <p className="home-footer__brand">FarmGestion FR © {currentYear} • {versionLabel}</p>

        <button
          type="button"
          className="home-footer__link home-footer__link--button"
          onClick={openWelcomeHelp}
          aria-haspopup="dialog"
          aria-expanded={isWelcomeHelpOpen}
          aria-label="Ouvrir le guide interactif"
        >
          <LifeBuoy size={16} aria-hidden="true" />
          <span>Guide interactif</span>
        </button>
      </div>
      </div>

      <HomeWelcomeGuidesModal
        isOpen={isWelcomeHelpOpen}
        onClose={closeWelcomeHelp}
        onNavigate={navigateFromWelcomeHelp}
        hasFarm={Boolean(profile?.farm_id)}
        farmPath={profile?.farm_id ? `/farm/${profile.farm_id}` : null}
      />
    </>
  );
}

export default FarmGestion_Home_Mere;
