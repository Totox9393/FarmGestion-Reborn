import { useEffect, useMemo, useState } from 'react'
import { ArrowDownUp, Clock3, Coins, Crown, ShoppingBag } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { supabase } from '../authentification/supabaseClient'
import { useAuth } from '../authentification/AuthContext'
import {
  BADGE_RARITY_ORDER,
  buyBadgeReborn,
  fetchBadgesCatalogReborn,
  fetchUserBadgesInventoryReborn,
} from '../badges'
import { createSafeAudio, restartAudioSafely } from '../utils/safeAudio'
import purchaseSound from '../../assets/sounds/SeResourceStdSystem_00000198_unlock_speed.wav'
import './ShopPage.css'

const RESOURCES_BUCKET_URL = import.meta.env.VITE_SUPABASE_URL
  ? `${import.meta.env.VITE_SUPABASE_URL}/storage/v1/object/public/ressources`
  : ''
const MILO_SHOP_FILES = ['milo_shop.webp', 'milo_shop.png', 'milo_shop.jpg', 'milo_shop.jpeg']

const ROTATION_RULES = {
  '1_common': { chance: 1, min: 8, max: 12 },
  '2_rare': { chance: 0.95, min: 5, max: 8 },
  '3_epic': { chance: 0.6, min: 2, max: 4 },
  '4_legendary': { chance: 0.25, min: 1, max: 2 },
}

const SHOP_CATEGORIES = ['1_common', '2_rare', '3_epic', '4_legendary']

const emitToast = (type, message) => {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent('farmgestion-toast', { detail: { type, message } }))
}

const createSeededRandom = (seed) => {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) | 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const randomInt = (rng, min, max) => Math.floor(rng() * (max - min + 1)) + min

const pickUniqueIds = (rng, items, count) => {
  const pool = [...items]
  const picked = []
  while (pool.length > 0 && picked.length < count) {
    const index = Math.floor(rng() * pool.length)
    picked.push(pool[index])
    pool.splice(index, 1)
  }
  return picked
}

