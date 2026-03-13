import { useEffect, useMemo, useState } from 'react';
import { Clock3, Coins, Crown, ShoppingBag } from 'lucide-react';
import { supabase } from '../authentification/supabaseClient';
import { useAuth } from '../authentification/AuthContext';
import badgesManifest from '../../assets/manifest.json';
import './ShopPage.css';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const BADGES_BUCKET_URL = SUPABASE_URL ? `${SUPABASE_URL}/storage/v1/object/public/badges` : '';
const RESOURCES_BUCKET_URL = SUPABASE_URL ? `${SUPABASE_URL}/storage/v1/object/public/ressources` : '';
const MILO_SHOP_FILES = ['milo_shop.webp', 'milo_shop.png', 'milo_shop.jpg', 'milo_shop.jpeg'];

const BADGE_CATEGORY_META = {
  '1_common': { label: 'Commun', basePrice: 120, variance: 80, order: 1 },
  '2_rare': { label: 'Rare', basePrice: 480, variance: 220, order: 2 },
  '3_epic': { label: 'Epique', basePrice: 1900, variance: 700, order: 3 },
  '4_legendary': { label: 'Legendaire', basePrice: 5200, variance: 1600, order: 4 },
};

const ROTATION_RULES = {
  '1_common': { chance: 1, min: 8, max: 12 },
  '2_rare': { chance: 0.95, min: 5, max: 8 },
  '3_epic': { chance: 0.6, min: 2, max: 4 },
  '4_legendary': { chance: 0.25, min: 1, max: 2 },
};

const SHOP_CATEGORIES = ['1_common', '2_rare', '3_epic', '4_legendary'];

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

const emitToast = (type, message) => {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('farmgestion-toast', { detail: { type, message } }));
};

