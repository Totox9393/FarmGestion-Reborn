import { useEffect, useState, useMemo, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../authentification/AuthContext';
import { supabase } from '../authentification/supabaseClient';
import { ChevronLeft, ChevronRight, Heart, Crown, CalendarDays } from 'lucide-react';
import './FarmGestionHome.css';
import logoFg from '../../assets/img/logo_milo_fg.png';

// Import images des bétails
import betail1 from '../../assets/img/betails/bétails1.jpeg';
import betail2 from '../../assets/img/betails/bétails2.jpg';
import betail3 from '../../assets/img/betails/bétails3.png';
import betail5 from '../../assets/img/betails/bétails5.jpg';
import betail7 from '../../assets/img/betails/bétails7.jpg';
import betail9 from '../../assets/img/betails/bétails9.jpg';
import betail11 from '../../assets/img/betails/bétails11.jpg';
import betail13 from '../../assets/img/betails/bétails13.jpg';
import gupna1 from '../../assets/img/gupna/gupna1.png';
import gupna3 from '../../assets/img/gupna/gupna3.png';
import gupna4 from '../../assets/img/gupna/gupna4.png';
import gupna6 from '../../assets/img/gupna/gupna6.png';
import gupna8 from '../../assets/img/gupna/gupna8.png';
import gupna9 from '../../assets/img/gupna/gupna9.png';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const BETAILS_CACHE_TTL_MS = 15000;
const PARIS_TIMEZONE = 'Europe/Paris';
const WEEK_LABELS = ['LUN', 'MAR', 'MER', 'JEU', 'VEN', 'SAM', 'DIM'];
const betailsCache = {
  timestamp: 0,
  latest: [],
  top: [],
  authorMap: {}
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
  const [profile, setProfile] = useState(null);
  const [farm, setFarm] = useState(null);
  const [loading, setLoading] = useState(true);
  const [latestBetails, setLatestBetails] = useState([]);
  const [authorMap, setAuthorMap] = useState({});
  const [topBetailsData, setTopBetailsData] = useState([]);
  const [carouselIndex, setCarouselIndex] = useState(0);
  const [isCarouselPaused, setIsCarouselPaused] = useState(false);

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

        const betailIds = [...new Set(shippingRows.map((row) => row.betail_id).filter(Boolean))];
        let betailMap = new Map();
        if (betailIds.length) {
          const { data: betailsRows, error: betailsError } = await supabase
            .from('betails')
            .select('id, name, avatar_url, owner_id')
            .in('id', betailIds);

          if (!betailsError && Array.isArray(betailsRows)) {
            betailMap = new Map(betailsRows.map((row) => [row.id, row]));
          }
        }

        const visibleRows = shippingRows.filter((row) => {
          const betail = betailMap.get(row.betail_id);
          return row.scheduled_by_uuid === user.id || betail?.owner_id === user.id;
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

  const currentMonthLabel = useMemo(
    () =>
      new Intl.DateTimeFormat('fr-FR', {
        month: 'long',
        timeZone: PARIS_TIMEZONE,
      }).format(new Date()),
    []
  );

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
    if (now - betailsCache.timestamp < BETAILS_CACHE_TTL_MS) {
      setLatestBetails(betailsCache.latest);
      setTopBetailsData(betailsCache.top);
      setAuthorMap(betailsCache.authorMap);
      return;
    }

    const [latestResponse, topResponse] = await Promise.all([
      supabase
        .from('betails')
        .select('id, name, matricule, avatar_url, like_count, created_at, author_id')
        .order('created_at', { ascending: false })
        .limit(8),
      supabase
        .from('betails')
        .select('id, name, matricule, avatar_url, like_count, author_id')
        .order('like_count', { ascending: false })
        .limit(3)
    ]);

    if (latestResponse.error || topResponse.error) {
      setLatestBetails([]);
      setTopBetailsData([]);
      setAuthorMap({});
      return;
    }

    const latest = latestResponse.data || [];
    const top = topResponse.data || [];
    setLatestBetails(latest);
    setTopBetailsData(top);

    const authorIds = [...new Set([...latest, ...top].map((item) => item.author_id).filter(Boolean))];
    if (!authorIds.length) {
      setAuthorMap({});
      betailsCache.timestamp = now;
      betailsCache.latest = latest;
      betailsCache.top = top;
      betailsCache.authorMap = {};
      return;
    }

    const { data: authorsData, error: authorsError } = await supabase
      .from('users_profiles')
      .select('id, username')
      .in('id', authorIds);

    if (authorsError) {
      setAuthorMap({});
      betailsCache.timestamp = now;
      betailsCache.latest = latest;
      betailsCache.top = top;
      betailsCache.authorMap = {};
      return;
    }

    const nextMap = (authorsData || []).reduce((acc, author) => {
      acc[author.id] = author.username;
      return acc;
    }, {});
    setAuthorMap(nextMap);
    betailsCache.timestamp = now;
    betailsCache.latest = latest;
    betailsCache.top = top;
    betailsCache.authorMap = nextMap;
  }, []);

  useEffect(() => {
    fetchBetailsData();
  }, [fetchBetailsData]);

  const { data: farmStats = {}, isLoading: isLoadingFarmStats } = useQuery({
    queryKey: ['home', 'farm-stats', user?.id, profile?.farm_id],
    queryFn: async () => {
      try {
        if (!user?.id || !profile?.farm_id) return { farmId: null, farmState: null, betailCount: 0, farmName: null }

        const [farmRes, countRes] = await Promise.all([
          supabase.from('farms_list').select('id,name,state').eq('id', profile.farm_id).maybeSingle(),
          supabase.from('betails').select('id', { count: 'exact' }).eq('owner_id', user.id).eq('farm_id', profile.farm_id),
        ])

        const farmObj = farmRes?.data ?? null
        const count = typeof countRes?.count === 'number' ? countRes.count : 0

        return {
          farmId: farmObj?.id ?? profile.farm_id ?? null,
          farmState: farmObj?.state ?? null,
          betailCount: count,
          farmName: farmObj?.name ?? null,
        }
      } catch (err) {
        // Ne pas jeter pour éviter une erreur 500 côté UI ; retourner des valeurs sûres
        return { farmId: profile?.farm_id ?? null, farmState: null, betailCount: 0, farmName: null }
      }
    },
    enabled: !!user?.id && !!profile?.farm_id,
    staleTime: 15_000,
    cacheTime: 60_000,
  })

  // Refresh periodically instead of realtime to avoid websocket errors
  useEffect(() => {
    const intervalId = setInterval(fetchBetailsData, 15000);
    return () => clearInterval(intervalId);
  }, [fetchBetailsData]);

  const initial = useMemo(() => (profile?.username ? profile.username[0]?.toUpperCase() : '?'), [profile]);

  const visibleBetails = 4;
  const carouselBetails = useMemo(() => {
    if (!latestBetails.length) return mockBetails;
    const mappedLatest = latestBetails.map((betail, index) => ({
      id: betail.id || `db-${index}`,
      name: betail.name,
      matricule: betail.matricule,
      author: authorMap[betail.author_id] || 'Auteur inconnu',
      img: normalizeAvatar(betail.avatar_url),
      likes: betail.like_count ?? 0,
    }));
    const merged = [...mockBetails];
    const count = Math.min(mappedLatest.length, merged.length);
    for (let i = 0; i < count; i += 1) {
      merged[i] = mappedLatest[i];
    }
    return merged;
  }, [latestBetails, authorMap]);
  const maxIndex = Math.max(0, carouselBetails.length - visibleBetails);

  const nextSlide = () => setCarouselIndex(prev => Math.min(prev + 1, maxIndex));
  const prevSlide = () => setCarouselIndex(prev => Math.max(prev - 1, 0));

  const topBetails = useMemo(
    () => topBetailsData.map((betail) => ({
      id: betail.id,
      name: betail.name,
      matricule: betail.matricule,
      author: authorMap[betail.author_id] || 'Auteur inconnu',
      img: normalizeAvatar(betail.avatar_url),
      likes: betail.like_count ?? 0,
    })),
    [topBetailsData, authorMap]
  );

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
    <div className="home-shell">
      <div className="home-hero">
        <div
          className="home-hero__title-block"
          style={{ '--hero-logo': `url(${logoFg})` }}
        >
          <div className="home-hero__header">
            <div>
              <p className="home-hero__eyebrow">Tableau de bord</p>
              <h1 className="home-hero__title">Bienvenue, {profile.username || 'fermier·e'} !</h1>
            </div>
            <div className="home-hero__tags">
              <span className="home-hero__tag">Profil actif</span>
              <span className={`home-hero__tag ${roleInfo.className}`}>
                {roleInfo.label}
              </span>
            </div>
          </div>
          <p className="home-hero__subtitle">Prêt à gérer ta ferme et tes bétails en quelques clics.</p>
          <div className="home-hero__layout">
            <div className="home-hero__content">
            </div>
            <div className="home-hero__widgets">
              <div className="home-hero__widget">
                <p className="home-hero__widget-title">Identité</p>
                <p className="home-hero__widget-value">
                  <span className="home-hero__scroll-wrap">
                    <span className="home-hero__scroll">{profile.username || 'fermier·e'}</span>
                  </span>
                </p>
                <p className="home-hero__widget-meta">
                  <span className="home-hero__scroll-wrap">
                    <span className="home-hero__scroll">{user.email}</span>
                  </span>
                </p>
              </div>
              <div className="home-hero__widget">
                <p className="home-hero__widget-title">Ferme liée</p>
                <p className="home-hero__widget-value">
                  <span className="home-hero__scroll-wrap">
                    <span className="home-hero__scroll">{farm?.name || 'À créer'}</span>
                  </span>
                </p>
                <p className="home-hero__widget-meta">Statut : {farm?.state || '—'}</p>
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
              <ChevronLeft size={20} />
            </button>
            <button
              type="button"
              className="carousel-btn"
              onClick={nextSlide}
              disabled={carouselIndex >= maxIndex}
              aria-label="Suivant"
            >
              <ChevronRight size={20} />
            </button>
          </div>
        </div>
        <div className="home-carousel">
          <div
            className="home-carousel-track"
            style={{ transform: `translateX(-${carouselIndex * (100 / visibleBetails)}%)` }}
          >
            {carouselBetails.map(betail => (
              <div key={betail.id} className="betail-card">
                <button type="button" className="betail-like" aria-label={`Like ${betail.name}`}>
                  <Heart size={16} />
                  <span>{betail.likes ?? 0}</span>
                </button>
                <div className="betail-avatar" style={{ backgroundImage: `url(${betail.img})`, backgroundSize: 'cover', backgroundPosition: 'center' }}>
                  <img src={betail.img} alt={betail.name} onError={handleImgError} />
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
          <h3 className="home-podium-title">Podium des bétails les plus likés</h3>
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
                  <div className="podium-rank">{rank}</div>
                  <div className="podium-info">
                    <p className="podium-name">{betail.name}</p>
                    <p className="podium-meta">{betail.matricule}</p>
                    <p className="podium-likes"><Heart size={14} /> {betail.likes ?? 0}</p>
                  </div>
                </div>
              );
            })}
          </div>
          <div className="home-podium-decor" aria-hidden="true">
            <img className="gupna gupna-a" src={gupna1} alt="" />
            <img className="gupna gupna-c" src={gupna3} alt="" />
            <img className="gupna gupna-d" src={gupna4} alt="" />
            <img className="gupna gupna-f" src={gupna6} alt="" />
            <img className="gupna gupna-h" src={gupna8} alt="" />
            <img className="gupna gupna-i" src={gupna9} alt="" />
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

            <div className="home-meeting-card__open-hint">Ouvrir le GCE</div>
          </div>

          <div className="home-weekly-ship__avatars-row" aria-hidden="true">
            {(weeklyShippingQuery.data?.days || []).map((day) => (
              <div key={`${day.id}-avatars`} className="home-weekly-ship__avatars-cell">
                <span className="home-weekly-ship__avatars">
                  {day.avatars.slice(0, 3).map((avatar) => (
                    <span key={avatar.id} className="home-weekly-ship__avatar" title={avatar.name}>
                      {avatar.avatarUrl ? <img src={avatar.avatarUrl} alt="" loading="lazy" decoding="async" /> : <span>{avatar.name[0]?.toUpperCase() || '?'}</span>}
                    </span>
                  ))}
                  {day.avatars.length > 3 ? <span className="home-weekly-ship__avatar is-more">+{day.avatars.length - 3}</span> : null}
                </span>
              </div>
            ))}
          </div>
        </button>

        <div className="home-card">
          <div className="home-card__header">
            <span className="home-chip purple">Ferme</span>
            <span className="home-chip soft">{farmStats.farmState ?? farm?.state ?? '—'}</span>
          </div>
          <div className="home-card__content">
            <p>Ferme: <strong>{farmStats.farmName ?? farm?.name ?? '—'}</strong></p>
            <p>Bétails : <strong>{typeof farmStats.betailCount === 'number' ? farmStats.betailCount : '—'}</strong></p>
            <p>Statut : <strong>{farmStats.farmState ?? farm?.state ?? '—'}</strong></p>
            <p>Ta ferme est prête. Tu pourras bientôt suivre les betails, stocks et équipes.</p>
            <div className="home-stats">
              <div className="home-stat">
                <span className="home-stat__value">{farmStats.farmId ?? profile?.farm_id ?? '—'}</span>
                <span className="home-stat__label">Ferme ID</span>
              </div>
              <div className="home-stat">
                <span className="home-stat__value">{typeof farmStats.betailCount === 'number' ? farmStats.betailCount : '—'}</span>
                <span className="home-stat__label">Bétails</span>
              </div>
              <div className="home-stat">
                <span className="home-stat__value">—</span>
                <span className="home-stat__label">Badges</span>
              </div>
            </div>
          </div>
        </div>

        <div className="home-card">
          <div className="home-card__header">
            <span className="home-chip blue">Actions rapides</span>
          </div>
          <div className="home-actions-list">
            <button type="button" className="home-action" onClick={() => navigate('/betail-maker')}>
              Ajouter un nouveau bétail
              <span aria-hidden>→</span>
            </button>
            <button type="button" className="home-action" onClick={() => navigate('/')}
            >
              Revenir à l’accueil public
              <span aria-hidden>→</span>
            </button>
            <button type="button" className="home-action" disabled>
              Gérer la ferme (bientôt)
              <span aria-hidden>→</span>
            </button>
          </div>
        </div>
      </div>

      <div className="home-footer">
        <div className="home-footer__left">
          <p className="home-footer__title">Besoin d’aide ?</p>
          <p className="home-footer__text">Support et onboarding arrivent très vite. En attendant, explore et donne-nous ton feedback.</p>
        </div>
        <button
          type="button"
          className="home-btn ghost"
          onClick={async () => {
            await supabase.auth.signOut();
            window.location.reload();
          }}
        >
          Déconnexion
        </button>
      </div>
    </div>
  );
}

export default FarmGestion_Home_Mere;
