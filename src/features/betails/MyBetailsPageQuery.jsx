import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Archive, Heart, Pin, Star } from 'lucide-react'
import {
  useAuthorsMap,
  useBetailDetails,
  useMyBetailsList,
  useToggleBetailArchived,
  useToggleBetailPinned,
  usePreviewBetailPremiumUpgrade,
  useUpgradeBetailPremium,
  useUpdateBetailComment,
  useUserFarmId,
} from './hooks'
import { useAuth } from '../authentification/AuthContext'
import badgesManifest from '../../assets/manifest.json'
import premiumSuccessSound from '../../assets/sounds/GOCHISOU_7.WAV'
import pinInSound from '../../assets/sounds/pinin_005.ogg'
import pinOutSound from '../../assets/sounds/pinout_006.ogg'
import './BetailsListPage.css'
import './MyBetailsPage.css'

const LOADER_DOTS = [1, 2, 3, 4, 5, 6, 7, 8]
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
const BADGES_BUCKET_URL = SUPABASE_URL ? `${SUPABASE_URL}/storage/v1/object/public/badges` : ''
const BADGE_RARITY_LABELS = {
  '0_auto': 'Auto',
  '1_common': 'Common',
  '2_rare': 'Rare',
  '3_epic': 'Epic',
  '4_legendary': 'Legendary',
}
const BADGE_RARITY_ORDER = {
  '4_legendary': 5,
  '3_epic': 4,
  '2_rare': 3,
  '1_common': 2,
  '0_auto': 1,
}
const BADGE_FOLDER_BY_FILE = Object.entries(badgesManifest || {}).reduce((acc, [folder, files]) => {
  if (!Array.isArray(files)) return acc
  files.forEach((file) => {
    if (typeof file === 'string' && file.length) {
      acc[file] = folder
    }
  })
  return acc
}, {})

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

const normalizeEquippedBadges = (value) => {
  if (Array.isArray(value)) {
    return value.filter((item) => typeof item === 'string' && item.trim().length > 0)
  }

  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) return []
    try {
      const parsed = JSON.parse(trimmed)
      return Array.isArray(parsed)
        ? parsed.filter((item) => typeof item === 'string' && item.trim().length > 0)
        : []
    } catch {
      return []
    }
  }

  return []
}

const getBadgeImageUrl = (filename, folder) => {
  if (!BADGES_BUCKET_URL || !filename || !folder) return ''
  return `${BADGES_BUCKET_URL}/${folder}/${filename}`
}

const toast = (type, message) => {
  window.dispatchEvent(
    new CustomEvent('farmgestion-toast', {
      detail: { type, message },
    }),
  )
}

const isMissingColumnError = (error) => {
  const code = error?.code || ''
  const message = (error?.message || '').toLowerCase()
  return code === '42703' || message.includes('column')
}

function MyBetailCard({ betail, authorName, isSelected, onSelect }) {
  const handleSelect = () => onSelect?.(betail.id)

  const handleKeyDown = (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      handleSelect()
    }
  }

  return (
    <article
      className={`betail-card ${isSelected ? 'is-selected' : ''} ${betail.archived ? 'is-archived' : ''} ${betail.pinned ? 'is-pinned' : ''}`}
      onClick={handleSelect}
      onKeyDown={handleKeyDown}
      role="button"
      tabIndex={0}
      aria-pressed={isSelected}
    >
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
        <div className={`betail-avatar ${betail.premium ? 'is-premium' : ''}`}>
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
        <div className="my-betail-status-icons" aria-label="Statuts du bétail">
          {betail.premium && (
            <span className="my-betail-icon-wrap" tabIndex={0}>
              <Star size={15} className="my-betail-icon is-premium" />
              <span className="my-betail-tooltip" role="tooltip">Premium</span>
            </span>
          )}
          {betail.pinned && (
            <span className="my-betail-icon-wrap" tabIndex={0}>
              <Pin size={15} className="my-betail-icon is-pinned" />
              <span className="my-betail-tooltip" role="tooltip">Épinglé</span>
            </span>
          )}
          {betail.archived && (
            <span className="my-betail-icon-wrap" tabIndex={0}>
              <Archive size={15} className="my-betail-icon is-archived" />
              <span className="my-betail-tooltip" role="tooltip">Archivé</span>
            </span>
          )}
        </div>
      </div>
    </article>
  )
}

