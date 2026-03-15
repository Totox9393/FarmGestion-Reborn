import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertTriangle, Heart } from 'lucide-react'
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
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL

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

const getResourceFrameUrl = (filename) => {
  if (!SUPABASE_URL) return ''
  return `${SUPABASE_URL}/storage/v1/object/public/ressources/${filename}`
}

function BetailCard({
  betail,
  authorName,
  isSelected,
  isPurchasing,
  onSelect,
}) {
  const handleSelect = () => {
    onSelect?.(betail.id)
  }

  const handleKeyDown = (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      handleSelect()
    }
  }

  return (
    <article
      className={`betail-card ${isSelected ? 'is-selected' : ''} ${isPurchasing ? 'is-purchasing' : ''}`}
      onClick={handleSelect}
      onKeyDown={handleKeyDown}
      role="button"
      tabIndex={0}
      aria-pressed={isSelected}
    >
      {isPurchasing && (
        <div className="betail-card-overlay" aria-live="polite">
          Achat en cours...
        </div>
      )}
      <div className="betail-card-surface">
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
    </article>
  )
}

function BetailsListPageQuery() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const [searchTerm, setSearchTerm] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [sortMode, setSortMode] = useState('recent')
  const [selectedBetailId, setSelectedBetailId] = useState(null)
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
  const selectedBetail = useMemo(
    () => betails.find((item) => item.id === selectedBetailId) ?? null,
    [betails, selectedBetailId],
  )
  const { data: selectedDetails, isFetching: isFetchingSelectedDetails } = useBetailDetails(
    selectedBetailId,
    Boolean(selectedBetailId),
  )

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
  const selectedCreatedAt = selectedDetails?.created_at || selectedBetail?.created_at
  const selectedComment = selectedDetails?.comments || 'Aucun commentaire pour ce bétail.'
  const selectedAuthorName = selectedBetail ? getAuthorName(selectedBetail) : 'Auteur inconnu'
  const selectedAvatarFrameUrl = useMemo(() => getResourceFrameUrl('cadre_betail1.png'), [])
  const matriculeFrameUrl = useMemo(() => getResourceFrameUrl('cadre_matricule.png'), [])
  const hasShortComment = !selectedDetails?.comments || selectedDetails.comments.length <= 300
  const panelDecorUrl = useMemo(() => getResourceFrameUrl('littlebernie.png'), [])
  const isSelectedOwner = Boolean(selectedBetail && user?.id && selectedBetail.author_id === user.id)
  const canPurchase = Boolean(user?.id && farmId)
  const isSelectedPurchasing = Boolean(
    selectedBetail && purchasingId === selectedBetail.id && purchaseMutation.isPending,
  )
  const isSelectedBuyDisabled = !canPurchase || isSelectedPurchasing

  const handleLoadMore = () => {
    if (hasNextPage && !isFetchingNextPage) {
      fetchNextPage()
    }
  }

  const handleSelectBetail = (betailId) => {
    setSelectedBetailId((prev) => (prev === betailId ? null : betailId))
  }

  const handleClosePanel = () => {
    setSelectedBetailId(null)
  }

  const getPurchaseDisabledReason = () => {
    if (!user?.id) return 'Connectez-vous pour acheter.'
    if (!farmId) return 'Vous devez avoir une ferme pour acheter.'
    return ''
  }

  const formatPurchaseError = (error) => {
    const rawMessage = error?.message || ''
    if (rawMessage.includes('betail_invisible')) {
      return 'Ce bétail ne peut pas être acheté.'
    }
    if (rawMessage.includes('daily_limit_reached')) {
      return 'Limite quotidienne atteinte (10 achats).'
    }
    if (rawMessage.includes('already_sold_or_invalid')) {
      return 'Ce bétail a déjà été acheté.'
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

  useEffect(() => {
    if (!selectedBetailId) return
    const handleEscape = (event) => {
      if (event.key === 'Escape') {
        setSelectedBetailId(null)
      }
    }
    window.addEventListener('keydown', handleEscape)
    return () => window.removeEventListener('keydown', handleEscape)
  }, [selectedBetailId])

  useEffect(() => {
    if (!selectedBetailId || isInitialLoading) return
    const stillVisible = betails.some((item) => item.id === selectedBetailId)
    if (!stillVisible) {
      setSelectedBetailId(null)
    }
  }, [betails, isInitialLoading, selectedBetailId])

  return (
    <div className="betails-page">
      <div className={`betails-layout ${selectedBetail ? 'has-panel' : ''}`}>
        <main className="betails-column-main betails-main">
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
            <>
              <div className="betails-content">
                <div className="betails-grid">
                  {betails.map((betail) => (
                    <BetailCard
                      key={betail.id}
                      betail={betail}
                      authorName={getAuthorName(betail)}
                      isSelected={selectedBetailId === betail.id}
                      isPurchasing={purchasingId === betail.id && purchaseMutation.isPending}
                      onSelect={handleSelectBetail}
                    />
                  ))}
                </div>

                {!betails.length && !hasError && (
                  <p className="betails-empty">Aucun bétail trouvé.</p>
                )}
              </div>

              {hasNextPage && (
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
            </>
          )}
        </main>

        <aside className="betails-column-panel" aria-hidden={!selectedBetail}>
          {selectedBetail && (
            <section className="betail-details-panel betails-panel" aria-live="polite">
              <header className="betail-details-header">
                <h2 className="betail-details-title">Détails du bétail</h2>
                <div className="betail-details-actions">
                  <button
                    type="button"
                    className="betail-details-close betail-details-report"
                    aria-label="Signaler ce bétail"
                    title="Signaler ce bétail"
                  >
                    <AlertTriangle size={16} />
                  </button>
                  <button
                    type="button"
                    className="betail-details-close"
                    onClick={handleClosePanel}
                    aria-label="Fermer les détails"
                  >
                    ✕
                  </button>
                </div>
              </header>

              <div className="betail-details-body">
                <div className="betail-details-identity">
                  <div className="betail-avatar-frame-wrap">
                    <span className="betail-avatar-sparkle betail-avatar-sparkle--1" aria-hidden="true" />
                    <span className="betail-avatar-sparkle betail-avatar-sparkle--2" aria-hidden="true" />
                    <span className="betail-avatar-sparkle betail-avatar-sparkle--3" aria-hidden="true" />
                    <span className="betail-avatar-sparkle betail-avatar-sparkle--4" aria-hidden="true" />
                    {selectedAvatarFrameUrl && (
                      <img
                        className="betail-avatar-frame"
                        src={selectedAvatarFrameUrl}
                        alt=""
                        aria-hidden="true"
                        loading="lazy"
                        decoding="async"
                      />
                    )}
                    <div className="betail-avatar betail-avatar--panel">
                      {selectedBetail.avatar_url ? (
                        <img
                          src={getThumbnailUrl(selectedBetail.avatar_url)}
                          alt={selectedBetail.name}
                          loading="lazy"
                          decoding="async"
                          fetchPriority="low"
                          onLoad={(event) => event.currentTarget.classList.add('is-loaded')}
                          onError={(event) => event.currentTarget.classList.add('is-loaded')}
                        />
                      ) : (
                        <span>{selectedBetail.name?.[0]?.toUpperCase() || '?'}</span>
                      )}
                    </div>
                  </div>

                  <div className="betail-info betail-info--panel">
                    <h3 className="betail-back-title">{selectedBetail.name}</h3>
                    <div className="betail-matricule-frame-wrap">
                      {matriculeFrameUrl && (
                        <img
                          className="betail-matricule-frame"
                          src={matriculeFrameUrl}
                          alt=""
                          aria-hidden="true"
                          loading="lazy"
                          decoding="async"
                        />
                      )}
                      <p className="betail-matricule betail-matricule--panel">{selectedBetail.matricule}</p>
                    </div>

                    <div className="betail-panel-meta" aria-label="Informations du bétail">
                      <div className="betail-panel-meta-item">
                        <span className="betail-panel-meta-label">Âge</span>
                        <span className="betail-panel-meta-value">{selectedBetail.age ?? '—'} ans</span>
                      </div>
                      <div className="betail-panel-meta-item">
                        <span className="betail-panel-meta-label">Auteur</span>
                        <span className="betail-panel-meta-value">{selectedAuthorName}</span>
                      </div>
                      <div className="betail-panel-meta-item">
                        <span className="betail-panel-meta-label">Créé le</span>
                        <span className="betail-panel-meta-value">{formatFrenchDate(selectedCreatedAt)}</span>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="betail-back-comments">
                  {isFetchingSelectedDetails ? 'Chargement du commentaire...' : selectedComment}
                </div>

                <div className="betail-back-actions">
                  {isSelectedOwner ? (
                    <span className="betail-back-owner">Il s'agit de votre creation</span>
                  ) : (
                    <button
                      type="button"
                      className="betail-buy"
                      onClick={() => handlePurchase(selectedBetail.id)}
                      disabled={isSelectedBuyDisabled}
                      title={isSelectedBuyDisabled ? getPurchaseDisabledReason() : 'Acheter ce bétail'}
                    >
                      {isSelectedPurchasing ? 'Achat...' : 'Acheter'}
                    </button>
                  )}
                  {hasShortComment && panelDecorUrl && (
                    <img
                      className="betail-panel-decor"
                      src={panelDecorUrl}
                      alt=""
                      aria-hidden="true"
                      loading="lazy"
                      decoding="async"
                      onError={(event) => {
                        event.currentTarget.style.display = 'none'
                      }}
                    />
                  )}
                </div>
              </div>
            </section>
          )}
        </aside>
      </div>
    </div>
  )
}

export default BetailsListPageQuery
