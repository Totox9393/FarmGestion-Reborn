import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Heart } from 'lucide-react'
import {
  useAuthorsMap,
  useBetailDetails,
  useBetailsList,
  usePurchaseBetail,
  useUserFarmId,
} from './hooks'
import { useAuth } from '../authentification/AuthContext'
import './BetailsListPage.css'
import purchaseSound from '../../assets/sounds/SeResourceStdSystem_00000198_unlock_speed.wav'

const LOADER_DOTS = [1, 2, 3, 4, 5, 6, 7, 8]

const formatFrenchDate = (value) => {
  if (!value) return 'Date inconnue'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Date inconnue'
  return new Intl.DateTimeFormat('fr-FR', { dateStyle: 'long' }).format(date)
}

const getThumbnailUrl = (url) => {
  if (!url) return ''
  if (url.includes('/storage/v1/object/public/betails/')) {
    const divider = url.includes('?') ? '&' : '?'
    return `${url}${divider}width=160&height=160&quality=70`
  }
  return url
}

function BetailCard({
  betail,
  authorName,
  currentUserId,
  canPurchase,
  isPurchasing,
  onPurchase,
  purchaseDisabledReason,
}) {
  const [isFlipped, setIsFlipped] = useState(false)
  const { data: details, isFetching } = useBetailDetails(betail.id, isFlipped)
  const isOwner = Boolean(currentUserId) && betail.author_id === currentUserId
  const createdAt = details?.created_at || betail.created_at
  const comment = details?.comments || 'Aucun commentaire pour ce bétail.'
  const isBuyDisabled = !canPurchase || isPurchasing

  const handleToggle = () => {
    setIsFlipped((prev) => !prev)
  }

  const handleKeyDown = (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      handleToggle()
    }
  }

  return (
    <article
      className={`betail-card ${isFlipped ? 'is-flipped' : ''} ${isPurchasing ? 'is-purchasing' : ''}`}
      onClick={handleToggle}
      onKeyDown={handleKeyDown}
      role="button"
      tabIndex={0}
      aria-pressed={isFlipped}
    >
      <div className="betail-card-inner">
        {isPurchasing && (
          <div className="betail-card-overlay" aria-live="polite">
            Achat en cours...
          </div>
        )}
        <div className="betail-card-face betail-card-front">
          <button
            type="button"
            className="betail-like"
            aria-label={`Like ${betail.name}`}
            onClick={(event) => event.stopPropagation()}
          >
            <Heart size={16} />
            <span>{betail.like_count ?? 0}</span>
          </button>
          <div className="betail-avatar">
            {betail.avatar_url ? (
              <img
                src={getThumbnailUrl(betail.avatar_url)}
                alt={betail.name}
                loading="lazy"
                decoding="async"
                fetchPriority="low"
                onLoad={(event) => event.currentTarget.classList.add('is-loaded')}
                onError={(event) => event.currentTarget.classList.add('is-loaded')}
              />
            ) : (
              <span>{betail.name?.[0]?.toUpperCase() || '?'}</span>
            )}
          </div>
          <div className="betail-info">
            <h3 className="betail-name">{betail.name}</h3>
            <p className="betail-matricule">{betail.matricule}</p>
            <p className="betail-race">{betail.age ?? '—'} ans</p>
            <p className="betail-race">Par {authorName}</p>
          </div>
        </div>

        <div className="betail-card-face betail-card-back">
          <div className="betail-back-header">
            <h3 className="betail-back-title">{betail.name}</h3>
            <span className="betail-back-date">{formatFrenchDate(createdAt)}</span>
          </div>
          <div className="betail-back-comments" aria-live="polite">
            {isFetching ? 'Chargement du commentaire...' : comment}
          </div>
          <div className="betail-back-actions">
            {isOwner ? (
              <span className="betail-back-owner">Il s'agit de votre creation</span>
            ) : (
              <button
                type="button"
                className="betail-buy"
                onClick={(event) => {
                  event.stopPropagation()
                  onPurchase?.(betail.id)
                }}
                disabled={isBuyDisabled}
                title={isBuyDisabled ? purchaseDisabledReason : 'Acheter ce bétail'}
              >
                {isPurchasing ? 'Achat...' : 'Acheter'}
              </button>
            )}
          </div>
        </div>
      </div>
    </article>
  )
}