const hashString = (input) => {
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = ((hash << 5) - hash + input.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
};

const createSeededRandom = (seed) => {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const randomInt = (rng, min, max) => Math.floor(rng() * (max - min + 1)) + min;

const pickUnique = (rng, items, count) => {
  const pool = [...items];
  const picked = [];
  while (pool.length > 0 && picked.length < count) {
    const index = Math.floor(rng() * pool.length);
    picked.push(pool[index]);
    pool.splice(index, 1);
  }
  return picked;
};

const getLocalDayKey = (date = new Date()) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const getSeedFromDayKey = (dayKey) => {
  const digits = Number(dayKey.replace(/\D/g, ''));
  return Number.isFinite(digits) ? digits : 1;
};

const getTimeUntilNextMidnight = () => {
  const now = new Date();
  const next = new Date(now);
  next.setHours(24, 0, 0, 0);
  const diff = Math.max(0, next.getTime() - now.getTime());
  return Math.floor(diff / 1000);
};

const formatCountdown = (totalSeconds) => {
  const safe = Math.max(0, Number(totalSeconds) || 0);
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;
  return [hours, minutes, seconds].map((value) => String(value).padStart(2, '0')).join(':');
};

const getBadgePrice = (category, filename) => {
  const meta = BADGE_CATEGORY_META[category];
  const basePrice = meta?.basePrice ?? 100;
  const variance = meta?.variance ?? 60;
  const hash = hashString(`${category}:${filename}`);
  return basePrice + (hash % Math.max(1, variance));
};

const buildAllShopBadges = () =>
  SHOP_CATEGORIES.flatMap((category) => {
    const files = Array.isArray(badgesManifest?.[category]) ? badgesManifest[category] : [];
    return files
      .filter((filename) => typeof filename === 'string' && filename.length > 0)
      .map((filename) => ({
        id: `${category}:${filename}`,
        filename,
        category,
        rarityLabel: BADGE_CATEGORY_META[category]?.label ?? 'Inconnue',
        rarityOrder: BADGE_CATEGORY_META[category]?.order ?? 0,
        price: getBadgePrice(category, filename),
        imageUrl: BADGES_BUCKET_URL ? `${BADGES_BUCKET_URL}/${category}/${filename}` : '',
      }));
  });

const buildDailyRotation = (allBadges, dayKey) => {
  if (!Array.isArray(allBadges) || !allBadges.length) return [];

  const rng = createSeededRandom(getSeedFromDayKey(dayKey));
  const selected = [];

  SHOP_CATEGORIES.forEach((category) => {
    const rule = ROTATION_RULES[category];
    if (!rule) return;

    if (rng() > rule.chance) return;

    const categoryBadges = allBadges.filter((badge) => badge.category === category);
    if (!categoryBadges.length) return;

    const count = Math.min(categoryBadges.length, randomInt(rng, rule.min, rule.max));
    selected.push(...pickUnique(rng, categoryBadges, count));
  });

  if (!selected.length) {
    return allBadges.slice(0, Math.min(10, allBadges.length));
  }

  return selected.sort((a, b) => {
    if (b.rarityOrder !== a.rarityOrder) return b.rarityOrder - a.rarityOrder;
    if (a.price !== b.price) return a.price - b.price;
    return a.filename.localeCompare(b.filename, 'fr');
  });
};

function ShopPage() {
  const { user } = useAuth();

  const [activeTab, setActiveTab] = useState('badges');
  const [sortOrder, setSortOrder] = useState('asc');
  const [money, setMoney] = useState(0);
  const [farmId, setFarmId] = useState(null);
  const [ownedBadges, setOwnedBadges] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadingError, setLoadingError] = useState('');
  const [buyingFilename, setBuyingFilename] = useState('');
  const [sqlFunctionMissing, setSqlFunctionMissing] = useState(false);
  const [miloFileIndex, setMiloFileIndex] = useState(0);
  const [dayKey, setDayKey] = useState(() => getLocalDayKey(new Date()));
  const [secondsToRotation, setSecondsToRotation] = useState(() => getTimeUntilNextMidnight());

  const allShopBadges = useMemo(() => buildAllShopBadges(), []);
  const rotationBadges = useMemo(() => buildDailyRotation(allShopBadges, dayKey), [allShopBadges, dayKey]);
  const ownedBadgeSet = useMemo(() => new Set(ownedBadges), [ownedBadges]);
  const sortedRotationBadges = useMemo(() => {
    const list = [...rotationBadges];
    list.sort((a, b) => (sortOrder === 'asc' ? a.price - b.price : b.price - a.price));
    return list;
  }, [rotationBadges, sortOrder]);

  const miloImageUrl =
    miloFileIndex < MILO_SHOP_FILES.length && RESOURCES_BUCKET_URL
      ? `${RESOURCES_BUCKET_URL}/${MILO_SHOP_FILES[miloFileIndex]}`
      : '';

  useEffect(() => {
    const interval = window.setInterval(() => {
      setSecondsToRotation(getTimeUntilNextMidnight());
      setDayKey((current) => {
        const next = getLocalDayKey(new Date());
        return current === next ? current : next;
      });
    }, 1000);

    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    let mounted = true;

    const loadData = async () => {
      if (!user?.id) {
        if (mounted) {
          setMoney(0);
          setFarmId(null);
          setOwnedBadges([]);
          setIsLoading(false);
        }
        return;
      }

      setIsLoading(true);
      setLoadingError('');

      try {
        const { data: profileData, error: profileError } = await supabase
          .from('users_profiles')
          .select('money, farm_id')
          .eq('id', user.id)
          .maybeSingle();

        if (profileError) throw profileError;

        const nextMoney = Number(profileData?.money ?? 0);
        const nextFarmId = profileData?.farm_id ?? null;

        if (!nextFarmId) {
          if (!mounted) return;
          setMoney(Number.isFinite(nextMoney) ? nextMoney : 0);
          setFarmId(null);
          setOwnedBadges([]);
          setSqlFunctionMissing(false);
          setIsLoading(false);
          return;
        }

        const { data: farmData, error: farmError } = await supabase
          .from('farms_list')
          .select('equipped_badges')
          .eq('id', nextFarmId)
          .eq('proprietaire', user.id)
          .maybeSingle();

        if (farmError) throw farmError;

        if (!mounted) return;

        setMoney(Number.isFinite(nextMoney) ? nextMoney : 0);
        setFarmId(nextFarmId);
        setOwnedBadges(normalizeEquippedBadges(farmData?.equipped_badges));
        setSqlFunctionMissing(false);
      } catch (error) {
        if (!mounted) return;
        setLoadingError(error?.message || 'Chargement impossible.');
      } finally {
        if (mounted) setIsLoading(false);
      }
    };

    loadData();

    return () => {
      mounted = false;
    };
  }, [user?.id]);

  const handleBuyBadge = async (badge) => {
    if (!user?.id || !badge?.filename || !badge?.category || buyingFilename) return;

    if (!farmId) {
      emitToast('error', 'Tu dois creer une ferme avant d acheter des badges.');
      return;
    }

    if (ownedBadgeSet.has(badge.filename)) {
      emitToast('error', 'Ce badge est déjà possédé.');
      return;
    }

    if (money < badge.price) {
      emitToast('error', `Solde insuffisant: il manque ${badge.price - money} coins.`);
      return;
    }

    const confirmed = window.confirm(`Acheter ${badge.filename} pour ${badge.price} coins ?`);
    if (!confirmed) return;

    setBuyingFilename(badge.filename);

    try {
      const { data, error } = await supabase.rpc('buy_farm_badge', {
        p_filename: badge.filename,
        p_category: badge.category,
      });

      if (error) {
        if (error.code === '42883') {
          setSqlFunctionMissing(true);
          emitToast('error', 'Fonction SQL buy_farm_badge absente. Execute supabase/buy_farm_badge.sql.');
          return;
        }
        throw error;
      }

      const result = typeof data === 'string' ? JSON.parse(data) : data;

      if (!result?.success) {
        const reason = result?.reason ?? 'UNKNOWN';
        if (reason === 'ALREADY_OWNED') {
          emitToast('error', 'Ce badge est déjà possédé.');
        } else if (reason === 'INSUFFICIENT_FUNDS') {
          emitToast('error', `Solde insuffisant: il manque ${Math.max(0, Number(result?.cost || 0) - Number(result?.money || 0))} coins.`);
        } else if (reason === 'NO_FARM') {
          emitToast('error', 'Aucune ferme liée à ce compte.');
        } else {
          emitToast('error', 'Achat impossible pour le moment.');
        }
        return;
      }

      const moneyAfter = Number(result?.money_after);
      const cost = Number(result?.cost ?? badge.price);

      setMoney((current) => (Number.isFinite(moneyAfter) ? moneyAfter : Math.max(0, current - cost)));
      setOwnedBadges((current) => (current.includes(badge.filename) ? current : [...current, badge.filename]));
      setSqlFunctionMissing(false);

      if (Number.isFinite(moneyAfter)) {
        window.dispatchEvent(
          new CustomEvent('farmgestion-balance-updated', {
            detail: {
              userId: user.id,
              money: moneyAfter,
            },
          }),
        );
      }

      emitToast('success', `Badge ${badge.filename} acheté.`);
    } catch (error) {
      emitToast('error', error?.message || 'Erreur pendant l achat du badge.');
    } finally {
      setBuyingFilename('');
    }
  };

  return (
    <div className="shop-page">
      <div className="shop-page-shell">
        <header className="shop-hero">
          <div className="shop-hero-copy">
            <p className="shop-hero-eyebrow">Boutique</p>
            <h1 className="shop-hero-title">Boutique FarmGestion</h1>
            <p className="shop-hero-subtitle">
              Achat de badges avec des coins, puis prochainement les packs en euros.
            </p>

            <div className="shop-hero-metrics">
              <div className="shop-metric">
                <Coins size={16} aria-hidden="true" />
                <span>{Number(money || 0).toLocaleString('fr-FR')} coins</span>
              </div>
              <div className="shop-metric">
                <Clock3 size={16} aria-hidden="true" />
                <span>Rotation dans {formatCountdown(secondsToRotation)}</span>
              </div>
            </div>
          </div>

          {miloImageUrl ? (
            <div className="shop-hero-media" style={{ border: 'none' }}>
              <img
                src={miloImageUrl}
                alt="Milo présente la boutique"
                loading="lazy"
                decoding="async"
                draggable={false}
                style={{ userSelect: 'none', WebkitUserSelect: 'none', WebkitUserDrag: 'none' }}
                onDragStart={(event) => event.preventDefault()}
                onError={() => setMiloFileIndex((index) => index + 1)}
              />
            </div>
          ) : null}
        </header>

        <div className="shop-tabs" role="tablist" aria-label="Sections de la boutique">
          <button
            type="button"
            className={`shop-tab ${activeTab === 'badges' ? 'is-active' : ''}`}
            role="tab"
            aria-selected={activeTab === 'badges'}
            onClick={() => setActiveTab('badges')}
          >
            <ShoppingBag size={15} aria-hidden="true" />
            Badges (coins)
          </button>
          <button
            type="button"
            className={`shop-tab ${activeTab === 'packs' ? 'is-active' : ''}`}
            role="tab"
            aria-selected={activeTab === 'packs'}
            onClick={() => setActiveTab('packs')}
          >
            <Crown size={15} aria-hidden="true" />
            Packs (euros)
          </button>
        </div>

        {activeTab === 'badges' ? (
          <section className="shop-panel">
            <div className="shop-panel-head">
              <div>
                <h2>Rotation badges du jour</h2>
                <p>{rotationBadges.length} badges disponibles aujourd'hui.</p>
              </div>
              <div className="shop-panel-actions">
                <button
                  type="button"
                  className="shop-sort-btn"
                  onClick={() => setSortOrder((current) => (current === 'asc' ? 'desc' : 'asc'))}
                >
                  Prix {sortOrder === 'asc' ? 'croissant' : 'décroissant'}
                </button>
              </div>
            </div>

            {sqlFunctionMissing ? (
              <p className="shop-inline-warning">
                La fonction SQL `buy_farm_badge` est absente. Execute `supabase/buy_farm_badge.sql`.
              </p>
            ) : null}

            {!farmId ? (
              <p className="shop-inline-warning">
                Aucune ferme liée à ton compte. Crée une ferme pour acheter des badges.
              </p>
            ) : null}

            {loadingError ? (
              <p className="shop-inline-warning">{loadingError}</p>
            ) : null}

            {isLoading ? (
              <p className="shop-loading">Chargement de la boutique badges...</p>
            ) : (
              <div className="shop-badges-grid" role="list" aria-label="Badges disponibles">
                {sortedRotationBadges.map((badge) => {
                  const isOwned = ownedBadgeSet.has(badge.filename);
                  const isBuying = buyingFilename === badge.filename;
                  const disableBuy = isOwned || isBuying || !farmId || sqlFunctionMissing;

                  return (
                    <article key={badge.id} className={`shop-badge-card is-${badge.category}`} role="listitem">
                      <div className="shop-badge-top">
                        <span className="shop-rarity-pill">{badge.rarityLabel}</span>
                        {isOwned ? <span className="shop-owned-pill">Possédé</span> : null}
                      </div>

                      <div className="shop-badge-media">
                        {badge.imageUrl ? (
                          <img
                            src={badge.imageUrl}
                            alt={badge.filename}
                            loading="lazy"
                            decoding="async"
                            draggable={false}
                            style={{ userSelect: 'none', WebkitUserSelect: 'none', WebkitUserDrag: 'none' }}
                            onDragStart={(event) => event.preventDefault()}
                            onError={(event) => {
                              event.currentTarget.style.display = 'none';
                            }}
                          />
                        ) : (
                          <span className="shop-badge-fallback" aria-hidden="true">
                            ?
                          </span>
                        )}
                      </div>

                      <p className="shop-badge-name">{badge.filename.replace('.gif', '')}</p>
                      <p className="shop-badge-price">{badge.price} coins</p>

                      <button
                        type="button"
                        className={`shop-buy-btn ${isOwned ? 'is-owned' : ''}`}
                        onClick={() => handleBuyBadge(badge)}
                        disabled={disableBuy}
                      >
                        {isOwned ? 'Déjà acheté' : isBuying ? 'Achat...' : 'Acheter'}
                      </button>
                    </article>
                  );
                })}
              </div>
            )}
          </section>
        ) : (
          <section className="shop-panel">
            <div className="shop-panel-head">
              <div>
                <h2>Packs en euros</h2>
                <p>Section en préparation. Le design restera volontairement simple.</p>
              </div>
            </div>

            <div className="shop-placeholder-grid">
              <article className="shop-placeholder-card">
                <h3>Pack Coins</h3>
                <p>Achats ponctuels de coins pour la boutique.</p>
                <span>Bientôt disponible</span>
              </article>
              <article className="shop-placeholder-card">
                <h3>Pack VIP à vie</h3>
                <p>Accès VIP permanent + bonus coins + 3 bétails spéciaux.</p>
                <span>Bientôt disponible</span>
              </article>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

export default ShopPage;

