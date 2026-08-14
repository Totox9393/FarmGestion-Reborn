import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, Heart } from 'lucide-react'
import {
  useAuthorsMap,
  useBetailDetails,
  useBetailsList,
  usePurchaseBetail,
  useUserFarmId,
  useUserRole,
} from './hooks'
import { useAuth } from '../authentification/AuthContext'
import { supabase } from '../authentification/supabaseClient'
import ReportBetailModal from '../signalement/ReportBetailModal'
import { createSafeAudio, restartAudioSafely } from '../utils/safeAudio'
import './BetailsListPage.css'
import betailSampleImage from '../../assets/betail_sample.png'
import purchaseSound from '../../assets/sounds/SeResourceStdSystem_00000198_unlock_speed.wav'
import likeConfirmSound from '../../assets/sounds/confirmation_003.ogg'

const LOADER_DOTS = [1, 2, 3, 4, 5, 6, 7, 8]
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const formatFrenchDate = (value) => {
  if (!value) return 'Date inconnue'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Date inconnue'
  return new Intl.DateTimeFormat('fr-FR', { dateStyle: 'long' }).format(date)
}

const getThumbnailUrl = (url) => {
  if (!url) return ''
  return url
}

const getResourceFrameUrl = (filename) => {
  if (!SUPABASE_URL) return ''
  return `${SUPABASE_URL}/storage/v1/object/public/ressources/${filename}`
}

const isNotAuthenticatedError = (error) => {
  const message = String(error?.message || '').toLowerCase()
  return message.includes('not authenticated')
}

const dispatchToast = (type, message) => {
  window.dispatchEvent(
    new CustomEvent('farmgestion-toast', {
      detail: { type, message },
    }),
  )
}

function OverflowAutoScrollText({ text }) {
  const viewportRef = useRef(null)
  const trackRef = useRef(null)
  const safeText = String(text || 'Sans nom')

  useEffect(() => {
    const viewport = viewportRef.current
    const track = trackRef.current
    if (!viewport || !track) return undefined

    let frameId = 0
    let delayedFrameId = 0
    let delayedTimerId = 0
    let resizeObserver = null

    const updateOverflow = () => {
      const viewportWidth = Math.ceil(viewport.clientWidth)
      const trackWidth = Math.ceil(track.scrollWidth)
      const overflowDistance = Math.max(0, trackWidth - viewportWidth)
      const isOverflowing = overflowDistance > 4

      viewport.classList.toggle('is-overflowing', isOverflowing)
      if (!isOverflowing) {
        viewport.style.removeProperty('--scroll-distance')
        viewport.style.removeProperty('--scroll-duration')
        return
      }

      const duration = Math.max(6.5, Math.min(16, overflowDistance / 15))
      viewport.style.setProperty('--scroll-distance', `${overflowDistance}px`)
      viewport.style.setProperty('--scroll-duration', `${duration.toFixed(2)}s`)
    }

    const scheduleOverflowCheck = () => {
      if (frameId) window.cancelAnimationFrame(frameId)
      frameId = window.requestAnimationFrame(updateOverflow)
    }

    scheduleOverflowCheck()
    delayedTimerId = window.setTimeout(() => {
      delayedFrameId = window.requestAnimationFrame(updateOverflow)
    }, 260)

    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(() => {
        scheduleOverflowCheck()
      })
      resizeObserver.observe(viewport)
      resizeObserver.observe(track)
    }

    window.addEventListener('resize', scheduleOverflowCheck)

    return () => {
      if (frameId) window.cancelAnimationFrame(frameId)
      if (delayedFrameId) window.cancelAnimationFrame(delayedFrameId)
      if (delayedTimerId) window.clearTimeout(delayedTimerId)
      window.removeEventListener('resize', scheduleOverflowCheck)
      resizeObserver?.disconnect()
    }
  }, [safeText])

  return (
    <span className="betail-name-marquee" ref={viewportRef} title={safeText}>
      <span className="betail-name-marquee__track" ref={trackRef}>
        {safeText}
      </span>
    </span>
  )
}