function MyBetailsPageQuery() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const [searchTerm, setSearchTerm] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [sortMode, setSortMode] = useState('recent')
  const [filterMode, setFilterMode] = useState('all')
  const [selectedBetailId, setSelectedBetailId] = useState(null)
  const [editingComment, setEditingComment] = useState(false)
  const [commentDraft, setCommentDraft] = useState('')
  const [premiumAnimationPhase, setPremiumAnimationPhase] = useState('idle')
  const [premiumConfirmState, setPremiumConfirmState] = useState(null)
  const premiumAnimationTimeoutRef = useRef(null)
  const panelRef = useRef(null)

  const { data: farmId } = useUserFarmId(user?.id)

  const {
    data,
    status,
    error,
    hasNextPage,
    isFetchingNextPage,
    fetchNextPage,
    isLoading,
  } = useMyBetailsList({
    userId: user?.id,
    farmId: null,
    search: debouncedSearch,
    sort: sortMode,
    filter: filterMode,
  })

  const commentMutation = useUpdateBetailComment()
  const premiumPreviewMutation = usePreviewBetailPremiumUpgrade()
  const premiumUpgradeMutation = useUpgradeBetailPremium()
  const togglePinnedMutation = useToggleBetailPinned()
  const toggleArchivedMutation = useToggleBetailArchived()

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchTerm.trim())
    }, 300)
    return () => clearTimeout(timer)
  }, [searchTerm])

  const betails = useMemo(
    () => data?.pages.flatMap((page) => page.items) ?? [],
    [data],
  )

  const sortedBetails = useMemo(() => {
    return [...betails].sort((a, b) => {
      const pinnedDiff = Number(Boolean(b?.pinned)) - Number(Boolean(a?.pinned))
      if (pinnedDiff !== 0) return pinnedDiff
      return 0
    })
  }, [betails])

  const authorIds = useMemo(
    () => betails.map((item) => item.author_id).filter(Boolean),
    [betails],
  )

  const { data: authors = [] } = useAuthorsMap(authorIds)
  const selectedBetail = useMemo(
    () => sortedBetails.find((item) => item.id === selectedBetailId) ?? null,
    [sortedBetails, selectedBetailId],
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
    const count = sortedBetails.length
    return `${count} résultat${count > 1 ? 's' : ''}`
  }, [sortedBetails.length])

  const selectedAvatarFrameUrl = useMemo(() => getResourceFrameUrl('cadre_betail1.png'), [])
  const matriculeFrameUrl = useMemo(() => getResourceFrameUrl('cadre_matricule.png'), [])
  const selectedAuthorName = selectedBetail ? getAuthorName(selectedBetail) : 'Auteur inconnu'
  const selectedCreatedAt = selectedDetails?.created_at || selectedBetail?.created_at
  const selectedPurchasedAt = selectedDetails?.purchased_at || selectedBetail?.purchased_at
  const selectedComment = selectedDetails?.comments ?? selectedBetail?.comments ?? ''
  const selectedEquippedBadges = useMemo(() => {
    const raw = selectedDetails?.equipped_badges ?? selectedBetail?.equipped_badges
    const filenames = normalizeEquippedBadges(raw)
    if (!filenames.length) return []

    return filenames
      .map((filename) => {
        const folder = BADGE_FOLDER_BY_FILE[filename] || null
        return {
          id: filename,
          filename,
          folder,
          rarityOrder: BADGE_RARITY_ORDER[folder] || 0,
          rarityLabel: folder ? (BADGE_RARITY_LABELS[folder] || folder) : 'Inconnue',
          imageUrl: getBadgeImageUrl(filename, folder),
        }
      })
      .sort((a, b) => {
        if (b.rarityOrder !== a.rarityOrder) return b.rarityOrder - a.rarityOrder
        return a.filename.localeCompare(b.filename, 'fr')
      })
  }, [selectedDetails?.equipped_badges, selectedBetail?.equipped_badges])
  const isPremiumAnimationVisible = premiumAnimationPhase !== 'idle'
  const isPremiumAnimationSuccess = premiumAnimationPhase === 'success'

  const isInitialLoading = isLoading
  const hasError = status === 'error'
  const errorMessage = hasError ? error?.message || 'Erreur de chargement. Réessaie plus tard.' : ''

  const isSaving =
    commentMutation.isPending ||
    premiumUpgradeMutation.isPending ||
    togglePinnedMutation.isPending ||
    toggleArchivedMutation.isPending

  const clearPremiumAnimationTimeout = useCallback(() => {
    if (!premiumAnimationTimeoutRef.current) return
    window.clearTimeout(premiumAnimationTimeoutRef.current)
    premiumAnimationTimeoutRef.current = null
  }, [])

  const playPremiumSuccessSound = useCallback(() => {
    try {
      const audio = new Audio(premiumSuccessSound)
      audio.volume = 0.85
      void audio.play().catch(() => {})
    } catch {
      // silence volontaire si autoplay bloqué
    }
  }, [])

  const playPinSound = useCallback((isPinning) => {
    try {
      const soundFile = isPinning ? pinInSound : pinOutSound
      const audio = new Audio(soundFile)
      audio.volume = 0.7
      void audio.play().catch(() => {})
    } catch {
      // silence volontaire si autoplay bloqué
    }
  }, [])

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
    const stillVisible = sortedBetails.some((item) => item.id === selectedBetailId)
    if (!stillVisible) {
      setSelectedBetailId(null)
    }
  }, [sortedBetails, isInitialLoading, selectedBetailId])

  useEffect(() => {
    if (!selectedBetail) {
      setEditingComment(false)
      setPremiumConfirmState(null)
      return
    }
    setCommentDraft(selectedComment || '')
  }, [selectedBetail, selectedComment])

  useEffect(() => {
    setPremiumAnimationPhase('idle')
    setPremiumConfirmState(null)
    clearPremiumAnimationTimeout()
  }, [selectedBetailId, clearPremiumAnimationTimeout])

  useEffect(
    () => () => {
      clearPremiumAnimationTimeout()
    },
    [clearPremiumAnimationTimeout],
  )

  const handleSelectBetail = (betailId) => {
    setSelectedBetailId((prev) => (prev === betailId ? null : betailId))
  }

  const handleSaveComment = () => {
    if (!selectedBetail || !user?.id) return
    commentMutation.mutate(
      {
        betailId: selectedBetail.id,
        comment: commentDraft,
        userId: user.id,
      },
      {
        onSuccess: () => {
          setEditingComment(false)
          toast('success', 'Commentaire enregistré.')
        },
        onError: () => {
          toast('error', 'Impossible d\'enregistrer le commentaire.')
        },
      },
    )
  }

  const runToggle = ({ mutation, nextValue, successMessage, fallbackMessage }) => {
    if (!selectedBetail || !user?.id || mutation.isPending) return
    mutation.mutate(
      { betailId: selectedBetail.id, userId: user.id, nextValue },
      {
        onSuccess: () => {
          toast('success', successMessage)
        },
        onError: (toggleError) => {
          if (isMissingColumnError(toggleError)) {
            toast('error', fallbackMessage)
            return
          }
          toast('error', 'Action impossible pour le moment.')
        },
      },
    )
  }

  const runTogglePinned = () => {
    if (!selectedBetail || !user?.id || togglePinnedMutation.isPending) return
    const nextValue = !selectedBetail.pinned
    playPinSound(nextValue)
    runToggle({
      mutation: togglePinnedMutation,
      nextValue,
      successMessage: nextValue ? 'Bétail épinglé.' : 'Bétail désépinglé.',
      fallbackMessage: 'Option épinglé à venir (migration DB requise).',
    })
  }

  //TODO : Ameliorer le design de l'animation de la transmutation premium, notamment sur mobile


  const runPremiumUpgrade = () => {
    if (!selectedBetail || !user?.id || premiumUpgradeMutation.isPending || selectedBetail.premium) return

    if (!premiumConfirmState?.cost || premiumConfirmState?.canAfford === false) {
      return
    }
    panelRef.current?.scrollTo?.({ top: 0, behavior: 'smooth' })
    clearPremiumAnimationTimeout()
    setPremiumConfirmState(null)
    setPremiumAnimationPhase('running')

    premiumUpgradeMutation.mutate(
      { betailId: selectedBetail.id },
      {
        onSuccess: (result) => {
          if (!result?.success) {
            const reason = result?.reason ?? 'UNKNOWN'
            if (reason === 'INSUFFICIENT_FUNDS') {
              toast('error', `Solde insuffisant. Il faut ${result?.cost ?? 'plus'} 💸.`)
            } else if (reason === 'ALREADY_PREMIUM') {
              toast('error', 'Ce bétail est déjà premium.')
            } else if (reason === 'NOT_FOUND') {
              toast('error', 'Bétail introuvable.')
            } else {
              toast('error', 'Amélioration premium impossible pour le moment.')
            }
            setPremiumAnimationPhase('idle')
            return
          }

          const cost = Number(result?.cost ?? 0)
          const moneyAfter = Number(result?.money_after)
          setPremiumAnimationPhase('success')
          playPremiumSuccessSound()
          toast('success', `Amélioration terminée. Coût débité : ${cost} 💸.`)

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

          premiumAnimationTimeoutRef.current = window.setTimeout(() => {
            setPremiumAnimationPhase('idle')
            premiumAnimationTimeoutRef.current = null
          }, 3000)
        },
        onError: () => {
          setPremiumAnimationPhase('idle')
          toast('error', 'Erreur lors de l’activation premium.')
        },
      },
    )
  }

  const startPremiumPreview = () => {
    if (!selectedBetail || !user?.id || selectedBetail.premium) return

    if (premiumConfirmState) {
      setPremiumConfirmState(null)
      return
    }

    if (premiumPreviewMutation.isPending) return

    setPremiumConfirmState({
      loading: true,
      cost: 0,
      money: 0,
      canAfford: false,
    })

    premiumPreviewMutation.mutate(
      { betailId: selectedBetail.id },
      {
        onSuccess: (result) => {
          const cost = Number(result?.cost ?? 0)
          const money = Number(result?.money ?? 0)

          if (result?.success) {
            setPremiumConfirmState({
              cost,
              money,
              canAfford: true,
            })
            return
          }

          if (result?.reason === 'INSUFFICIENT_FUNDS') {
            setPremiumConfirmState({
              cost,
              money,
              canAfford: false,
            })
            return
          }

          if (result?.reason === 'ALREADY_PREMIUM') {
            toast('error', 'Ce bétail est déjà premium.')
            return
          }

          toast('error', 'Impossible de calculer le coût premium pour le moment.')
        },
        onError: () => {
          setPremiumConfirmState(null)
          toast('error', 'Impossible de prévisualiser le coût premium.')
        },
      },
    )
  }

  return (
    <div className="betails-page my-betails-page">
      <div className={`betails-layout my-betails-layout ${selectedBetail ? 'has-panel' : ''}`}>
        <main className="betails-column-main betails-main my-betails-main">
          <header className="betails-header">
            <div>
              <p className="betails-eyebrow">Inventaire</p>
              <h1 className="betails-title">Mes bétails</h1>
              <p className="betails-subtitle">{stats}</p>
            </div>
            <div className="betails-actions my-betails-actions">
              <button type="button" className="betails-back" onClick={() => navigate('/home')}>
                ← Retour au tableau de bord
              </button>
              <button type="button" className="betails-back" onClick={() => navigate('/ma-ferme')}>
                Aller à Ma ferme
              </button>
            </div>
          </header>

          <section className="betails-filters">
            <div className="filter-group">
              <label className="filter-label" htmlFor="my-betails-search">
                Recherche
              </label>
              <input
                id="my-betails-search"
                className="filter-input"
                placeholder="Nom ou matricule..."
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
              />
            </div>

            <div className="filter-group">
              <label className="filter-label" htmlFor="my-betails-sort">
                Tri
              </label>
              <select
                id="my-betails-sort"
                className="filter-select"
                value={sortMode}
                onChange={(event) => setSortMode(event.target.value)}
              >
                <option value="recent">Récents</option>
                <option value="popular">Populaires</option>
                <option value="premium">Premium d'abord</option>
                <option value="pinned">Épinglés</option>
              </select>
            </div>

            <div className="filter-group">
              <label className="filter-label" htmlFor="my-betails-filter">
                Filtre rapide
              </label>
              <select
                id="my-betails-filter"
                className="filter-select"
                value={filterMode}
                onChange={(event) => setFilterMode(event.target.value)}
              >
                <option value="all">Tous</option>
                <option value="premium">Premium</option>
                <option value="pinned">Épinglés</option>
                <option value="archived">Archivés</option>
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
                  {sortedBetails.map((betail) => (
                    <MyBetailCard
                      key={betail.id}
                      betail={betail}
                      authorName={getAuthorName(betail)}
                      isSelected={selectedBetailId === betail.id}
                      onSelect={handleSelectBetail}
                    />
                  ))}
                </div>

                {!sortedBetails.length && !hasError && (
                  <p className="betails-empty">Aucun bétail trouvé.</p>
                )}
              </div>

              {hasNextPage && (
                <div className="betails-footer">
                  <button
                    type="button"
                    className="betails-load-more"
                    onClick={() => fetchNextPage()}
                    disabled={isFetchingNextPage}
                  >
                    {isFetchingNextPage ? 'Chargement...' : 'Charger plus'}
                  </button>
                </div>
              )}
            </>
          )}
        </main>

        <aside className="betails-column-panel my-betails-panel-column" aria-hidden={!selectedBetail}>
          <section
            ref={panelRef}
            className={`betail-details-panel betails-panel my-betail-panel ${selectedBetail ? 'is-open' : ''}`}
            aria-live="polite"
          >
            {selectedBetail ? (
              <>
                {isSaving && <div className="my-betail-saving-overlay">Sauvegarde…</div>}
                <header className="betail-details-header">
                  <h2 className="betail-details-title">Détails de mon bétail</h2>
                  <div className="betail-details-actions my-betail-panel-actions">
                    <button
                      type="button"
                      className={`betail-details-close my-betail-header-toggle ${selectedBetail.pinned ? 'is-active' : ''}`}
                      onClick={runTogglePinned}
                      disabled={isSaving}
                      aria-label={selectedBetail.pinned ? 'Désépingler ce bétail' : 'Épingler ce bétail'}
                      title={selectedBetail.pinned ? 'Désépingler' : 'Épingler'}
                    >
                      <Pin size={16} />
                    </button>
                    <button
                      type="button"
                      className={`betail-details-close my-betail-header-toggle ${selectedBetail.archived ? 'is-active is-warn' : ''}`}
                      onClick={() =>
                        runToggle({
                          mutation: toggleArchivedMutation,
                          nextValue: !selectedBetail.archived,
                          successMessage: selectedBetail.archived ? 'Bétail restauré.' : 'Bétail archivé.',
                          fallbackMessage: 'Option archivage à venir (migration DB requise).',
                        })
                      }
                      disabled={isSaving}
                      aria-label={selectedBetail.archived ? 'Désarchiver ce bétail' : 'Archiver ce bétail'}
                      title={selectedBetail.archived ? 'Désarchiver' : 'Archiver'}
                    >
                      <Archive size={16} />
                    </button>
                    <button
                      type="button"
                      className="betail-details-close"
                      onClick={() => setSelectedBetailId(null)}
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

                      {isPremiumAnimationVisible ? (
                        <div className={`premium-upgrade-stage ${isPremiumAnimationSuccess ? 'is-success' : ''}`}>
                          <div className="premium-upgrade-orb" aria-hidden="true">
                            <Star size={18} />
                          </div>
                          <div className="premium-upgrade-texts">
                            <p className="premium-upgrade-title">
                              {isPremiumAnimationSuccess ? 'Transmutation accomplie' : 'Transmutation en cours'}
                            </p>
                            <p className="premium-upgrade-subtitle">
                              {isPremiumAnimationSuccess
                                ? 'Le bétail rayonne désormais en premium.'
                                : 'Canalisation de l’énergie premium...'}
                            </p>
                          </div>

                          {!isPremiumAnimationSuccess ? (
                            <div className="premium-upgrade-bar" aria-hidden="true">
                              <span />
                            </div>
                          ) : (
                            <div className="premium-upgrade-success-fx" aria-hidden="true">
                              <span className="premium-fx-ring premium-fx-ring--outer" />
                              <span className="premium-fx-ring premium-fx-ring--inner" />
                              <span className="premium-fx-spark premium-fx-spark--1" />
                              <span className="premium-fx-spark premium-fx-spark--2" />
                              <span className="premium-fx-spark premium-fx-spark--3" />
                              <span className="premium-fx-spark premium-fx-spark--4" />
                            </div>
                          )}
                        </div>
                      ) : null}

                      {!isPremiumAnimationVisible ? (
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
                          <div className="betail-panel-meta-item">
                            <span className="betail-panel-meta-label">Acheté le</span>
                            <span className="betail-panel-meta-value">{formatFrenchDate(selectedPurchasedAt)}</span>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  </div>

                  {!isPremiumAnimationVisible ? (
                    <section className="my-betail-section">
                      <div className="my-betail-section-head">
                        <h3>Commentaire</h3>
                        {!editingComment ? (
                          <button
                            type="button"
                            className="my-betail-btn ghost"
                            onClick={() => {
                              setCommentDraft(selectedComment || '')
                              setEditingComment(true)
                            }}
                            disabled={isSaving}
                          >
                            Modifier
                          </button>
                        ) : null}
                      </div>

                      {!editingComment ? (
                        <div className="betail-back-comments">
                          {isFetchingSelectedDetails
                            ? 'Chargement du commentaire...'
                            : selectedComment || 'Aucun commentaire pour ce bétail.'}
                        </div>
                      ) : (
                        <div className="my-betail-comment-editor">
                          <textarea
                            className="my-betail-textarea"
                            value={commentDraft}
                            onChange={(event) => setCommentDraft(event.target.value)}
                            maxLength={1200}
                          />
                          <div className="my-betail-inline-actions">
                            <button
                              type="button"
                              className="my-betail-btn"
                              onClick={handleSaveComment}
                              disabled={isSaving}
                            >
                              Enregistrer
                            </button>
                            <button
                              type="button"
                              className="my-betail-btn ghost"
                              onClick={() => {
                                setEditingComment(false)
                                setCommentDraft(selectedComment || '')
                              }}
                              disabled={isSaving}
                            >
                              Annuler
                            </button>
                          </div>
                        </div>
                      )}
                    </section>
                  ) : null}

                  {!selectedBetail.premium || premiumConfirmState ? (
                    <section className="my-betail-section">
                      <div className="my-betail-section-head">
                        <h3>Actions rapides</h3>
                      </div>
                      <div className="my-betail-grid-actions">
                        {!selectedBetail.premium ? (
                          <button
                            type="button"
                            className="my-betail-btn"
                            onClick={startPremiumPreview}
                            disabled={isSaving}
                          >
                            <Star size={14} />
                            Amélioration premium
                          </button>
                        ) : null}

                        {premiumConfirmState ? (
                          <div className="premium-confirm-box" role="status" aria-live="polite">
                            <p className="premium-confirm-title">Confirmation amélioration requise</p>
                            {premiumConfirmState.loading ? (
                              <p className="premium-confirm-line">Calcul du coût en cours...</p>
                            ) : (
                              <>
                                <p className="premium-confirm-line">Coût: <strong>{premiumConfirmState.cost} 💸</strong></p>
                                <p className="premium-confirm-line">Solde: <strong>{premiumConfirmState.money} 💸</strong></p>
                              </>
                            )}
                            {premiumConfirmState.canAfford ? null : (
                              premiumConfirmState.loading ? null : (
                                <p className="premium-confirm-warning">
                                  Solde insuffisant: il manque {Math.max(0, premiumConfirmState.cost - premiumConfirmState.money)} 💸.
                                </p>
                              )
                            )}
                            <div className="premium-confirm-actions">
                              <button
                                type="button"
                                className="my-betail-btn"
                                onClick={runPremiumUpgrade}
                                disabled={isSaving || premiumConfirmState.loading || !premiumConfirmState.canAfford}
                              >
                                Confirmer la transmutation
                              </button>
                              <button
                                type="button"
                                className="my-betail-btn ghost"
                                onClick={() => setPremiumConfirmState(null)}
                                disabled={isSaving}
                              >
                                Annuler
                              </button>
                            </div>
                          </div>
                        ) : null}

                     {/* 
                     
           
                   TODO : Enfaite l'épinglage ça le fait depuis la table betails, 
                  // donc ça va pas, si le bétail va a quelqu'un d'autre et qu'il est épinglé bah... il le sera pour le nouveau propriétaire, faudrait revoir ça,
                  // peut être faire la futur table user_preferences avec une colonne pinned_betails
                  // qui stocke les ids des bétails épinglés par l'utilisateur, 
                  //et du coup ça serait plus rapide à faire que de migrer la table betails pour ajouter 
                  //une colonne pinned, et ça réglerait le problème du transfert de propriété, et ça permettrait 
                  //aussi d'ajouter d'autres préférences utilisateur facilement dans le futur (genre les badges favoris, les filtres de tri préférés, etc)
                     
                     */} 

                      </div>
                    </section>
                  ) : null}

                  <section className="my-betail-section my-betail-badges-section">
                    <div className="my-betail-section-head">
                      <h3>Badges du bétail</h3>
                      <span className="my-betail-badge-count">{selectedEquippedBadges.length}</span>
                    </div>
                    {selectedEquippedBadges.length ? (
                      <div className="my-betail-badges-grid" role="list" aria-label="Badges équipés">
                        {selectedEquippedBadges.map((badge) => (
                          <article
                            key={badge.id}
                            className={`my-betail-badge-card ${badge.folder ? `is-${badge.folder}` : 'is-unknown'}`}
                            role="listitem"
                          >
                            {badge.imageUrl ? (
                              <img
                                src={badge.imageUrl}
                                alt={badge.filename}
                                className="my-betail-badge-image"
                                loading="lazy"
                                decoding="async"
                                onError={(event) => {
                                  event.currentTarget.style.display = 'none'
                                }}
                              />
                            ) : (
                              <div className="my-betail-badge-fallback" aria-hidden="true">
                                ?
                              </div>
                            )}
                            <p className="my-betail-badge-name">{badge.filename.replace('.gif', '')}</p>
                            <p className="my-betail-badge-rarity">{badge.rarityLabel}</p>
                          </article>
                        ))}
                      </div>
                    ) : (
                      <div className="my-betail-placeholder-box">
                        <p>Aucun badge équipé sur ce bétail.</p>
                      </div>
                    )}
                    <button
                      type="button"
                      className="my-betail-btn ghost my-betail-shop-btn"
                      onClick={() => toast('error', 'Boutique badges bientôt disponible.')}
                    >
                      Boutique badges (bientôt)
                    </button>
                  </section>

                  <section className="my-betail-section is-danger">
                    <div className="my-betail-section-head">
                      <h3>Danger zone</h3>
                    </div>
                    <div className="my-betail-grid-actions">
                      <button
                        type="button"
                        className="my-betail-btn ghost"
                        onClick={() => toast('error', 'Retirer de ma ferme : à venir.')}
                      >
                        Retirer de ma ferme
                      </button>
                      <button
                        type="button"
                        className="my-betail-btn ghost"
                        onClick={() => toast('error', 'Vente : à venir.')}
                      >
                        Vendre
                      </button>
                    </div>
                  </section>
                </div>
              </>
            ) : (
              <div className="my-betail-empty-panel">Sélectionne un bétail pour afficher ses détails.</div>
            )}
          </section>
        </aside>
      </div>
    </div>
  )
}

export default MyBetailsPageQuery


