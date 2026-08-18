import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Timer, Gavel, Trophy, PlusCircle, ChevronUp } from 'lucide-react';
import confetti from 'canvas-confetti';
import { useAuth } from '../authentification/AuthContext';
import { supabase } from '../authentification/supabaseClient';
import defaultProfileUser from '../../assets/defaut_profile_user.png';
import mereSampleImage from '../../assets/mere_sample.png';
import bidSuccessSound from '../../assets/sounds/SE_SY_SURF_TUTORIAL_OK.wav';
import auctionStartSound from '../../assets/sounds/nsmbwiiEnemyBattleStart.wav';
import './AuctionsPage.css';

const MIN_BETAIL_AGE_DAYS = 14;
const BID_STEPS = [1, 2, 3, 5];
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || '';

const buildAvatarCandidates = (value) => {
  const raw = String(value || '').trim();
  if (!raw) return [];

  const candidates = [raw];
  if (!SUPABASE_URL) return candidates;

  if (raw.startsWith('/storage/v1/object/public/')) {
    candidates.push(`${SUPABASE_URL}${raw}`);
  } else if (raw.startsWith('storage/v1/object/public/')) {
    candidates.push(`${SUPABASE_URL}/${raw}`);
  } else if (raw.startsWith('/')) {
    candidates.push(`${SUPABASE_URL}${raw}`);
    candidates.push(`${SUPABASE_URL}/${raw.replace(/^\/+/, '')}`);
  } else if (!raw.startsWith('http://') && !raw.startsWith('https://')) {
    if (raw.includes('/')) {
      candidates.push(`${SUPABASE_URL}/storage/v1/object/public/${raw}`);
    } else {
      candidates.push(`${SUPABASE_URL}/storage/v1/object/public/avatars/${raw}`);
    }
  }

  // Une ancienne URL signée peut avoir expiré : tente aussi son équivalent public.
  const avatarPathMatch = raw.match(/\/storage\/v1\/object\/(?:public|sign|authenticated)\/avatars\/([^?#]+)/i);
  if (avatarPathMatch?.[1]) {
    candidates.push(`${SUPABASE_URL}/storage/v1/object/public/avatars/${avatarPathMatch[1]}`);
  }

  return Array.from(new Set(candidates));
};

function AuctionAvatar({ avatarUrl, alt = '', loading = 'lazy', className }) {
  const candidates = useMemo(() => buildAvatarCandidates(avatarUrl), [avatarUrl]);
  const [failureState, setFailureState] = useState({ avatarUrl, index: 0 });
  const candidateIndex = failureState.avatarUrl === avatarUrl ? failureState.index : 0;

  const src = candidates[candidateIndex] || defaultProfileUser;

  return (
    <img
      className={className}
      src={src}
      alt={alt}
      loading={loading}
      onError={() => {
        if (candidateIndex < candidates.length - 1) {
          setFailureState({ avatarUrl, index: candidateIndex + 1 });
          return;
        }
        if (src !== defaultProfileUser) setFailureState({ avatarUrl, index: candidates.length });
      }}
    />
  );
}

const showToast = (type, message) => {
  window.dispatchEvent(new CustomEvent('farmgestion-toast', {
    detail: { type, message },
  }));
};

const formatReason = (value) => {
  const reason = String(value || 'UNKNOWN').trim().toUpperCase();
  const labels = {
    NOT_AUTHENTICATED: 'Tu dois être connecté.',
    SESSION_NOT_FOUND: 'Session introuvable.',
    SESSION_NOT_FILLING: 'La session ne prend plus de propositions.',
    SESSION_EXPIRED: 'La session a expiré.',
    ALREADY_SUBMITTED_THIS_SESSION: 'Tu as déjà proposé un bétail dans cette session.',
    BETAIL_NOT_OWNED: 'Ce bétail ne t’appartient pas.',
    BETAIL_NOT_VISIBLE: 'Le bétail doit être visible.',
    BETAIL_NOT_PREMIUM: 'Seuls les bétails premium sont éligibles.',
    BETAIL_ALREADY_LOCKED: 'Ce bétail est déjà verrouillé.',
    BETAIL_TOO_RECENT: 'Le bétail doit avoir au moins 14 jours.',
    BETAIL_IN_SHIPPING: 'Ce bétail est déjà en expédition.',
    SLOTS_FULL: 'Tous les slots sont déjà pris.',
    SESSION_NOT_OPEN: 'Les enchères ne sont pas ouvertes.',
    SESSION_ENDED: 'La session est terminée.',
    SLOT_NOT_FOUND: 'Slot introuvable.',
    SLOT_NOT_ACTIVE: 'Ce slot ne prend plus d’enchères.',
    CANNOT_BID_OWN_BETAIL: 'Tu ne peux pas miser sur ton propre bétail.',
    PROFILE_NOT_FOUND: 'Profil introuvable.',
    INSUFFICIENT_MIN_MONEY: 'Tu dois avoir au moins 500 pour participer.',
    INSUFFICIENT_FUNDS_FOR_ENGAGED_TOTAL: 'Ton total engagé dépasse ton solde.',
  };
  return labels[reason] || `Action refusée (${reason.toLowerCase()}).`;
};

const formatSessionStatus = (status) => {
  const normalized = String(status || '').toLowerCase();
  if (normalized === 'filling') return 'Selection des bétails';
  if (normalized === 'ready_delay') return 'Ouverture en attente';
  if (normalized === 'open') return 'Enchères ouvertes';
  if (normalized === 'closed') return 'Session terminée';
  if (normalized === 'expired') return 'Session expirée';
  if (normalized === 'cancelled') return 'Session annulée';
  return 'Session inconnue';
};

const toNumber = (value, fallback = 0) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

const formatMoney = (value) => new Intl.NumberFormat('fr-FR').format(Math.max(0, Math.round(toNumber(value, 0))));

const getNextBidAmount = (currentAmount, multiplier, config) => {
  const current = Math.max(0, toNumber(currentAmount, 0));
  if (!current) return toNumber(config?.min_bid_start, 200);

  const tier1Limit = toNumber(config?.inc_tier1_limit, 5000);
  const tier2Limit = toNumber(config?.inc_tier2_limit, 20000);
  const baseStep = current < tier1Limit
    ? toNumber(config?.inc_tier1_step, 200)
    : current < tier2Limit
      ? toNumber(config?.inc_tier2_step, 500)
      : toNumber(config?.inc_tier3_step, 1000);
  return current + (baseStep * Math.max(1, toNumber(multiplier, 1)));
};

const celebrateBid = () => {
  const audio = new Audio(bidSuccessSound);
  audio.volume = 0.35;
  audio.play().catch(() => {});
  confetti({
    particleCount: 18,
    spread: 42,
    startVelocity: 18,
    gravity: 0.9,
    scalar: 0.65,
    ticks: 90,
    origin: { x: 0.5, y: 0.72 },
    colors: ['#7b5de3', '#f5b942', '#ff8fac', '#ffffff'],
    disableForReducedMotion: true,
  });
};

function AnimatedBidPrice({ amount, fallback }) {
  if (!amount) return fallback;
  return (
    <span key={amount} className="auction-price-roll">
      {formatMoney(amount)} 💸
    </span>
  );
}

const normalizeSnapshot = (payload) => {
  if (!payload) return { session: null, slots: [] };
  if (payload.session !== undefined && Array.isArray(payload.slots)) return payload;
  if (Array.isArray(payload) && payload.length > 0) return normalizeSnapshot(payload[0]);
  if (payload.data && typeof payload.data === 'object') return normalizeSnapshot(payload.data);
  return { session: null, slots: [] };
};

const formatDuration = (ms) => {
  const safe = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
};

function AuctionsPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const [pickerSlotIndex, setPickerSlotIndex] = useState(null);
  const [pickerSearch, setPickerSearch] = useState('');
  const [bidStepBySlot, setBidStepBySlot] = useState({});
  const [errorMessage, setErrorMessage] = useState('');
  const [nowTick, setNowTick] = useState(() => Date.now());
  const [isOpeningCelebrationActive, setIsOpeningCelebrationActive] = useState(false);
  const [winnerCelebration, setWinnerCelebration] = useState(null);
  const observedReadySessionRef = useRef('');
  const openingRequestSessionRef = useRef('');
  const celebratedSessionRef = useRef('');
  const openingCelebrationTimerRef = useRef(null);
  const lastObservedOpenSessionRef = useRef('');
  const celebratedWinnerSessionRef = useRef('');
  const winnerCelebrationTimerRef = useRef(null);

  const profileQuery = useQuery({
    queryKey: ['auctions', 'profile', user?.id],
    enabled: Boolean(user?.id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('users_profiles')
        .select('id, username, money')
        .eq('id', user.id)
        .maybeSingle();
      if (error) throw error;
      return data || null;
    },
    staleTime: 20_000,
  });

  const snapshotQuery = useQuery({
    queryKey: ['auctions', 'snapshot'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_active_auction_snapshot_reborn');
      if (error) throw error;
      return normalizeSnapshot(data);
    },
    staleTime: 3_000,
    refetchOnWindowFocus: true,
  });

  const configQuery = useQuery({
    queryKey: ['auctions', 'public-config'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('auction_config_reborn')
        .select('min_bid_start, inc_tier1_limit, inc_tier1_step, inc_tier2_limit, inc_tier2_step, inc_tier3_step')
        .eq('id', true)
        .maybeSingle();
      if (error) throw error;
      return data || null;
    },
    staleTime: 60_000,
  });

  const winnerAnnouncementQuery = useQuery({
    queryKey: ['auctions', 'winner-announcement'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_latest_auction_winner_announcement_reborn');
      if (error) throw error;
      return data || { active: false };
    },
    refetchInterval: 15_000,
  });

  const eligibleBetailsQuery = useQuery({
    queryKey: ['auctions', 'eligible-betails', user?.id],
    enabled: Boolean(user?.id),
    queryFn: async () => {
      const { data: rows, error } = await supabase
        .from('betails')
        .select('id, name, matricule, avatar_url, created_at, premium, visible, auction_locked')
        .eq('owner_id', user.id)
        .eq('premium', true)
        .eq('visible', true)
        .eq('auction_locked', false)
        .order('created_at', { ascending: true });
      if (error) throw error;

      const betails = Array.isArray(rows) ? rows : [];
      if (!betails.length) return [];

      const ids = betails.map((item) => item.id).filter(Boolean);
      const { data: shippingRows, error: shippingError } = await supabase
        .from('shipping')
        .select('betail_id, status')
        .in('betail_id', ids)
        .eq('status', 'scheduled');

      if (shippingError) throw shippingError;

      const shippingSet = new Set((shippingRows || []).map((item) => String(item.betail_id || '')));
      const now = Date.now();

      return betails.filter((item) => {
        const createdAt = new Date(item.created_at || '').getTime();
        const ageMs = Number.isFinite(createdAt) ? now - createdAt : 0;
        const ageDays = ageMs / (1000 * 60 * 60 * 24);
        return ageDays >= MIN_BETAIL_AGE_DAYS && !shippingSet.has(String(item.id || ''));
      });
    },
    staleTime: 30_000,
  });

  const joinSlotMutation = useMutation({
    mutationFn: async ({ sessionId, betailId }) => {
      const { data, error } = await supabase.rpc('auction_join_slot_reborn', {
        p_session_id: sessionId,
        p_betail_id: betailId,
      });
      if (error) throw error;
      if (!data?.success) throw new Error(String(data?.reason || 'UNKNOWN'));
      return data;
    },
    onSuccess: () => {
      setErrorMessage('');
      showToast('success', 'Ton bétail a été placé en enchère.');
      setPickerSearch('');
      setIsPickerOpen(false);
      setPickerSlotIndex(null);
      queryClient.invalidateQueries({ queryKey: ['auctions'] });
    },
    onError: (error) => {
      setErrorMessage(formatReason(error?.message));
    },
  });

  const placeBidMutation = useMutation({
    mutationFn: async ({ sessionId, slotId, step }) => {
      const { data, error } = await supabase.rpc('auction_place_bid_reborn', {
        p_session_id: sessionId,
        p_slot_id: slotId,
        p_step_multiplier: step,
      });
      if (error) throw error;
      if (!data?.success) throw new Error(String(data?.reason || 'UNKNOWN'));
      return data;
    },
    onSuccess: () => {
      setErrorMessage('');
      showToast('success', 'Enchère enregistrée.');
      celebrateBid();
      queryClient.invalidateQueries({ queryKey: ['auctions'] });
    },
    onError: (error) => {
      setErrorMessage(formatReason(error?.message));
    },
  });

  const session = snapshotQuery.data?.session || null;
  const slots = useMemo(
    () => (Array.isArray(snapshotQuery.data?.slots) ? snapshotQuery.data.slots : []),
    [snapshotQuery.data],
  );

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setNowTick(Date.now());
    }, 1000);
    return () => window.clearInterval(intervalId);
  }, []);

  useEffect(() => {
    const sessionId = String(session?.id || '');
    if (!sessionId) return undefined;

    const openingAt = new Date(session?.open_at || 0).getTime();
    const remainingMs = openingAt - nowTick;

    if (session.status === 'ready_delay' && remainingMs > 0) {
      observedReadySessionRef.current = sessionId;
      return undefined;
    }

    if (session.status === 'ready_delay' && remainingMs <= 0) {
      if (openingRequestSessionRef.current !== sessionId) {
        openingRequestSessionRef.current = sessionId;
        void supabase.rpc('open_due_auction_session_reborn', {
          p_session_id: session.id,
        }).then(({ data, error }) => {
          if (error || !data?.success) {
            openingRequestSessionRef.current = '';
          }
          queryClient.invalidateQueries({ queryKey: ['auctions', 'snapshot'] });
        });
      }
      return undefined;
    }

    const hasJustOpened = session.status === 'open';
    const wasObservedWaiting = observedReadySessionRef.current === sessionId;
    const hasAlreadyCelebrated = celebratedSessionRef.current === sessionId;

    if (!hasJustOpened || !wasObservedWaiting || hasAlreadyCelebrated) return undefined;

    celebratedSessionRef.current = sessionId;
    setIsOpeningCelebrationActive(true);

    const audio = new Audio(auctionStartSound);
    audio.volume = 0.55;
    audio.play().catch(() => {});

    if (openingCelebrationTimerRef.current) {
      window.clearTimeout(openingCelebrationTimerRef.current);
    }
    openingCelebrationTimerRef.current = window.setTimeout(() => {
      setIsOpeningCelebrationActive(false);
      openingCelebrationTimerRef.current = null;
    }, 1900);

    return undefined;
  }, [nowTick, queryClient, session]);

  useEffect(() => () => {
    if (openingCelebrationTimerRef.current) {
      window.clearTimeout(openingCelebrationTimerRef.current);
    }
    if (winnerCelebrationTimerRef.current) {
      window.clearTimeout(winnerCelebrationTimerRef.current);
    }
  }, []);

  useEffect(() => {
    if (session?.status === 'open' && session.id) {
      lastObservedOpenSessionRef.current = String(session.id);
    }

    const announcement = winnerAnnouncementQuery.data;
    const announcementSessionId = String(announcement?.session_id || '');
    if (!announcement?.active
      || !announcementSessionId
      || lastObservedOpenSessionRef.current !== announcementSessionId
      || celebratedWinnerSessionRef.current === announcementSessionId) return;

    celebratedWinnerSessionRef.current = announcementSessionId;
    setWinnerCelebration(announcement);
    confetti({
      particleCount: 90,
      spread: 78,
      startVelocity: 32,
      origin: { x: 0.5, y: 0.45 },
      colors: ['#ffd166', '#ff9f43', '#a788ff', '#ffffff'],
      disableForReducedMotion: true,
    });
    winnerCelebrationTimerRef.current = window.setTimeout(() => {
      setWinnerCelebration(null);
      winnerCelebrationTimerRef.current = null;
    }, 5200);
  }, [session, winnerAnnouncementQuery.data]);

  useEffect(() => {
    const channel = supabase
      .channel(`auctions-live-${user?.id || 'anon'}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'auction_sessions_reborn' }, () => {
        queryClient.invalidateQueries({ queryKey: ['auctions', 'snapshot'] });
        queryClient.invalidateQueries({ queryKey: ['auctions', 'winner-announcement'] });
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'auction_slots_reborn' }, () => {
        queryClient.invalidateQueries({ queryKey: ['auctions', 'snapshot'] });
        queryClient.invalidateQueries({ queryKey: ['auctions', 'eligible-betails', user?.id] });
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'auction_bids_reborn' }, () => {
        queryClient.invalidateQueries({ queryKey: ['auctions', 'snapshot'] });
        queryClient.invalidateQueries({ queryKey: ['auctions', 'profile', user?.id] });
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [queryClient, user?.id]);

  const countdownLabel = useMemo(() => {
    if (!session) return null;
    const now = nowTick;
    if (session.status === 'filling') {
      return { label: 'Fin de remplissage', value: formatDuration(Math.max(0, new Date(session.fill_deadline_at || 0).getTime() - now)) };
    }
    if (session.status === 'ready_delay') {
      return { label: 'Ouverture des encheres', value: formatDuration(Math.max(0, new Date(session.open_at || 0).getTime() - now)) };
    }
    if (session.status === 'open') {
      return { label: 'Fin des encheres', value: formatDuration(Math.max(0, new Date(session.end_at || 0).getTime() - now)) };
    }
    return null;
  }, [session, nowTick]);

  const canJoin = session?.status === 'filling';
  const currentMoney = toNumber(profileQuery.data?.money, 0);
  const hasSubmittedInCurrentSession = useMemo(
    () => slots.some((slot) => String(slot?.seller_user_id || '') === String(user?.id || '')),
    [slots, user?.id],
  );

  const slotsByIndex = useMemo(() => {
    const map = new Map();
    slots.forEach((slot) => {
      map.set(Number(slot.slot_index), slot);
    });
    return map;
  }, [slots]);

  const centeredSlots = useMemo(() => {
    if (!session?.slots_count) return [];
    return Array.from({ length: session.slots_count }, (_, index) => {
      const slotIndex = index + 1;
      return {
        slotIndex,
        slot: slotsByIndex.get(slotIndex) || null,
      };
    }).filter((entry) => session.status !== 'open' || entry.slot);
  }, [session, slotsByIndex]);

  const highestBidAmount = useMemo(
    () => slots.reduce((highest, slot) => Math.max(highest, toNumber(slot?.top_bid?.amount, 0)), 0),
    [slots],
  );
  const hasDifferentBidAmounts = useMemo(() => {
    const amounts = slots.map((slot) => toNumber(slot?.top_bid?.amount, 0));
    return amounts.some((amount) => amount !== highestBidAmount);
  }, [highestBidAmount, slots]);

  const filteredEligibleBetails = useMemo(() => {
    const rows = Array.isArray(eligibleBetailsQuery.data) ? eligibleBetailsQuery.data : [];
    const needle = String(pickerSearch || '').trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((item) => {
      const text = `${item?.name || ''} ${item?.matricule || ''}`.toLowerCase();
      return text.includes(needle);
    });
  }, [eligibleBetailsQuery.data, pickerSearch]);

  const openPicker = (slotIndex) => {
    if (!canJoin || hasSubmittedInCurrentSession) return;
    setPickerSlotIndex(slotIndex);
    setPickerSearch('');
    setIsPickerOpen(true);
  };

  const closePicker = () => {
    setIsPickerOpen(false);
    setPickerSlotIndex(null);
  };

  const getOpeningTextForSlot = () => {
    if (!session) return '';
    if (session.status === 'ready_delay') {
      return `Ouverture dans ${formatDuration(Math.max(0, new Date(session.open_at || 0).getTime() - nowTick))}`;
    }
    if (session.status === 'filling') {
      return `Selection : ${formatDuration(Math.max(0, new Date(session.fill_deadline_at || 0).getTime() - nowTick))}`;
    }
    return `Prix de départ : ${formatMoney(configQuery.data?.min_bid_start || 200)} 💸`;
  };
  const latestWinner = winnerAnnouncementQuery.data?.active ? winnerAnnouncementQuery.data : null;

  return (
    <main className="auctions-page">
      <section className="auctions-hero">
        <div className="auctions-heading">
          <img className="auctions-heading-image" src={mereSampleImage} alt="" aria-hidden="true" />
          <div>
            <h1>Enchères FarmGestion</h1>
            <p>
              Propose un de tes bétails premium, puis mise en direct sur les meilleurs profils.
            </p>
          </div>
        </div>
        <div className="auctions-header-status">
          {session && countdownLabel ? (
            <article className="auctions-chip timer">
              <Timer size={15} />
              <span>{countdownLabel.label}: <strong>{countdownLabel.value}</strong></span>
              <span className="auctions-chip-divider" aria-hidden="true" />
              <span>Solde: <strong>{formatMoney(currentMoney)} 💸</strong></span>
            </article>
          ) : null}
          {session ? (
            <article className={`auctions-chip auctions-status-chip ${session.status === 'filling' ? 'filling-live' : ''}`}>
              <>
                <span>Session: <strong className={session.status === 'filling' ? 'filling-live__label' : ''}>{formatSessionStatus(session.status)}</strong></span>
                <span className="auctions-chip-divider" aria-hidden="true" />
                <span>Slots: <strong>{slots.length}/{session.slots_count}</strong></span>
              </>
            </article>
          ) : null}
        </div>
      </section>

      {errorMessage ? <p className="auctions-feedback is-error">{errorMessage}</p> : null}

      <section className="auctions-grid centered-slots">
        {session && centeredSlots.length ? (
          centeredSlots.map((entry) => {
            const slot = entry.slot;
            if (!slot) {
              const disabled = !canJoin || hasSubmittedInCurrentSession || joinSlotMutation.isPending;
              return (
                <article key={`empty-slot-${entry.slotIndex}`} className="auction-card auction-card--empty-slot">
                  <button
                    type="button"
                    className="auction-slot-placeholder"
                    onClick={() => openPicker(entry.slotIndex)}
                    disabled={disabled}
                  >
                    <PlusCircle size={22} />
                    <span>Slot {entry.slotIndex}</span>
                    <small>
                      {hasSubmittedInCurrentSession
                        ? 'Tu as déjà proposé un bétail.'
                        : canJoin
                          ? 'Disponible - cliquer pour choisir'
                          : 'Indisponible'}
                    </small>
                  </button>
                </article>
              );
            }

            const topBid = slot.top_bid || null;
            const latestTwo = Array.isArray(slot.latest_two_bids) ? slot.latest_two_bids : [];
            const isOwnSlot = String(slot.seller_user_id || '') === String(user?.id || '');
            const slotStep = Math.max(1, toNumber(bidStepBySlot[slot.slot_id], 1));
            const nextBidAmount = getNextBidAmount(topBid?.amount, slotStep, configQuery.data);
            const isHighestBid = highestBidAmount > 0
              && hasDifferentBidAmounts
              && toNumber(topBid?.amount, 0) === highestBidAmount;

            return (
              <article
                key={slot.slot_id}
                className={`auction-card ${isHighestBid ? 'is-highest-bid' : ''} ${isOpeningCelebrationActive ? 'auction-card--opening-flash' : ''}`}
              >
                <header className="auction-card__head">
                  <span className="auction-card__slot">Slot #{slot.slot_index}</span>
                  <span className="auction-card__status">{slot.status === 'listed' ? 'Publié' : slot.status}</span>
                </header>

                <div className="auction-card__identity">
                  <img src={slot.betail_avatar_url || defaultProfileUser} alt="Bétail" loading="lazy" />
                  <div>
                    <h3>{slot.betail_name}</h3>
                    <p>#{slot.matricule}</p>
                    <p className="auction-card__seller">Vendeur: {slot.seller_username || 'Inconnu'}</p>
                  </div>
                </div>

                <div className="auction-card__top">
                  <p className="auction-card__top-label">
                    {session.status === 'ready_delay' ? (
                      <><Timer size={14} /> Ouverture prochaine</>
                    ) : (
                      <><Trophy size={14} /> Meilleure offre</>
                    )}
                  </p>
                  <p className="auction-card__top-value">
                    <AnimatedBidPrice
                      amount={topBid?.amount}
                      fallback={session.status === 'open'
                        ? `Prix de départ : ${formatMoney(configQuery.data?.min_bid_start || 200)} 💸`
                        : getOpeningTextForSlot()}
                    />
                  </p>
                  {topBid?.bidder_username ? (
                    <p className="auction-card__top-user">par {topBid.bidder_username}</p>
                  ) : null}
                </div>

                {session.status === 'ready_delay' ? (
                  <p className="auction-card__waiting-note">
                    Les mises ne sont pas encore ouvertes. Prépare ton offre : tu pourras enchérir dès la fin du compte à rebours.
                  </p>
                ) : null}

                {latestTwo.length ? (
                  <div className="auction-card__history">
                    <p>2 dernières enchères</p>
                    {latestTwo.map((entry, index) => (
                      <div key={`${slot.slot_id}-${index}`} className="auction-card__history-row">
                        <AuctionAvatar avatarUrl={entry?.bidder_avatar_url} />
                        <span>{entry?.bidder_username || 'Inconnu'}</span>
                        <strong>{formatMoney(entry?.amount || 0)} 💸</strong>
                      </div>
                    ))}
                  </div>
                ) : null}

                {session?.status === 'open' && slot.status === 'listed' && !isOwnSlot ? (
                  <div className="auction-card__actions">
                    <button
                      type="button"
                      className="auctions-primary auction-bid-button"
                      disabled={placeBidMutation.isPending}
                      onClick={() => {
                        if (!session?.id) return;
                        placeBidMutation.mutate({
                          sessionId: session.id,
                          slotId: slot.slot_id,
                          step: slotStep,
                        });
                      }}
                    >
                      Miser {formatMoney(nextBidAmount)} 💸
                    </button>
                    <button
                      type="button"
                      className="auction-bid-step"
                      aria-label={`Augmenter le palier, actuellement x${slotStep}`}
                      title={`Palier x${slotStep}`}
                      disabled={placeBidMutation.isPending}
                      onClick={() => {
                        const currentIndex = BID_STEPS.indexOf(slotStep);
                        const nextStep = BID_STEPS[(currentIndex + 1) % BID_STEPS.length];
                        setBidStepBySlot((current) => ({ ...current, [slot.slot_id]: nextStep }));
                      }}
                    >
                      <ChevronUp size={17} />
                      <small>x{slotStep}</small>
                    </button>
                  </div>
                ) : null}
              </article>
            );
          })
        ) : session ? (
          <p className="auctions-active-empty">Aucun bétail n’est attribué à cette session.</p>
        ) : (
          <section className={`auctions-idle-layout ${latestWinner ? 'has-winner' : ''}`}>
            <div className="auctions-empty-state">
              <div className="auctions-empty-state__visual" aria-hidden="true">
                <span className="auctions-empty-state__halo auctions-empty-state__halo--one" />
                <span className="auctions-empty-state__halo auctions-empty-state__halo--two" />
                <span className="auctions-empty-state__gavel"><Gavel size={58} strokeWidth={1.7} /></span>
              </div>
              <div className="auctions-empty-state__copy">
                <h2>Les prochaines enchères se préparent</h2>
                <p>Lorsqu’une session démarre, chacun peut proposer un bétail premium puis miser en direct sur ceux des autres éleveurs.</p>
                <p>La meilleure offre remporte le bétail. En attendant, garde un œil sur ton solde et prépare ton meilleur candidat.</p>
                <p>(L'avantage c'est que tu peux enchérir sur des bétails que tu as créés toi-même !)</p>
              </div>
            </div>
            {latestWinner ? (
              <div className="auctions-last-winner">
                <p>Dernier grand gagnant</p>
                <AuctionAvatar
                  className="auctions-last-winner__profile"
                  avatarUrl={latestWinner.winner_avatar_url}
                  loading="eager"
                />
                <h2>{latestWinner.winner_username}</h2>
                <div className="auctions-last-winner__betail">
                  <img src={latestWinner.betail_avatar_url || defaultProfileUser} alt="" />
                  <div>
                    <strong>{latestWinner.betail_name}</strong>
                    <span>#{latestWinner.betail_matricule || '—'}</span>
                    <b>{formatMoney(latestWinner.winning_amount)} 💸</b>
                  </div>
                </div>
              </div>
            ) : null}
          </section>
        )}
      </section>

      {winnerCelebration ? (
        <div className="auctions-winner-celebration" role="status" aria-live="polite">
          <span>🏆 Grand gagnant</span>
          <AuctionAvatar avatarUrl={winnerCelebration.winner_avatar_url} loading="eager" />
          <strong>{winnerCelebration.winner_username}</strong>
          <small>remporte {winnerCelebration.betail_name} pour {formatMoney(winnerCelebration.winning_amount)} 💸</small>
        </div>
      ) : null}

      {isPickerOpen ? (
        <div className="auctions-picker-backdrop" role="presentation" onClick={closePicker}>
          <section className="auctions-picker-modal" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
            <header className="auctions-picker-head">
              <div>
                <h2>Choisir un bétail pour le slot {pickerSlotIndex}</h2>
                <p>Premium, visible, non expédié, minimum 14 jours.</p>
              </div>
              <button type="button" className="auctions-picker-close" onClick={closePicker} aria-label="Fermer">
                ×
              </button>
            </header>

            <input
              className="auctions-picker-search"
              value={pickerSearch}
              onChange={(event) => setPickerSearch(event.target.value)}
              placeholder="Rechercher un bétail..."
            />

            <div className="auctions-picker-list" role="list" aria-label="Bétails éligibles">
              {filteredEligibleBetails.length ? (
                filteredEligibleBetails.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className="auctions-picker-item"
                    onClick={() => {
                      if (!session) return;
                      joinSlotMutation.mutate({ sessionId: session.id, betailId: item.id });
                    }}
                    disabled={joinSlotMutation.isPending}
                  >
                    <img src={item.avatar_url || defaultProfileUser} alt="Bétail" loading="lazy" />
                    <span className="auctions-picker-item__meta">
                      <strong>{item.name}</strong>
                      <small>#{item.matricule}</small>
                    </span>
                  </button>
                ))
              ) : (
                <p className="auctions-picker-empty">Aucun bétail éligible pour le moment.</p>
              )}
            </div>
          </section>
        </div>
      ) : null}
    </main>
  );
}

export default AuctionsPage;