function BetailsListPageQuery() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const [searchTerm, setSearchTerm] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [sortMode, setSortMode] = useState('recent')
  const [purchasingId, setPurchasingId] = useState(null)
  const purchaseAudio = useMemo(() => new Audio(purchaseSound), [])

  const { data: farmId } = useUserFarmId(user?.id)
  const purchaseMutation = usePurchaseBetail()

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchTerm.trim())
    }, 300)
    return () => clearTimeout(timer)
  }, [searchTerm])

  const {
    data,
    status,
    error,
    hasNextPage,
    isFetchingNextPage,
    fetchNextPage,
    isLoading,
  } = useBetailsList({ search: debouncedSearch, sort: sortMode })

  const betails = useMemo(
    () => data?.pages.flatMap((page) => page.items) ?? [],
    [data],
  )

  const authorIds = useMemo(
    () => betails.map((item) => item.author_id).filter(Boolean),
    [betails],
  )

  const { data: authors = [] } = useAuthorsMap(authorIds)

  const authorMap = useMemo(
    () =>
      (authors || []).reduce((acc, author) => {
        acc[author.id] = author.username
        return acc
      }, {}),
    [authors],
  )

  const getAuthorName = (betail) => authorMap[betail.author_id] || 'Auteur inconnu'

  const stats = useMemo(() => {
    const count = betails.length
    return `${count} résultat${count > 1 ? 's' : ''}`
  }, [betails.length])

  const isInitialLoading = isLoading
  const hasError = status === 'error'
  const errorMessage = hasError ? error?.message || 'Erreur de chargement. Réessaie plus tard.' : ''

  const handleLoadMore = () => {
    if (hasNextPage && !isFetchingNextPage) {
      fetchNextPage()
    }
  }

  const getPurchaseDisabledReason = () => {
    if (!user?.id) return 'Connectez-vous pour acheter.'
    if (!farmId) return 'Vous devez avoir une ferme pour acheter.'
    return ''
  }

  const formatPurchaseError = (error) => {
    const rawMessage = error?.message || ''
    if (rawMessage.includes('daily_limit_reached')) {
      return 'Limite quotidienne atteinte (10 achats).'
    }
    if (rawMessage.includes('already_sold_or_invalid')) {
      return 'Ce bétail vient d\'etre acheté.'
    }
    if (rawMessage.includes('no_farm')) {
      return 'Vous devez avoir une ferme pour acheter.'
    }
    if (rawMessage.includes('not_authenticated')) {
      return 'Veuillez vous connecter pour acheter.'
    }
    return 'Impossible d\'acheter ce bétail pour le moment.'
  }

  const handlePurchase = (betailId) => {
    if (!user?.id || !farmId || purchaseMutation.isPending) return
    setPurchasingId(betailId)
    purchaseMutation.mutate(
      { betailId },
      {
        onSuccess: () => {
          purchaseAudio.currentTime = 0
          purchaseAudio.play().catch(() => {})
          window.dispatchEvent(
            new CustomEvent('farmgestion-toast', {
              detail: { type: 'success', message: 'Bétail acheté avec succès.' },
            })
          )
        },
        onError: (error) => {
          window.dispatchEvent(
            new CustomEvent('farmgestion-toast', {
              detail: { type: 'error', message: formatPurchaseError(error) },
            })
          )
        },
        onSettled: () => {
          setPurchasingId(null)
        },
      },
    )
  }

  return (
    <div className="betails-page">
      <header className="betails-header">
        <div>
          <p className="betails-eyebrow">Registre</p>
          <h1 className="betails-title">Bétails disponibles</h1>
          <p className="betails-subtitle">{stats}</p>
        </div>
        <div className="betails-actions">
          <button type="button" className="betails-back" onClick={() => navigate('/home')}>
            ← Retour au tableau de bord
          </button>
        </div>
      </header>

      <section className="betails-filters">
        <div className="filter-group">
          <label className="filter-label" htmlFor="betails-search">
            Recherche
          </label>
          <input
            id="betails-search"
            className="filter-input"
            placeholder="Nom ou matricule..."
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
          />
        </div>

        <div className="filter-group">
          <label className="filter-label" htmlFor="betails-sort">
            Tri
          </label>
          <select
            id="betails-sort"
            className="filter-select"
            value={sortMode}
            onChange={(event) => setSortMode(event.target.value)}
          >
            <option value="recent">Les plus récents</option>
            <option value="popular">Les plus aimés</option>
          </select>
        </div>
      </section>

      {hasError && <p className="betails-error">{errorMessage}</p>}

      {isInitialLoading ? (
        <div className="betails-loading">
          <div className="loader-dots" aria-hidden="true">
            {LOADER_DOTS.map((dot) => (
              <div className="dot" key={dot} />
            ))}
          </div>
          <p>Chargement en cours…</p>
        </div>
      ) : (
        <div className="betails-grid">
          {betails.map((betail) => (
            <BetailCard
              key={betail.id}
              betail={betail}
              authorName={getAuthorName(betail)}
              currentUserId={user?.id}
              canPurchase={Boolean(user?.id && farmId)}
              isPurchasing={purchasingId === betail.id && purchaseMutation.isPending}
              onPurchase={handlePurchase}
              purchaseDisabledReason={getPurchaseDisabledReason()}
            />
          ))}
        </div>
      )}

      {!isInitialLoading && hasNextPage && (
        <div className="betails-footer">
          <button
            type="button"
            className="betails-load-more"
            onClick={handleLoadMore}
            disabled={isFetchingNextPage}
          >
            {isFetchingNextPage ? 'Chargement...' : 'Charger plus'}
          </button>
        </div>
      )}

      {!isInitialLoading && !betails.length && !hasError && (
        <p className="betails-empty">Aucun bétail trouvé.</p>
      )}
    </div>
  )
}

export default BetailsListPageQuery
