import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Gavel } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../authentification/supabaseClient';
import defaultProfileUser from '../../assets/defaut_profile_user.png';
import ProfileAvatarImage from '../utils/ProfileAvatarImage';
import './HomeAuctionBanner.css';

const FIVE_MINUTES_MS = 5 * 60 * 1000;
const AUCTION_BANNER_SNAPSHOT_KEY = ['home', 'auction-banner-snapshot'];

const normalizeSnapshot = (payload) => {
  if (!payload) return { session: null, slots: [] };
  if (payload.session !== undefined && Array.isArray(payload.slots)) return payload;
  if (Array.isArray(payload) && payload.length) return normalizeSnapshot(payload[0]);
  if (payload.data && typeof payload.data === 'object') return normalizeSnapshot(payload.data);
  return { session: null, slots: [] };
};

const formatDuration = (milliseconds) => {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
};

const formatMoney = (value) => new Intl.NumberFormat('fr-FR').format(Math.max(0, Math.round(Number(value) || 0)));

function HomeAuctionBanner() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [now, setNow] = useState(() => Date.now());
  const openingRequestRef = useRef('');
  const realtimeSyncTimerRef = useRef(null);

  const configQuery = useQuery({
    queryKey: ['home', 'auction-banner-config'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('auction_config_reborn')
        .select('homepage_messages_enabled,min_bid_start,winner_announcement_enabled')
        .eq('id', true)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    staleTime: 30_000,
  });

  const snapshotQuery = useQuery({
    queryKey: AUCTION_BANNER_SNAPSHOT_KEY,
    enabled: Boolean(configQuery.data?.homepage_messages_enabled),
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_active_auction_snapshot_reborn');
      if (error) throw error;
      return normalizeSnapshot(data);
    },
    staleTime: 3_000,
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  });

  const winnerQuery = useQuery({
    queryKey: ['home', 'auction-winner-announcement'],
    enabled: Boolean(configQuery.data?.winner_announcement_enabled),
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_latest_auction_winner_announcement_reborn');
      if (error) throw error;
      return data || { active: false };
    },
    refetchInterval: 30_000,
  });

  useEffect(() => {
    const timerId = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timerId);
  }, []);

  useEffect(() => {
    if (!configQuery.data?.homepage_messages_enabled && !configQuery.data?.winner_announcement_enabled) return undefined;
    const activeSessionId = String(snapshotQuery.data?.session?.id || '');
    const refresh = () => {
      queryClient.invalidateQueries({ queryKey: AUCTION_BANNER_SNAPSHOT_KEY });
      queryClient.invalidateQueries({ queryKey: ['home', 'auction-winner-announcement'] });
    };
    const syncAfterRealtimeBurst = () => {
      if (realtimeSyncTimerRef.current) window.clearTimeout(realtimeSyncTimerRef.current);
      realtimeSyncTimerRef.current = window.setTimeout(refresh, 120);
    };
    const applyBidImmediately = (payload) => {
      const bid = payload?.new;
      if (!bid?.slot_id || !Number.isFinite(Number(bid.amount))) {
        syncAfterRealtimeBurst();
        return;
      }

      queryClient.setQueryData(AUCTION_BANNER_SNAPSHOT_KEY, (current) => {
        if (!current?.slots) return current;
        return {
          ...current,
          slots: current.slots.map((slot) => {
            if (String(slot.slot_id) !== String(bid.slot_id)) return slot;
            const optimisticBid = {
              amount: Number(bid.amount),
              bidder_user_id: bid.bidder_user_id,
              bidder_username: 'Mise en direct',
              bidder_avatar_url: null,
              created_at: bid.created_at,
            };
            const previousHistory = Array.isArray(slot.latest_two_bids) ? slot.latest_two_bids : [];
            return {
              ...slot,
              top_bid: optimisticBid,
              latest_two_bids: [optimisticBid, ...previousHistory].slice(0, 2),
            };
          }),
        };
      });
      syncAfterRealtimeBurst();
    };
    let channel = supabase
      .channel(`home-auction-banner-live-${activeSessionId || 'waiting'}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'auction_sessions_reborn' }, refresh);

    if (activeSessionId) {
      const sessionFilter = `session_id=eq.${activeSessionId}`;
      channel = channel
        .on('postgres_changes', { event: '*', schema: 'public', table: 'auction_slots_reborn', filter: sessionFilter }, refresh)
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'auction_bids_reborn', filter: sessionFilter }, applyBidImmediately);
    }

    channel.subscribe();
    return () => {
      if (realtimeSyncTimerRef.current) window.clearTimeout(realtimeSyncTimerRef.current);
      supabase.removeChannel(channel);
    };
  }, [configQuery.data?.homepage_messages_enabled, configQuery.data?.winner_announcement_enabled, queryClient, snapshotQuery.data?.session?.id]);

  const session = snapshotQuery.data?.session || null;
  const slots = useMemo(
    () => [...(snapshotQuery.data?.slots || [])].sort((a, b) => Number(a.slot_index) - Number(b.slot_index)),
    [snapshotQuery.data?.slots],
  );
  const isWaiting = session?.status === 'ready_delay';
  const isOpen = session?.status === 'open';
  const targetTime = new Date(isWaiting ? session?.open_at : session?.end_at || 0).getTime();
  const remainingMs = Number.isFinite(targetTime) ? targetTime - now : 0;
  const isInsideAnnouncementWindow = isWaiting && remainingMs <= FIVE_MINUTES_MS;
  const shouldDisplay = Boolean(
    configQuery.data?.homepage_messages_enabled
      && session
      && slots.length
      && (isOpen || isInsideAnnouncementWindow),
  );
  const winnerAnnouncement = winnerQuery.data?.active ? winnerQuery.data : null;

  useEffect(() => {
    const sessionId = String(session?.id || '');
    if (!sessionId || !isWaiting || remainingMs > 0 || openingRequestRef.current === sessionId) return;
    openingRequestRef.current = sessionId;
    void supabase.rpc('open_due_auction_session_reborn', { p_session_id: session.id })
      .then(({ data, error }) => {
        if (error || !data?.success) openingRequestRef.current = '';
        queryClient.invalidateQueries({ queryKey: AUCTION_BANNER_SNAPSHOT_KEY });
      });
  }, [isWaiting, queryClient, remainingMs, session]);

  if (!shouldDisplay && !winnerAnnouncement) return null;

  if (!shouldDisplay && winnerAnnouncement) {
    return (
      <section
        className="home-auction-banner home-auction-banner--winner"
        role="button"
        tabIndex={0}
        onClick={() => navigate('/encheres')}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') navigate('/encheres');
        }}
      >
        <Gavel className="home-auction-banner__gavel is-left" size={27} aria-hidden="true" />
        <div className="home-auction-banner__winner-copy">
          <span>Dernier grand gagnant</span>
          <strong>{winnerAnnouncement.winner_username}</strong>
        </div>
        <div className="home-auction-banner__winner-person">
          <ProfileAvatarImage
            avatarUrl={winnerAnnouncement.winner_avatar_url}
            alt={`Photo de profil de ${winnerAnnouncement.winner_username || 'la personne gagnante'}`}
          />
        </div>
        <div className="home-auction-banner__winner-betail">
          <img src={winnerAnnouncement.betail_avatar_url || defaultProfileUser} alt="" />
          <div>
            <strong>{winnerAnnouncement.betail_name}</strong>
            <span>{formatMoney(winnerAnnouncement.winning_amount)} 💸</span>
          </div>
        </div>
        <span className="home-auction-banner__cta">Voir le résultat →</span>
        <Gavel className="home-auction-banner__gavel is-right" size={27} aria-hidden="true" />
      </section>
    );
  }

  const openingPrice = configQuery.data?.min_bid_start || 200;
  const openAuctions = () => navigate('/encheres');

  return (
    <section
      className={`home-auction-banner ${isOpen ? 'is-live' : 'is-waiting'}`}
      role="button"
      tabIndex={0}
      onClick={openAuctions}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          openAuctions();
        }
      }}
      aria-label="Ouvrir les enchères en direct"
    >
      <Gavel className="home-auction-banner__gavel is-left" size={27} aria-hidden="true" />

      <div className="home-auction-banner__status">
        <span className="home-auction-banner__live-dot" aria-hidden="true" />
        <div>
          <strong>{isOpen ? 'Enchères en cours' : 'Enchères bientôt ouvertes'}</strong>
          <span>{isOpen ? 'Fin dans' : 'Ouverture dans'} {formatDuration(remainingMs)}</span>
        </div>
      </div>

      <div className="home-auction-banner__lots" aria-label="Bétails en enchère">
        {slots.slice(0, 5).map((slot) => {
          const history = Array.isArray(slot.latest_two_bids) ? slot.latest_two_bids.slice(0, 2) : [];
          return (
            <div className="home-auction-banner__lot" key={slot.slot_id}>
              <div className="home-auction-banner__lot-main">
                <img className="home-auction-banner__lot-avatar" src={slot.betail_avatar_url || defaultProfileUser} alt="" />
                <div>
                  <strong>{slot.betail_name || 'Bétail'}</strong>
                  <span>{slot.top_bid?.amount ? `${formatMoney(slot.top_bid.amount)} 💸` : `Départ ${formatMoney(openingPrice)} 💸`}</span>
                </div>
              </div>
              <div className="home-auction-banner__lot-history">
                {history.length ? history.map((bid, index) => (
                  <span key={`${slot.slot_id}-${bid.bidder_user_id || 'bid'}-${bid.created_at || index}`}>
                    <ProfileAvatarImage
                      avatarUrl={bid.bidder_avatar_url}
                      alt={`Photo de profil de ${bid.bidder_username || 'l’enchérisseur'}`}
                      loading="lazy"
                    />
                    <small>{bid.bidder_username || 'Enchérisseur'}</small>
                    <strong>{formatMoney(bid.amount)} 💸</strong>
                  </span>
                )) : (
                  <small>{isOpen ? 'Aucune offre' : 'Mises bientôt ouvertes'}</small>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <span className="home-auction-banner__cta">Voir en direct →</span>
      <Gavel className="home-auction-banner__gavel is-right" size={27} aria-hidden="true" />

    </section>
  );
}

export default HomeAuctionBanner;