function BetailCard({
  betail,
  authorName,
  likedByMe,
  isLikePending,
  isSelected,
  isPurchasing,
  onToggleLike,
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
          className={`betail-like ${likedByMe ? 'is-liked' : ''}`}
          aria-label={likedByMe ? `Retirer le like de ${betail.name}` : `Aimer ${betail.name}`}
          title={likedByMe ? 'Retirer le like' : 'Aimer'}
          onClick={(event) => {
            event.stopPropagation()
            onToggleLike?.(betail, likedByMe)
          }}
          disabled={isLikePending}
        >
          <Heart size={16} fill={likedByMe ? 'currentColor' : 'none'} />
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
          <h3 className="betail-name">
            <OverflowAutoScrollText text={betail.name} />
          </h3>
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
  const { id: routeBetailIdParam } = useParams()
  const { user } = useAuth()
  const [searchTerm, setSearchTerm] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [sortMode, setSortMode] = useState('recent')
  const [purchasingId, setPurchasingId] = useState(null)
  const [isReportModalOpen, setIsReportModalOpen] = useState(false)
  const [reportBetailVisible, setReportBetailVisible] = useState(true)
  const queryClient = useQueryClient()
  const purchaseAudio = useMemo(() => createSafeAudio(purchaseSound), [])
  const likeConfirmAudio = useMemo(() => createSafeAudio(likeConfirmSound), [])

  const { data: farmId } = useUserFarmId(user?.id)
  const { data: userRole = '' } = useUserRole(user?.id)
  const purchaseMutation = usePurchaseBetail()

  const isAdminOrModeration = useMemo(() => {
    const normalized = String(userRole || '').trim().toUpperCase()
    return normalized.includes('ADMIN') || normalized.includes('MODERATION')
  }, [userRole])

  const visibilityToggleMutation = useMutation({
    mutationFn: async ({ betailId, nextVisible }) => {
      const invisibleReason = nextVisible
        ? null
        : 'Rendu invisible manuellement par un moderateur'

      const { data, error } = await supabase.rpc('admin_set_betail_visibility_reborn', {
        p_betail_id: betailId,
        p_visible: nextVisible,
        p_invisible_reason: invisibleReason,
      })

      if (error) throw error

      const result = Array.isArray(data) ? data[0] : data
      if (!result?.success) {
        const reason = String(result?.reason || 'UNKNOWN')
        throw new Error(`admin_set_betail_visibility_reborn_failed:${reason}`)
      }

      return {
        nextVisible,
        removedBadges: Number(result?.removed_badges || 0),
        removedShipping: Number(result?.removed_shipping || 0),
      }
    },
    onSuccess: ({ nextVisible, removedBadges, removedShipping }) => {
      setReportBetailVisible(nextVisible)
      queryClient.invalidateQueries({ queryKey: ['betails'] })
      window.dispatchEvent(
        new CustomEvent('farmgestion-toast', {
          detail: {
            type: 'success',
            message: nextVisible
              ? removedShipping > 0
                ? 'Betail rendu visible. Historique d\'expedition annule.'
                : 'Betail rendu visible.'
              : removedBadges > 0
                ? `Betail rendu invisible. ${removedBadges} badge(s) retire(s) de l\'inventaire du proprietaire.`
                : 'Betail rendu invisible.',
          },
        }),
      )
    },
    onError: (error) => {
      const rawMessage = String(error?.message || '').toLowerCase()
      let message = 'Impossible de changer la visibilite du betail.'
      if (rawMessage.includes('admin_set_betail_visibility_reborn')) {
        message = 'La fonction SQL admin_set_betail_visibility_reborn est absente ou signature differente.'
      }
      window.dispatchEvent(
        new CustomEvent('farmgestion-toast', {
          detail: {
            type: 'error',
            message,
          },
        }),
      )
    },
  })

  const toggleLikeMutation = useMutation({
    mutationFn: async ({ betailId, currentlyLiked }) => {
      if (!user?.id) {
        throw new Error('Not authenticated')
      }

      const rpcName = currentlyLiked ? 'unlike_betail' : 'like_betail'
      const { data: rpcResult, error: rpcError } = await supabase.rpc(rpcName, { p_betail_id: betailId })
      if (rpcError) {
        throw rpcError
      }

      const payload = Array.isArray(rpcResult) ? rpcResult[0] : rpcResult
      return {
        betailId,
        liked: Boolean(payload?.liked),
        likeCount: Number(payload?.like_count),
      }
    },
    onMutate: async ({ betailId, currentlyLiked }) => {
      await queryClient.cancelQueries({ queryKey: ['betails', 'list'] })
      const previousList = queryClient.getQueriesData({ queryKey: ['betails', 'list'] })
      const nextLiked = !currentlyLiked

      queryClient.setQueriesData({ queryKey: ['betails', 'list'] }, (oldData) => {
        if (!oldData?.pages) return oldData
        return {
          ...oldData,
          pages: oldData.pages.map((page) => ({
            ...page,
            items: (page.items || []).map((item) => {
              if (item?.id !== betailId) return item
              const previousCount = Number(item?.like_count ?? 0)
              const delta = nextLiked ? 1 : -1
              return {
                ...item,
                liked_by_me: nextLiked,
                like_count: Math.max(0, previousCount + delta),
              }
            }),
          })),
        }
      })

      return { previousList }
    },
    onError: (error, _variables, context) => {
      if (context?.previousList) {
        context.previousList.forEach(([key, value]) => {
          queryClient.setQueryData(key, value)
        })
      }

      if (isNotAuthenticatedError(error)) {
        dispatchToast('error', 'Connectez-vous pour aimer un bétail.')
        return
      }

      dispatchToast('error', 'Impossible de mettre a jour le like pour le moment.')
    },
    onSuccess: ({ betailId, liked, likeCount }) => {
      queryClient.setQueriesData({ queryKey: ['betails', 'list'] }, (oldData) => {
        if (!oldData?.pages) return oldData
        return {
          ...oldData,
          pages: oldData.pages.map((page) => ({
            ...page,
            items: (page.items || []).map((item) =>
              item?.id === betailId
                ? {
                    ...item,
                    liked_by_me: liked,
                    like_count: Number.isFinite(likeCount) ? Math.max(0, likeCount) : item.like_count,
                  }
                : item,
            ),
          })),
        }
      })
      if (liked) {
        void restartAudioSafely(likeConfirmAudio)
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['betails', 'liked', user?.id || 'anon'] })
    },
  })

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchTerm.trim())
    }, 300)
    return () => clearTimeout(timer)
  }, [searchTerm])

  const hasRouteBetailIdParam = typeof routeBetailIdParam === 'string' && routeBetailIdParam.trim().length > 0
  const selectedBetailId = useMemo(() => {
    if (!hasRouteBetailIdParam) return null
    const normalized = String(routeBetailIdParam).trim()
    return UUID_REGEX.test(normalized) ? normalized : null
  }, [hasRouteBetailIdParam, routeBetailIdParam])
  const hasInvalidRouteBetailId = hasRouteBetailIdParam && !selectedBetailId

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
  const betailIds = useMemo(
    () => Array.from(new Set((betails || []).map((item) => String(item?.id || '')).filter(Boolean))).sort(),
    [betails],
  )

  const { data: likedRows = [] } = useQuery({
    queryKey: ['betails', 'liked', user?.id || 'anon', betailIds],
    enabled: Boolean(user?.id) && betailIds.length > 0,
    queryFn: async () => {
      const { data: rows, error: likedError } = await supabase
        .from('betail_likes')
        .select('betail_id')
        .eq('user_id', user.id)
        .in('betail_id', betailIds)

      if (likedError) throw likedError
      return rows || []
    },
    staleTime: 30_000,
  })

  const likedIdsSet = useMemo(
    () => new Set((likedRows || []).map((row) => String(row?.betail_id || '')).filter(Boolean)),
    [likedRows],
  )

  const authorIds = useMemo(
    () => betails.map((item) => item.author_id).filter(Boolean),
    [betails],
  )

  const { data: authors = [] } = useAuthorsMap(authorIds)
  const selectedBetailFromList = useMemo(
    () => betails.find((item) => item.id === selectedBetailId) ?? null,
    [betails, selectedBetailId],
  )
  const {
    data: selectedBetailFromRoute = null,
    status: selectedRouteBetailStatus,
    isFetching: isFetchingSelectedRouteBetail,
  } = useQuery({
    queryKey: ['betails', 'selected-route', selectedBetailId],
    enabled: Boolean(selectedBetailId) && !selectedBetailFromList,
    retry: false,
    staleTime: 60_000,
    queryFn: async () => {
      const { data: row, error: rowError } = await supabase
        .from('betails')
        .select('id, name, matricule, avatar_url, age, author_id, created_at, like_count, visible')
        .eq('id', selectedBetailId)
        .eq('visible', true)
        .is('farm_id', null)
        .is('owner_id', null)
        .maybeSingle()

      if (rowError) throw rowError
      return row ?? null
    },
  })
  const selectedBetail = selectedBetailFromList ?? selectedBetailFromRoute
  const selectedBetailTitle = String(selectedBetail?.name || '').trim()
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
  const hasSelectedRouteLookupError =
    selectedRouteBetailStatus === 'error' && Boolean(selectedBetailId) && !selectedBetailFromList
  const selectedRouteLookupErrorMessage = hasSelectedRouteLookupError
    ? 'Impossible de charger le bétail demandé pour le moment.'
    : ''
  const hasMissingSelectedRouteBetail =
    Boolean(selectedBetailId) &&
    !selectedBetail &&
    !isInitialLoading &&
    !isFetchingSelectedRouteBetail &&
    !hasSelectedRouteLookupError
  const shouldShowRouteBetailNotFound = hasInvalidRouteBetailId || hasMissingSelectedRouteBetail
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
  const isLikedByMe = (betail) => Boolean(betail?.liked_by_me) || likedIdsSet.has(String(betail?.id || ''))

  const handleToggleLike = (betail, currentlyLiked) => {
    if (!betail?.id || toggleLikeMutation.isPending) return
    toggleLikeMutation.mutate({
      betailId: betail.id,
      currentlyLiked: Boolean(currentlyLiked),
    })
  }

  const handleLoadMore = () => {
    if (hasNextPage && !isFetchingNextPage) {
      fetchNextPage()
    }
  }

  const handleSelectBetail = (betailId) => {
    if (!betailId) return
    setIsReportModalOpen(false)
    if (selectedBetailId === betailId) {
      navigate('/betail-register')
      return
    }
    navigate(`/betail-register/${betailId}`)
  }

  const handleClosePanel = () => {
    setIsReportModalOpen(false)
    navigate('/betail-register')
  }

  const handleOpenReportModal = () => {
    if (!selectedBetail) return
    setIsReportModalOpen(true)
  }

  const handleCloseReportModal = () => {
    setIsReportModalOpen(false)
  }

  const handleToggleBetailVisibility = () => {
    if (!selectedBetail?.id || visibilityToggleMutation.isPending) return
    const nextVisible = !reportBetailVisible
    visibilityToggleMutation.mutate({
      betailId: selectedBetail.id,
      nextVisible,
    })
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
    if (rawMessage.includes('farm_capacity_reached') || rawMessage.includes('farm_sites_full')) {
      return 'Votre ferme est pleine (180/180). Programmez des expéditions avant de racheter.'
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
          if (selectedBetailId === betailId) {
            setIsReportModalOpen(false)
            navigate('/betail-register', { replace: true })
          }
          void restartAudioSafely(purchaseAudio)
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
        navigate('/betail-register')
      }
    }
    window.addEventListener('keydown', handleEscape)
    return () => window.removeEventListener('keydown', handleEscape)
  }, [navigate, selectedBetailId])

  useEffect(() => {
    if (!selectedBetail) {
      setIsReportModalOpen(false)
    }
  }, [selectedBetail])

  useEffect(() => {
    if (selectedBetail) {
      setReportBetailVisible(Boolean(selectedBetail.visible ?? true))
    }
  }, [selectedBetail])

  useEffect(() => {
    document.title = selectedBetailTitle ? `FG - ${selectedBetailTitle}` : 'FG - Registre'
  }, [selectedBetailTitle])

  return (
    <div className="betails-page">
      <div className={`betails-layout ${selectedBetail ? 'has-panel' : ''}`}>
        <main className="betails-column-main betails-main">
          <header className="betails-header">
            <div className="betails-heading">
              <img
                className="betails-heading-image"
                src={betailSampleImage}
                alt=""
                aria-hidden="true"
              />
              <div>
                <h1 className="betails-title">Bétails disponibles</h1>
                <p className="betails-subtitle">{stats}</p>
              </div>
            </div>
            <div className="betails-actions">
              <button type="button" className="betails-back" onClick={() => navigate('/home')}>
                ← Retour à l'accueil
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
          {hasSelectedRouteLookupError && <p className="betails-error">{selectedRouteLookupErrorMessage}</p>}
          {shouldShowRouteBetailNotFound && (
            <p className="betails-error">404 - Le bétail demandé est introuvable ou n&apos;est plus disponible.</p>
          )}

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
                      likedByMe={isLikedByMe(betail)}
                      isLikePending={toggleLikeMutation.isPending}
                      isSelected={selectedBetailId === betail.id}
                      isPurchasing={purchasingId === betail.id && purchaseMutation.isPending}
                      onToggleLike={handleToggleLike}
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
                    onClick={handleOpenReportModal}
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
                    <h3 className="betail-back-title">
                      <OverflowAutoScrollText text={selectedBetail.name} />
                    </h3>
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

      <ReportBetailModal
        isOpen={isReportModalOpen}
        onClose={handleCloseReportModal}
        betail={selectedBetail}
        reporterId={user?.id || null}
        authorName={selectedAuthorName}
        createdAtLabel={formatFrenchDate(selectedCreatedAt)}
        description={selectedComment}
        canToggleVisibility={isAdminOrModeration}
        isBetailVisible={reportBetailVisible}
        isTogglingVisibility={visibilityToggleMutation.isPending}
        onToggleVisibility={handleToggleBetailVisibility}
      />
    </div>
  )
}

export default BetailsListPageQuery