const getLocalDayKey = (date = new Date()) => {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

const getSeedFromDayKey = (dayKey) => {
  const digits = Number(String(dayKey || '').replace(/\D/g, ''))
  return Number.isFinite(digits) ? digits : 1
}

const getTimeUntilNextMidnight = () => {
  const now = new Date()
  const next = new Date(now)
  next.setHours(24, 0, 0, 0)
  const diff = Math.max(0, next.getTime() - now.getTime())
  return Math.floor(diff / 1000)
}

const formatCountdown = (totalSeconds) => {
  const safe = Math.max(0, Number(totalSeconds) || 0)
  const hours = Math.floor(safe / 3600)
  const minutes = Math.floor((safe % 3600) / 60)
  const seconds = safe % 60
  return [hours, minutes, seconds].map((value) => String(value).padStart(2, '0')).join(':')
}

const buildDailyRotationIds = (allAvailableBadges, dayKey) => {
  if (!Array.isArray(allAvailableBadges) || !allAvailableBadges.length) return []

  const rng = createSeededRandom(getSeedFromDayKey(dayKey))
  const selected = []

  SHOP_CATEGORIES.forEach((category) => {
    const rule = ROTATION_RULES[category]
    if (!rule) return
    if (rng() > rule.chance) return

    const categoryBadges = allAvailableBadges.filter((badge) => badge.rarity === category)
    if (!categoryBadges.length) return

    const count = Math.min(categoryBadges.length, randomInt(rng, rule.min, rule.max))
    selected.push(...pickUniqueIds(rng, categoryBadges, count))
  })

  const rows = selected.length ? selected : allAvailableBadges.slice(0, Math.min(10, allAvailableBadges.length))
  return rows
    .sort((a, b) => {
      const rarityDiff = (BADGE_RARITY_ORDER[b.rarity] || 0) - (BADGE_RARITY_ORDER[a.rarity] || 0)
      if (rarityDiff !== 0) return rarityDiff
      if (a.price !== b.price) return a.price - b.price
      return a.filename.localeCompare(b.filename, 'fr')
    })
    .map((badge) => badge.id)
}

const parseRotationIds = (value) => {
  if (!Array.isArray(value)) return []
  return value.filter((item) => typeof item === 'string' && item.length > 0)
}

const getRotationStorageKey = (dayKey) => `farmgestion_badges_rotation_ids_${dayKey}`

function ShopPage() {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const badgePurchaseAudio = useMemo(() => createSafeAudio(purchaseSound), [])

  const [activeTab, setActiveTab] = useState('badges')
  const [sortOrder, setSortOrder] = useState('asc')
  const [money, setMoney] = useState(0)
  const [ownedBadges, setOwnedBadges] = useState([])
  const [catalogBadges, setCatalogBadges] = useState([])
  const [rotationBadgeIds, setRotationBadgeIds] = useState([])
  const [isLoading, setIsLoading] = useState(true)
  const [loadingError, setLoadingError] = useState('')
  const [buyingBadgeId, setBuyingBadgeId] = useState('')
  const [sqlFunctionMissing, setSqlFunctionMissing] = useState(false)
  const [miloFileIndex, setMiloFileIndex] = useState(0)
  const [dayKey, setDayKey] = useState(() => getLocalDayKey(new Date()))
  const [secondsToRotation, setSecondsToRotation] = useState(() => getTimeUntilNextMidnight())
  const [badgeToConfirm, setBadgeToConfirm] = useState(null)
  const [modalBadgeImageError, setModalBadgeImageError] = useState(false)

  const ownedBadgeSet = useMemo(() => new Set((ownedBadges || []).map((badge) => badge.id)), [ownedBadges])

  const rotationBadges = useMemo(() => {
    if (!rotationBadgeIds.length || !catalogBadges.length) return []
    const byId = new Map(catalogBadges.map((badge) => [badge.id, badge]))
    return rotationBadgeIds
      .map((id) => byId.get(id))
      .filter(Boolean)
  }, [rotationBadgeIds, catalogBadges])

  const sortedRotationBadges = useMemo(() => {
    const list = [...rotationBadges]
    list.sort((a, b) => (sortOrder === 'asc' ? a.price - b.price : b.price - a.price))
    return list
  }, [rotationBadges, sortOrder])

  const miloImageUrl =
    miloFileIndex < MILO_SHOP_FILES.length && RESOURCES_BUCKET_URL
      ? `${RESOURCES_BUCKET_URL}/${MILO_SHOP_FILES[miloFileIndex]}`
      : ''

  useEffect(() => {
    const interval = window.setInterval(() => {
      setSecondsToRotation(getTimeUntilNextMidnight())
      setDayKey((current) => {
        const next = getLocalDayKey(new Date())
        return current === next ? current : next
      })
    }, 1000)

    return () => window.clearInterval(interval)
  }, [])

  useEffect(() => {
    if (typeof document === 'undefined' || !badgeToConfirm) return undefined
    const { body } = document
    if (!body) return undefined

    const previousOverflow = body.style.overflow
    body.style.overflow = 'hidden'

    return () => {
      body.style.overflow = previousOverflow
    }
  }, [badgeToConfirm])

  useEffect(() => {
    if (!badgeToConfirm || typeof window === 'undefined') return undefined

    const onKeyDown = (event) => {
      if (event.key === 'Escape' && !buyingBadgeId) {
        setBadgeToConfirm(null)
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [badgeToConfirm, buyingBadgeId])

  useEffect(() => {
    setModalBadgeImageError(false)
  }, [badgeToConfirm?.id])

  useEffect(() => {
    let mounted = true

    const loadData = async () => {
      if (!user?.id) {
        if (mounted) {
          setMoney(0)
          setOwnedBadges([])
          setCatalogBadges([])
          setRotationBadgeIds([])
          setIsLoading(false)
        }
        return
      }

      setIsLoading(true)
      setLoadingError('')

      try {
        const [{ data: profileData, error: profileError }, catalog, inventory] = await Promise.all([
          supabase
            .from('users_profiles')
            .select('money')
            .eq('id', user.id)
            .maybeSingle(),
          fetchBadgesCatalogReborn(),
          fetchUserBadgesInventoryReborn(user.id),
        ])

        if (profileError) throw profileError
        if (!mounted) return

        setMoney(Math.max(0, Number(profileData?.money ?? 0)))
        setCatalogBadges(Array.isArray(catalog) ? catalog : [])
        setOwnedBadges(Array.isArray(inventory) ? inventory : [])
        setSqlFunctionMissing(false)
      } catch (error) {
        if (!mounted) return
        setLoadingError(error?.message || 'Chargement impossible.')
      } finally {
        if (mounted) setIsLoading(false)
      }
    }

    loadData()

    return () => {
      mounted = false
    }
  }, [user?.id])

  useEffect(() => {
    if (!catalogBadges.length) {
      setRotationBadgeIds([])
      return
    }

    const storageKey = getRotationStorageKey(dayKey)
    let nextIds = []

    if (typeof window !== 'undefined') {
      const raw = window.localStorage.getItem(storageKey)
      if (raw) {
        try {
          nextIds = parseRotationIds(JSON.parse(raw))
        } catch {
          nextIds = []
        }
      }
    }

    if (!nextIds.length) {
      const availableBadges = catalogBadges.filter((badge) => badge.stockLeft > 0)
      nextIds = buildDailyRotationIds(availableBadges, dayKey)

      if (typeof window !== 'undefined') {
        window.localStorage.setItem(storageKey, JSON.stringify(nextIds))
      }
    }

    setRotationBadgeIds(nextIds)
  }, [catalogBadges, dayKey])

  const requestBuyBadge = (badge) => {
    if (!user?.id || !badge?.id || buyingBadgeId) return

    if (ownedBadgeSet.has(badge.id)) {
      emitToast('error', 'Ce badge est déjà possédé.')
      return
    }

    if (badge.stockLeft <= 0) {
      emitToast('error', 'Ce badge est épuisé.')
      return
    }

    if (money < badge.price) {
      emitToast('error', `Solde insuffisant: il manque ${badge.price - money} 💸.`)
      return
    }

    setBadgeToConfirm(badge)
  }

  const handleBuyBadge = async (badge) => {
    if (!user?.id || !badge?.id || buyingBadgeId) return

    if (ownedBadgeSet.has(badge.id)) {
      emitToast('error', 'Ce badge est déjà possédé.')
      return
    }

    if (badge.stockLeft <= 0) {
      emitToast('error', 'Ce badge est épuisé.')
      return
    }

    if (money < badge.price) {
      emitToast('error', `Solde insuffisant: il manque ${badge.price - money} 💸.`)
      return
    }

    setBuyingBadgeId(badge.id)

    try {
      const result = await buyBadgeReborn({ badgeId: badge.id })

      if (!result?.success) {
        const reason = result?.reason ?? 'UNKNOWN'
        if (reason === 'ALREADY_OWNED') {
          emitToast('error', 'Ce badge est déjà possédé.')
        } else if (reason === 'SOLD_OUT') {
          emitToast('error', 'Ce badge est épuisé.')
        } else if (reason === 'INSUFFICIENT_FUNDS') {
          emitToast('error', `Solde insuffisant: il manque ${Math.max(0, Number(result?.price || 0) - Number(result?.money || 0))} 💸.`)
        } else {
          emitToast('error', 'Achat impossible pour le moment.')
        }
        return
      }

      const moneyAfter = Number(result?.money_after)
      const cost = Number(result?.price ?? badge.price)

      setMoney((current) => (Number.isFinite(moneyAfter) ? Math.max(0, moneyAfter) : Math.max(0, current - cost)))
      setOwnedBadges((current) => {
        if (current.some((item) => item.id === badge.id)) return current
        return [...current, { ...badge, purchasedAt: new Date().toISOString(), purchasePrice: cost }]
      })
      setCatalogBadges((current) =>
        current.map((item) =>
          item.id === badge.id
            ? {
                ...item,
                soldCount: item.soldCount + 1,
                stockLeft: Math.max(0, item.stockTotal - (item.soldCount + 1)),
              }
            : item,
        ),
      )
      setSqlFunctionMissing(false)

      queryClient.invalidateQueries({ queryKey: ['settings', 'badges', 'inventory', user.id] })
      queryClient.invalidateQueries({ queryKey: ['settings', 'badges', 'equips', user.id] })

      if (Number.isFinite(moneyAfter)) {
        window.dispatchEvent(
          new CustomEvent('farmgestion-balance-updated', {
            detail: {
              userId: user.id,
              money: moneyAfter,
            },
          }),
        )
      }

      void restartAudioSafely(badgePurchaseAudio)
      emitToast('success', `Badge ${badge.filename} acheté.`)
    } catch (error) {
      if (error?.code === '42883') {
        setSqlFunctionMissing(true)
        emitToast('error', 'Fonction SQL buy_badge_reborn absente. Execute le SQL reborn.')
      } else {
        emitToast('error', error?.message || 'Erreur pendant l achat du badge.')
      }
    } finally {
      setBuyingBadgeId('')
    }
  }

  const handleConfirmPurchase = async () => {
    if (!badgeToConfirm) return
    const badge = badgeToConfirm
    await handleBuyBadge(badge)
    setBadgeToConfirm(null)
  }

  return (
    <div className="shop-page">
      <div className="shop-page-shell">
        <header className="shop-hero">
          <div className="shop-hero-copy">
            <p className="shop-hero-eyebrow">Boutique</p>
            <h1 className="shop-hero-title">Boutique FarmGestion</h1>
            <p className="shop-hero-subtitle">Ici vous pouvez acheter un tas de choses, que ce soit en 💸 ou en euros.</p>

            <div className="shop-hero-kpis">
              <article className="shop-hero-kpi">
                <p className="shop-hero-kpi-label">
                  <Coins size={15} aria-hidden="true" />
                  Solde actuel
                </p>
                <p className="shop-hero-kpi-value">
                  <strong>{Number(money || 0).toLocaleString('fr-FR')} 💸</strong>
                </p>
                <p className="shop-hero-kpi-meta">Votre solde actuel #richesse</p>
              </article>

              <article className="shop-hero-kpi">
                <p className="shop-hero-kpi-label">
                  <Clock3 size={15} aria-hidden="true" />
                  Prochaine rotation
                </p>
                <p className="shop-hero-kpi-value">
                  <strong>{formatCountdown(secondsToRotation)}</strong>
                </p>
                <p className="shop-hero-kpi-meta">Avant le renouvellement quotidien des badges.</p>
              </article>
            </div>

            <div className="shop-hero-tools">
              <div className="shop-mode-switch" role="tablist" aria-label="Sections de la boutique">
                <button
                  type="button"
                  className={`shop-mode-chip ${activeTab === 'badges' ? 'is-active' : ''}`}
                  role="tab"
                  aria-selected={activeTab === 'badges'}
                  onClick={() => setActiveTab('badges')}
                >
                  <span className="shop-mode-chip-title">
                    <ShoppingBag size={15} aria-hidden="true" />
                    Badges
                  </span>
                  <span className="shop-mode-chip-subtitle">Achat en 💸</span>
                </button>

                <button
                  type="button"
                  className={`shop-mode-chip ${activeTab === 'packs' ? 'is-active' : ''}`}
                  role="tab"
                  aria-selected={activeTab === 'packs'}
                  onClick={() => setActiveTab('packs')}
                >
                  <span className="shop-mode-chip-title">
                    <Crown size={15} aria-hidden="true" />
                    Packs
                  </span>
                  <span className="shop-mode-chip-subtitle">Paiement en euros</span>
                </button>
              </div>
            </div>
          </div>

          {miloImageUrl ? (
            <img
              src={miloImageUrl}
              alt="Milo presente la boutique"
              className="shop-hero-milo"
              loading="lazy"
              decoding="async"
              draggable={false}
              style={{ userSelect: 'none', WebkitUserSelect: 'none', WebkitUserDrag: 'none' }}
              onDragStart={(event) => event.preventDefault()}
              onError={() => setMiloFileIndex((index) => index + 1)}
            />
          ) : null}
        </header>

        {activeTab === 'badges' ? (
          <section className="shop-panel">
            <div className="shop-panel-head">
              <div>
                <h2>Rotation badges du jour</h2>
                <p>{rotationBadges.length} badges affichés aujourd'hui.</p>
              </div>

              <div className="shop-panel-actions">
                <button
                  type="button"
                  className="shop-sort-btn"
                  onClick={() => setSortOrder((current) => (current === 'asc' ? 'desc' : 'asc'))}
                >
                  <ArrowDownUp size={15} aria-hidden="true" />
                  Prix {sortOrder === 'asc' ? 'croissant' : 'décroissant'}
                </button>
              </div>
            </div>

            {sqlFunctionMissing ? (
              <p className="shop-inline-warning">
                La fonction SQL `buy_badge_reborn` est absente. Exécute les scripts SQL reborn badges.
              </p>
            ) : null}

            {!user?.id ? <p className="shop-inline-warning">Connectez-vous pour acheter des badges.</p> : null}
            {loadingError ? <p className="shop-inline-warning">{loadingError}</p> : null}

            {isLoading ? (
              <p className="shop-loading">Chargement de la boutique badges...</p>
            ) : (
              <div className="shop-badges-grid" role="list" aria-label="Badges disponibles">
                {sortedRotationBadges.map((badge) => {
                  const isOwned = ownedBadgeSet.has(badge.id)
                  const isBuying = buyingBadgeId === badge.id
                  const isSoldOut = badge.stockLeft <= 0
                  const disableBuy = isOwned || isBuying || isSoldOut || !user?.id || sqlFunctionMissing

                  return (
                    <article
                      key={badge.id}
                      className={`shop-badge-card is-${badge.rarity} ${isOwned ? 'is-owned' : ''} ${isSoldOut ? 'is-soldout' : ''}`}
                      role="listitem"
                    >
                      <div className="shop-badge-top">
                        <span className="shop-rarity-pill">{badge.rarityLabel}</span>
                        {isSoldOut ? <span className="shop-stock-chip is-empty">Épuisé</span> : null}
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
                              event.currentTarget.style.display = 'none'
                            }}
                          />
                        ) : (
                          <span className="shop-badge-fallback" aria-hidden="true">
                            ?
                          </span>
                        )}
                      </div>

                      <p className="shop-badge-name">{badge.name}</p>
                      <p className="shop-badge-price">
                        <strong>{badge.price} 💸</strong>
                      </p>
                      <p className="shop-badge-stock">Stock restant: {badge.stockLeft}</p>

                      <button
                        type="button"
                        className={`shop-buy-btn ${isOwned ? 'is-owned' : ''} ${isSoldOut ? 'is-soldout' : ''}`}
                        onClick={() => requestBuyBadge(badge)}
                        disabled={disableBuy}
                      >
                        {isOwned ? 'Déjà acheté' : isSoldOut ? 'Épuisé' : isBuying ? 'Achat...' : 'Acheter'}
                      </button>
                    </article>
                  )
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
                <h3>Pack 💸</h3>
                <p>Achats ponctuels de 💸 pour la boutique.</p>
                <span>Bientôt disponible</span>
              </article>
              <article className="shop-placeholder-card">
                <h3>Pack VIP à vie</h3>
                <p>Accès VIP permanent + bonus 💸 + 3 bétails spéciaux.</p>
                <span>Bientôt disponible</span>
              </article>
            </div>
          </section>
        )}

        {badgeToConfirm ? (
          <div
            className="shop-buy-modal-backdrop"
            role="presentation"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget && !buyingBadgeId) {
                setBadgeToConfirm(null)
              }
            }}
          >
            <div
              className="shop-buy-modal"
              role="dialog"
              aria-modal="true"
              aria-labelledby="shop-buy-modal-title"
              onMouseDown={(event) => event.stopPropagation()}
            >
              <p className="shop-buy-modal-kicker">Confirmation</p>
              <h3 id="shop-buy-modal-title">Acheter ce badge ?</h3>
              <p className="shop-buy-modal-name">{badgeToConfirm.name}</p>
              <p className="shop-buy-modal-line">
                Coût: <strong>{badgeToConfirm.price} 💸</strong>
              </p>
              <p className="shop-buy-modal-line">
                Stock restant: <strong>{badgeToConfirm.stockLeft}</strong>
              </p>
              <p className="shop-buy-modal-line">
                Solde actuel: <strong>{Number(money || 0).toLocaleString('fr-FR')} 💸</strong>
              </p>

              <div className="shop-buy-modal-preview" aria-hidden="true">
                {!badgeToConfirm.imageUrl || modalBadgeImageError ? (
                  <span className="shop-buy-modal-preview-fallback">?</span>
                ) : (
                  <img
                    src={badgeToConfirm.imageUrl}
                    alt=""
                    loading="lazy"
                    decoding="async"
                    draggable={false}
                    onDragStart={(event) => event.preventDefault()}
                    onError={() => setModalBadgeImageError(true)}
                  />
                )}
              </div>

              <div className="shop-buy-modal-actions">
                <button
                  type="button"
                  className="shop-buy-modal-btn is-secondary"
                  onClick={() => setBadgeToConfirm(null)}
                  disabled={Boolean(buyingBadgeId)}
                >
                  Annuler
                </button>
                <button
                  type="button"
                  className="shop-buy-modal-btn is-primary"
                  onClick={handleConfirmPurchase}
                  disabled={Boolean(buyingBadgeId) || badgeToConfirm.stockLeft <= 0}
                >
                  {buyingBadgeId ? 'Achat...' : `Confirmer ${badgeToConfirm.price} 💸`}
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  )
}

export default ShopPage
