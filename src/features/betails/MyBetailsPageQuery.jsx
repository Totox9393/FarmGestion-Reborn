import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Archive, CalendarClock, Heart, Pin, Star } from 'lucide-react'
import {
  useAuthorsMap,
  useBetailDetails,
  useMyBetailsList,
  useToggleBetailArchived,
  useToggleBetailPinned,
  usePreviewBetailPremiumUpgrade,
  usePreviewBetailAgeGrowth,
  useGrowBetailAge,
  usePreviewBetailShippingSchedule,
  useConfirmBetailShippingSchedule,
  useUpgradeBetailPremium,
  useUpdateBetailComment,
  useUserFarmId,
  useUserRole,
} from './hooks'
import { useAuth } from '../authentification/AuthContext'
import { supabase } from '../authentification/supabaseClient'
import {
  MAX_BADGE_SLOTS,
  equipBetailBadgeReborn,
  fetchBetailBadgesEquipsReborn,
  fetchUserBadgesEquipsReborn,
  fetchUserBadgesInventoryReborn,
  unequipBetailBadgeReborn,
} from '../badges'
import premiumSuccessSound from '../../assets/sounds/GOCHISOU_7.WAV'
import pinInSound from '../../assets/sounds/pinin_005.ogg'
import pinOutSound from '../../assets/sounds/pinout_006.ogg'
import likeConfirmSound from '../../assets/sounds/confirmation_003.ogg'
import MyBetailsShippingPanel from './MyBetailsShippingPanel'
import { MAX_BETAIL_COMMENT_LENGTH, sanitizeBetailComment } from './betailCommentLimits'
import { createSafeAudio, playAudioSafely, restartAudioSafely } from '../utils/safeAudio'
import './BetailsListPage.css'
import './MyBetailsPage.css'

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

const getResourceFrameUrl = (filename, options = {}) => {
  if (!SUPABASE_URL) return ''
  const baseUrl = `${SUPABASE_URL}/storage/v1/object/public/ressources/${filename}`
  const { width, height, quality } = options || {}
  const params = new URLSearchParams()
  if (Number.isFinite(width) && width > 0) params.set('width', String(Math.round(width)))
  if (Number.isFinite(height) && height > 0) params.set('height', String(Math.round(height)))
  if (Number.isFinite(quality) && quality > 0) params.set('quality', String(Math.round(quality)))
  const query = params.toString()
  return query ? `${baseUrl}?${query}` : baseUrl
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

const isBetailShippingScheduled = (betail) => {
  const status = String(betail?.shipping_status || '').toLowerCase()
  return status === 'scheduled' || Boolean(betail?.is_shipping_scheduled)
}

const isNotAuthenticatedError = (error) => {
  const message = String(error?.message || '').toLowerCase()
  return message.includes('not authenticated')
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

function MyBetailCard({ betail, authorName, likedByMe, isLikePending, onToggleLike, isSelected, onSelect }) {
  const isShippingScheduled = isBetailShippingScheduled(betail)
  const shippingDateLabel = betail?.shipping_scheduled_for
    ? formatFrenchDate(betail.shipping_scheduled_for)
    : ''

  const handleSelect = () => onSelect?.(betail.id)

  const handleKeyDown = (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      handleSelect()
    }
  }

  return (
    <article
      className={`betail-card ${isSelected ? 'is-selected' : ''} ${betail.archived ? 'is-archived' : ''} ${betail.pinned ? 'is-pinned' : ''} ${isShippingScheduled ? 'is-shipping-scheduled' : ''}`}
      onClick={handleSelect}
      onKeyDown={handleKeyDown}
      role="button"
      tabIndex={0}
      aria-pressed={isSelected}
    >
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
          <h3 className="betail-name">
            <OverflowAutoScrollText text={betail.name} />
          </h3>
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
          {isShippingScheduled && (
            <span className="my-betail-icon-wrap" tabIndex={0}>
              <CalendarClock size={15} className="my-betail-icon is-shipping-scheduled" />
              <span className="my-betail-tooltip" role="tooltip">
                {shippingDateLabel ? `Expédition prévue: ${shippingDateLabel}` : 'Expédition déjà programmée'}
              </span>
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
  const [isShippingPanelOpen, setIsShippingPanelOpen] = useState(false)
  const [shippingTarget, setShippingTarget] = useState(null)
  const [isBadgeModalOpen, setIsBadgeModalOpen] = useState(false)
  const [badgeModalSlot, setBadgeModalSlot] = useState(null)
  const premiumAnimationTimeoutRef = useRef(null)
  const shippingPanelTimeoutRef = useRef(null)
  const panelRef = useRef(null)
  const queryClient = useQueryClient()
  const likeConfirmAudio = useMemo(() => createSafeAudio(likeConfirmSound), [])

  const { data: farmId } = useUserFarmId(user?.id)
  const { data: userRole = '' } = useUserRole(user?.id)

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
  const growthPreviewMutation = usePreviewBetailAgeGrowth()
  const growBetailAgeMutation = useGrowBetailAge()
  const previewShippingScheduleMutation = usePreviewBetailShippingSchedule()
  const confirmShippingScheduleMutation = useConfirmBetailShippingSchedule()
  const togglePinnedMutation = useToggleBetailPinned()
  const toggleArchivedMutation = useToggleBetailArchived()
  const toggleLikeMutation = useMutation({
    mutationFn: async ({ betailId, currentlyLiked }) => {
      if (!user?.id) {
        throw new Error('Not authenticated')
      }

      const rpcName = currentlyLiked ? 'unlike_betail' : 'like_betail'
      const { data: rpcResult, error: rpcError } = await supabase.rpc(rpcName, { p_betail_id: betailId })
      if (rpcError) throw rpcError

      const payload = Array.isArray(rpcResult) ? rpcResult[0] : rpcResult
      return {
        betailId,
        liked: Boolean(payload?.liked),
        likeCount: Number(payload?.like_count),
      }
    },
    onMutate: async ({ betailId, currentlyLiked }) => {
      await queryClient.cancelQueries({ queryKey: ['betails', 'my-list'] })
      const previousList = queryClient.getQueriesData({ queryKey: ['betails', 'my-list'] })
      const nextLiked = !currentlyLiked

      queryClient.setQueriesData({ queryKey: ['betails', 'my-list'] }, (oldData) => {
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
        toast('error', 'Connectez-vous pour aimer un bétail.')
        return
      }

      toast('error', 'Impossible de mettre a jour le like pour le moment.')
    },
    onSuccess: ({ betailId, liked, likeCount }) => {
      queryClient.setQueriesData({ queryKey: ['betails', 'my-list'] }, (oldData) => {
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

  const equipBadgeMutation = useMutation({
    mutationFn: ({ badgeId, slot }) => equipBetailBadgeReborn({
      badgeId,
      betailId: selectedBetail?.id,
      slot,
    }),
    onSuccess: async (_result, variables) => {
      const badgeId = variables?.badgeId
      if (badgeId) {
        queryClient.setQueryData(['badges', 'equips', user?.id || 'anon'], (current) => {
          const currentItems = Array.isArray(current) ? current : []
          if (currentItems.some((badge) => badge?.id === badgeId)) return currentItems
          return [...currentItems, { id: badgeId }]
        })
      }

      queryClient.invalidateQueries({ queryKey: ['badges', 'equips', user?.id || 'anon'] })
      queryClient.invalidateQueries({ queryKey: ['badges', 'equips', 'betail', selectedBetail?.id || 'none'] })
      queryClient.invalidateQueries({ queryKey: ['badges', 'inventory', user?.id || 'anon'] })
      queryClient.invalidateQueries({ queryKey: ['farm', 'equips'] })

      await Promise.all([
        queryClient.refetchQueries({ queryKey: ['badges', 'equips', user?.id || 'anon'], exact: true }),
        queryClient.refetchQueries({ queryKey: ['badges', 'equips', 'betail', selectedBetail?.id || 'none'], exact: true }),
      ])
    },
  })

  const unequipBadgeMutation = useMutation({
    mutationFn: ({ badgeId }) => unequipBetailBadgeReborn({
      badgeId,
      betailId: selectedBetail?.id,
    }),
    onSuccess: async (_result, variables) => {
      const badgeId = variables?.badgeId
      if (badgeId) {
        queryClient.setQueryData(['badges', 'equips', user?.id || 'anon'], (current) => {
          const currentItems = Array.isArray(current) ? current : []
          return currentItems.filter((badge) => badge?.id !== badgeId)
        })
      }

      queryClient.invalidateQueries({ queryKey: ['badges', 'equips', user?.id || 'anon'] })
      queryClient.invalidateQueries({ queryKey: ['badges', 'equips', 'betail', selectedBetail?.id || 'none'] })
      queryClient.invalidateQueries({ queryKey: ['badges', 'inventory', user?.id || 'anon'] })
      queryClient.invalidateQueries({ queryKey: ['farm', 'equips'] })

      await Promise.all([
        queryClient.refetchQueries({ queryKey: ['badges', 'equips', user?.id || 'anon'], exact: true }),
        queryClient.refetchQueries({ queryKey: ['badges', 'equips', 'betail', selectedBetail?.id || 'none'], exact: true }),
      ])
    },
  })

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

  const filteredBetails = useMemo(() => {
    if (filterMode !== 'shipping_scheduled') {
      return sortedBetails
    }

    return sortedBetails.filter((item) => isBetailShippingScheduled(item))
  }, [filterMode, sortedBetails])
  const visibleBetailIds = useMemo(
    () => Array.from(new Set((filteredBetails || []).map((item) => String(item?.id || '')).filter(Boolean))).sort(),
    [filteredBetails],
  )

  const { data: likedRows = [] } = useQuery({
    queryKey: ['betails', 'liked', user?.id || 'anon', visibleBetailIds],
    enabled: Boolean(user?.id) && visibleBetailIds.length > 0,
    queryFn: async () => {
      const { data: rows, error: likedError } = await supabase
        .from('betail_likes')
        .select('betail_id')
        .eq('user_id', user.id)
        .in('betail_id', visibleBetailIds)

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
  const selectedBetail = useMemo(
    () => filteredBetails.find((item) => item.id === selectedBetailId) ?? null,
    [filteredBetails, selectedBetailId],
  )
  const selectedBetailTitle = String(selectedBetail?.name || '').trim()

  const { data: selectedDetails, isFetching: isFetchingSelectedDetails } = useBetailDetails(
    selectedBetailId,
    Boolean(selectedBetailId),
  )

  const { data: userInventoryBadges = [] } = useQuery({
    queryKey: ['badges', 'inventory', user?.id || 'anon'],
    enabled: Boolean(user?.id),
    queryFn: () => fetchUserBadgesInventoryReborn(user.id),
    staleTime: 60_000,
  })

  const { data: userEquippedBadges = [] } = useQuery({
    queryKey: ['badges', 'equips', user?.id || 'anon'],
    enabled: Boolean(user?.id),
    queryFn: () => fetchUserBadgesEquipsReborn(user.id),
    staleTime: 30_000,
  })

  const { data: selectedBetailEquips = [] } = useQuery({
    queryKey: ['badges', 'equips', 'betail', selectedBetail?.id || 'none'],
    enabled: Boolean(selectedBetail?.id && user?.id),
    queryFn: () => fetchBetailBadgesEquipsReborn(selectedBetail.id),
    staleTime: 20_000,
  })

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
    const count = filteredBetails.length
    return `${count} résultat${count > 1 ? 's' : ''}`
  }, [filteredBetails.length])

  const selectedAvatarFrameUrl = useMemo(() => getResourceFrameUrl('cadre_betail1.png'), [])
  const matriculeFrameUrl = useMemo(() => getResourceFrameUrl('cadre_matricule.png'), [])
  const shippingMascotUrl = useMemo(
    () => getResourceFrameUrl('milo_demon.png', { width: 360, height: 360, quality: 78 }),
    [],
  )
  const shippingDecorUrls = useMemo(() => {
    const gupna = Array.from({ length: 9 }, (_, index) =>
      getResourceFrameUrl(`gupna${index + 1}.png`, { width: 128, height: 128, quality: 66 }),
    ).filter(Boolean)

    return {
      gupna,
      coins: getResourceFrameUrl('coins.png', { width: 180, height: 180, quality: 72 }),
    }
  }, [])
  const selectedAuthorName = selectedBetail ? getAuthorName(selectedBetail) : 'Auteur inconnu'
  const selectedCreatedAt = selectedDetails?.created_at || selectedBetail?.created_at
  const selectedPurchasedAt = selectedDetails?.purchased_at || selectedBetail?.purchased_at
  const selectedComment = selectedDetails?.comments ?? selectedBetail?.comments ?? ''
  const selectedIsShippingScheduled = isBetailShippingScheduled(selectedBetail)
  const selectedShippingLockReason = 'Bétail verrouillé : Expédition déjà programmée.'
  const selectedShippingScheduledDate = selectedBetail?.shipping_scheduled_for
    ? formatFrenchDate(selectedBetail.shipping_scheduled_for)
    : ''
  const selectedEquippedBadges = useMemo(() => {
    return [...(selectedBetailEquips || [])]
      .sort((a, b) => (a.slot || 99) - (b.slot || 99))
  }, [selectedBetailEquips])
  const userInventoryPurchasePriceByBadgeId = useMemo(() => {
    const map = new Map()
    for (const badge of userInventoryBadges || []) {
      if (!badge?.id) continue
      const purchasePrice = Number(badge?.purchasePrice)
      map.set(badge.id, Number.isFinite(purchasePrice) ? Math.max(0, purchasePrice) : 0)
    }
    return map
  }, [userInventoryBadges])
  const selectedEquippedBadgePurchaseBonus = useMemo(() => {
    const totalPaid = selectedEquippedBadges.reduce((sum, badge) => {
      const paidPrice = Number(userInventoryPurchasePriceByBadgeId.get(badge?.id))
      if (!Number.isFinite(paidPrice) || paidPrice <= 0) return sum
      return sum + paidPrice
    }, 0)
    return Math.floor(totalPaid * 0.75)
  }, [selectedEquippedBadges, userInventoryPurchasePriceByBadgeId])
  const selectedBadgesBySlot = useMemo(() => {
    const map = new Map()
    selectedEquippedBadges.forEach((badge) => {
      if (Number.isFinite(Number(badge?.slot))) {
        map.set(Number(badge.slot), badge)
      }
    })
    return map
  }, [selectedEquippedBadges])
  const selectedBadgeSlotsRemaining = Math.max(0, MAX_BADGE_SLOTS - selectedEquippedBadges.length)
  const userEquippedBadgeIdSet = useMemo(
    () => new Set((userEquippedBadges || []).map((badge) => badge.id)),
    [userEquippedBadges],
  )
  const availableInventoryBadges = useMemo(() => {
    return (userInventoryBadges || []).filter((badge) => !userEquippedBadgeIdSet.has(badge.id))
  }, [userInventoryBadges, userEquippedBadgeIdSet])
  const canEquipSelectedBetail = Boolean(selectedBetail?.id) && !selectedIsShippingScheduled
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

  const isLikedByMe = (betail) => Boolean(betail?.liked_by_me) || likedIdsSet.has(String(betail?.id || ''))

  const handleToggleLike = (betail, currentlyLiked) => {
    if (!betail?.id || toggleLikeMutation.isPending) return
    toggleLikeMutation.mutate({
      betailId: betail.id,
      currentlyLiked: Boolean(currentlyLiked),
    })
  }

  const clearPremiumAnimationTimeout = useCallback(() => {
    if (!premiumAnimationTimeoutRef.current) return
    window.clearTimeout(premiumAnimationTimeoutRef.current)
    premiumAnimationTimeoutRef.current = null
  }, [])

  const clearShippingPanelTimeout = useCallback(() => {
    if (!shippingPanelTimeoutRef.current) return
    window.clearTimeout(shippingPanelTimeoutRef.current)
    shippingPanelTimeoutRef.current = null
  }, [])

  const playPremiumSuccessSound = useCallback(() => {
    try {
      const audio = createSafeAudio(premiumSuccessSound, { volume: 0.85 })
      void playAudioSafely(audio)
    } catch {
      // silence volontaire si autoplay bloqué
    }
  }, [])

  const playPinSound = useCallback((isPinning) => {
    try {
      const soundFile = isPinning ? pinInSound : pinOutSound
      const audio = createSafeAudio(soundFile, { volume: 0.7 })
      void playAudioSafely(audio)
    } catch {
      // silence volontaire si autoplay bloqué
    }
  }, [])

  const handleCloseBadgeModal = useCallback(() => {
    setIsBadgeModalOpen(false)
    setBadgeModalSlot(null)
  }, [])

  useEffect(() => {
    if (!selectedBetailId && !isShippingPanelOpen && !isBadgeModalOpen) return
    const handleEscape = (event) => {
      if (event.key === 'Escape') {
        if (isBadgeModalOpen) {
          handleCloseBadgeModal()
          return
        }
        clearShippingPanelTimeout()
        setSelectedBetailId(null)
        setIsShippingPanelOpen(false)
        setShippingTarget(null)
      }
    }
    window.addEventListener('keydown', handleEscape)
    return () => window.removeEventListener('keydown', handleEscape)
  }, [selectedBetailId, isShippingPanelOpen, isBadgeModalOpen, clearShippingPanelTimeout, handleCloseBadgeModal])

  useEffect(() => {
    if (!selectedBetailId || isInitialLoading) return
    const stillVisible = filteredBetails.some((item) => item.id === selectedBetailId)
    if (!stillVisible) {
      setSelectedBetailId(null)
    }
  }, [filteredBetails, isInitialLoading, selectedBetailId])

  useEffect(() => {
    if (!selectedBetail) {
      setEditingComment(false)
      setPremiumConfirmState(null)
      setIsBadgeModalOpen(false)
      setBadgeModalSlot(null)
      return
    }
    setCommentDraft(sanitizeBetailComment(selectedComment || ''))
  }, [selectedBetail, selectedComment])

  useEffect(() => {
    setPremiumAnimationPhase('idle')
    setPremiumConfirmState(null)
    clearPremiumAnimationTimeout()
  }, [selectedBetailId, clearPremiumAnimationTimeout])

  useEffect(
    () => () => {
      clearPremiumAnimationTimeout()
      clearShippingPanelTimeout()
    },
    [clearPremiumAnimationTimeout, clearShippingPanelTimeout],
  )

  useEffect(() => {
    document.title = selectedBetailTitle ? `FG - ${selectedBetailTitle}` : 'FG - Mes bétails'
  }, [selectedBetailTitle])

  const handleSelectBetail = (betailId) => {
    clearShippingPanelTimeout()
    handleCloseBadgeModal()
    setIsShippingPanelOpen(false)
    setShippingTarget(null)
    setSelectedBetailId((prev) => (prev === betailId ? null : betailId))
  }

  const handleOpenShippingPanel = () => {
    if (!selectedBetail) return
    if (selectedIsShippingScheduled) {
      toast('error', 'Ce bétail a déjà une expédition programmée.')
      return
    }

    clearShippingPanelTimeout()
    setShippingTarget({
      id: selectedBetail.id,
      name: selectedBetail.name || 'Bétail inconnu',
      matricule: selectedBetail.matricule || '---',
      premium: Boolean(selectedBetail.premium),
      role: userRole,
      avatarUrl: selectedBetail.avatar_url ? getThumbnailUrl(selectedBetail.avatar_url) : '',
      age: Number.isFinite(Number(selectedBetail.age)) ? Number(selectedBetail.age) : null,
      createdAt: selectedCreatedAt || null,
      badgeCount: selectedEquippedBadges.length,
      badgePurchaseBonus: selectedEquippedBadgePurchaseBonus,
      shippingEstimatedGain: Number.isFinite(Number(selectedBetail.shipping_estimated_gain))
        ? Number(selectedBetail.shipping_estimated_gain)
        : null,
    })
    setSelectedBetailId(null)
    shippingPanelTimeoutRef.current = window.setTimeout(() => {
      setIsShippingPanelOpen(true)
      shippingPanelTimeoutRef.current = null
    }, 180)
  }

  const handleCloseShippingPanel = () => {
    clearShippingPanelTimeout()
    setIsShippingPanelOpen(false)
    setShippingTarget(null)
  }

  const handleGoToGce = useCallback(() => {
    navigate('/gce')
  }, [navigate])

  const handleOpenBadgeEquipModal = useCallback((slot) => {
    if (!selectedBetail?.id) return
    if (selectedIsShippingScheduled) {
      toast('error', selectedShippingLockReason)
      return
    }
    if (selectedEquippedBadges.length >= MAX_BADGE_SLOTS) {
      toast('error', 'Tous les emplacements de badges sont deja occupes.')
      return
    }
    setBadgeModalSlot(Number.isFinite(Number(slot)) ? Number(slot) : null)
    setIsBadgeModalOpen(true)
  }, [selectedBetail?.id, selectedIsShippingScheduled, selectedShippingLockReason, selectedEquippedBadges.length])

  const handleEquipBadgeOnSelectedBetail = useCallback(async (badgeId) => {
    if (!selectedBetail?.id || !badgeId || equipBadgeMutation.isPending) return
    try {
      const result = await equipBadgeMutation.mutateAsync({
        badgeId,
        slot: badgeModalSlot,
      })

      if (!result?.success) {
        const reason = result?.reason || 'UNKNOWN'
        if (reason === 'SHIPPING_LOCKED') {
          toast('error', selectedShippingLockReason)
        } else if (reason === 'NO_FREE_SLOT' || reason === 'SLOT_OCCUPIED') {
          toast('error', 'Slot indisponible.')
        } else if (reason === 'BADGE_ALREADY_EQUIPPED') {
          toast('error', 'Ce badge est deja equipe ailleurs.')
        } else if (reason === 'BADGE_NOT_OWNED') {
          toast('error', 'Ce badge nest pas dans ton inventaire.')
        } else {
          toast('error', 'Equipement impossible pour le moment.')
        }
        return
      }

      toast('success', 'Badge equipe sur le betail.')
      setIsBadgeModalOpen(false)
      setBadgeModalSlot(null)
    } catch (error) {
      const message = String(error?.message || '').toLowerCase()
      if (error?.code === '42883' || message.includes('equip_betail_badge_reborn')) {
        toast('error', 'Fonction SQL equip_betail_badge_reborn absente.')
      } else {
        toast('error', 'Erreur pendant equipement du badge.')
      }
    }
  }, [
    selectedBetail?.id,
    equipBadgeMutation,
    badgeModalSlot,
    selectedShippingLockReason,
  ])

  const handleUnequipBadgeFromSelectedBetail = useCallback(async (badgeId) => {
    if (!selectedBetail?.id || !badgeId || unequipBadgeMutation.isPending) return
    if (selectedIsShippingScheduled) {
      toast('error', selectedShippingLockReason)
      return
    }

    try {
      const result = await unequipBadgeMutation.mutateAsync({ badgeId })
      if (!result?.success) {
        const reason = result?.reason || 'UNKNOWN'
        if (reason === 'SHIPPING_LOCKED') {
          toast('error', selectedShippingLockReason)
        } else {
          toast('error', 'Desequipement impossible pour le moment.')
        }
        return
      }
      toast('success', 'Badge retire du betail.')
    } catch (error) {
      const message = String(error?.message || '').toLowerCase()
      if (error?.code === '42883' || message.includes('unequip_betail_badge_reborn')) {
        toast('error', 'Fonction SQL unequip_betail_badge_reborn absente.')
      } else {
        toast('error', 'Erreur pendant desequipement du badge.')
      }
    }
  }, [selectedBetail?.id, selectedIsShippingScheduled, selectedShippingLockReason, unequipBadgeMutation])

  const handlePreviewShippingGrowth = useCallback(async (betailId) => {
    if (!betailId) {
      return { success: false, reason: 'NOT_FOUND' }
    }

    try {
      return await growthPreviewMutation.mutateAsync({ betailId })
    } catch (previewError) {
      const message = (previewError?.message || '').toLowerCase()
      const code = previewError?.code || ''
      if (code === '42883' || message.includes('grow_betail_age_reborn')) {
        return {
          success: false,
          reason: 'GROWTH_RPC_MISSING',
        }
      }
      return {
        success: false,
        reason: 'PREVIEW_ERROR',
      }
    }
  }, [growthPreviewMutation.mutateAsync])

  const handleConfirmShippingGrowth = useCallback(async (betailId) => {
    if (!betailId || !user?.id) {
      return { success: false, reason: 'NOT_AUTHENTICATED' }
    }

    try {
      const result = await growBetailAgeMutation.mutateAsync({ betailId })
      if (!result?.success) {
        return result
      }

      const newAge = Number(result?.new_age)
      if (Number.isFinite(newAge)) {
        setShippingTarget((prev) => (prev?.id === betailId ? { ...prev, age: newAge } : prev))
      }

      const moneyAfter = Number(result?.money_after)
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
      return result
    } catch (growthError) {
      const message = (growthError?.message || '').toLowerCase()
      const code = growthError?.code || ''
      if (code === '42883' || message.includes('grow_betail_age_reborn')) {
        return {
          success: false,
          reason: 'GROWTH_RPC_MISSING',
        }
      }
      return {
        success: false,
        reason: 'GROWTH_ERROR',
      }
    }
  }, [growBetailAgeMutation.mutateAsync, user?.id])

  const handlePreviewShippingSchedule = useCallback(async ({
    betailId,
    requestedDate = null,
    manualChoice = false,
    note = null,
    estimatedGain = null,
    minDaysAhead = 7,
    maxDaysAhead = 60,
    allowReassign = false,
  }) => {
    if (!betailId) {
      return { success: false, reason: 'NOT_FOUND' }
    }

    try {
      return await previewShippingScheduleMutation.mutateAsync({
        betailId,
        requestedDate,
        manualChoice,
        note,
        estimatedGain,
        minDaysAhead,
        maxDaysAhead,
        allowReassign,
      })
    } catch (scheduleError) {
      const message = (scheduleError?.message || '').toLowerCase()
      const code = scheduleError?.code || ''
      if (code === '42883' || message.includes('schedule_shipping_reborn')) {
        return {
          success: false,
          reason: 'SHIPPING_RPC_MISSING',
        }
      }
      return {
        success: false,
        reason: 'SHIPPING_PREVIEW_ERROR',
      }
    }
  }, [previewShippingScheduleMutation.mutateAsync])

  const handleConfirmShippingSchedule = useCallback(async ({
    betailId,
    requestedDate = null,
    manualChoice = false,
    note = null,
    estimatedGain = null,
    minDaysAhead = 7,
    maxDaysAhead = 60,
    allowReassign = true,
  }) => {
    if (!betailId || !user?.id) {
      return { success: false, reason: 'NOT_AUTHENTICATED' }
    }

    try {
      const result = await confirmShippingScheduleMutation.mutateAsync({
        betailId,
        requestedDate,
        manualChoice,
        note,
        estimatedGain,
        minDaysAhead,
        maxDaysAhead,
        allowReassign,
      })

      if (!result?.success) return result

      if (result?.already_scheduled) {
        toast('success', 'Créneau déjà fixé: date conservée pour ce bétail.')
      } else {
        toast('success', result?.reassigned ? 'Créneau ajusté puis validé.' : 'Créneau d’expédition validé.')
      }
      return result
    } catch (scheduleError) {
      const message = (scheduleError?.message || '').toLowerCase()
      const code = scheduleError?.code || ''
      if (code === '42883' || message.includes('schedule_shipping_reborn')) {
        return {
          success: false,
          reason: 'SHIPPING_RPC_MISSING',
        }
      }
      return {
        success: false,
        reason: 'SHIPPING_CONFIRM_ERROR',
      }
    }
  }, [confirmShippingScheduleMutation.mutateAsync, user?.id])

  const hasRightPanel = Boolean(selectedBetail || isShippingPanelOpen)
  const layoutClassName = `betails-layout my-betails-layout ${hasRightPanel ? 'has-panel' : ''}`.trim()

  const handleSaveComment = () => {
    if (!selectedBetail || !user?.id) return
    if (selectedIsShippingScheduled) {
      toast('error', selectedShippingLockReason)
      return
    }
    const normalizedCommentDraft = sanitizeBetailComment(commentDraft)
    commentMutation.mutate(
      {
        betailId: selectedBetail.id,
        comment: normalizedCommentDraft,
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

  const runToggle = ({ mutation, nextValue, successMessage, fallbackMessage, allowWhenShipping = false }) => {
    if (!selectedBetail || !user?.id || mutation.isPending) return
    if (selectedIsShippingScheduled && !allowWhenShipping) {
      toast('error', selectedShippingLockReason)
      return
    }
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
          if (toggleError?.code === 'MAX_PINNED_BETAILS' || String(toggleError?.message || '').includes('MAX_PINNED_BETAILS:4')) {
            toast('error', 'Tu peux épingler maximum 4 bétails.')
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
      fallbackMessage: 'Préférence épinglé indisponible pour le moment.',
      allowWhenShipping: true,
    })
  }

  //TODO : Ameliorer le design de l'animation de la transmutation premium, notamment sur mobile


  const runPremiumUpgrade = () => {
    if (!selectedBetail || !user?.id || premiumUpgradeMutation.isPending || selectedBetail.premium) return
    if (selectedIsShippingScheduled) {
      toast('error', selectedShippingLockReason)
      return
    }

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
    if (selectedIsShippingScheduled) {
      toast('error', selectedShippingLockReason)
      return
    }

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
      <div className={layoutClassName}>
        <main className="betails-column-main betails-main my-betails-main">
          <header className="betails-header">
            <div>
              <p className="betails-eyebrow">Inventaire</p>
              <h1 className="betails-title">Mes bétails</h1>
              <p className="betails-subtitle">{stats}</p>
              <p className="my-betails-pin-hint">Les bétails épinglés remontent automatiquement sur ton profil.</p>
            </div>
            <div className="betails-actions my-betails-actions">
              <button type="button" className="betails-back" onClick={() => navigate('/home')}>
                ← Retour à l'accueil
              </button>
              <button
                type="button"
                className="betails-back"
                onClick={() => (farmId ? navigate(`/farm/${farmId}`) : navigate('/home'))}
              >
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
                <option value="shipping_scheduled">Expédition prévue</option>
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
                  {filteredBetails.map((betail) => (
                    <MyBetailCard
                      key={betail.id}
                      betail={betail}
                      authorName={getAuthorName(betail)}
                      likedByMe={isLikedByMe(betail)}
                      isLikePending={toggleLikeMutation.isPending}
                      onToggleLike={handleToggleLike}
                      isSelected={selectedBetailId === betail.id}
                      onSelect={handleSelectBetail}
                    />
                  ))}
                </div>

                {!filteredBetails.length && !hasError && (
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

        {selectedBetail ? (
          <aside className="betails-column-panel my-betails-panel-column my-details-panel-column" aria-hidden={!selectedBetail}>
          <section
            ref={panelRef}
            className={`betail-details-panel betails-panel my-betail-panel ${selectedBetail ? 'is-open' : ''}`}
            aria-live="polite"
          >
            {selectedBetail ? (
              <>
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
                          fallbackMessage: 'Préférence archivage indisponible pour le moment.',
                        })
                      }
                      disabled={isSaving || selectedIsShippingScheduled}
                      aria-label={selectedBetail.archived ? 'Désarchiver ce bétail' : 'Archiver ce bétail'}
                      title={selectedIsShippingScheduled ? selectedShippingLockReason : (selectedBetail.archived ? 'Désarchiver' : 'Archiver')}
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
                              setCommentDraft(sanitizeBetailComment(selectedComment || ''))
                              setEditingComment(true)
                            }}
                            disabled={isSaving || selectedIsShippingScheduled}
                            title={selectedIsShippingScheduled ? selectedShippingLockReason : 'Modifier le commentaire'}
                          >
                            Modifier
                          </button>
                        ) : null}
                      </div>

                      {selectedIsShippingScheduled ? (
                        <p className="my-betail-lock-hint" role="status" aria-live="polite">
                          Bétail verrouillé : Expédition déjà programmée.
                        </p>
                      ) : null}

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
                            onChange={(event) => setCommentDraft(sanitizeBetailComment(event.target.value))}
                            maxLength={MAX_BETAIL_COMMENT_LENGTH}
                            disabled={selectedIsShippingScheduled}
                          />
                          <div className="my-betail-inline-actions">
                            <button
                              type="button"
                              className="my-betail-btn"
                              onClick={handleSaveComment}
                              disabled={isSaving || selectedIsShippingScheduled}
                            >
                              Enregistrer
                            </button>
                            <button
                              type="button"
                              className="my-betail-btn ghost"
                              onClick={() => {
                                setEditingComment(false)
                                setCommentDraft(sanitizeBetailComment(selectedComment || ''))
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
                            disabled={isSaving || selectedIsShippingScheduled}
                            title={selectedIsShippingScheduled ? selectedShippingLockReason : 'Prévisualiser le coût premium'}
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
                                disabled={isSaving || premiumConfirmState.loading || !premiumConfirmState.canAfford || selectedIsShippingScheduled}
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

                      </div>
                    </section>
                  ) : null}

                  <section className="my-betail-section my-betail-badges-section">
                    <div className="my-betail-section-head">
                      <h3>Badges du bétail</h3>
                      <span className="my-betail-badge-count">{selectedEquippedBadges.length}</span>
                    </div>
                    <div className="my-betail-badges-grid" role="list" aria-label="Badges équipés">
                      {Array.from({ length: MAX_BADGE_SLOTS }, (_, index) => {
                        const slot = index + 1
                        const badge = selectedBadgesBySlot.get(slot)
                        if (badge) {
                          return (
                            <article
                              key={badge.id}
                              className={`my-betail-badge-card ${badge.rarity ? `is-${badge.rarity}` : 'is-unknown'}`}
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
                              <p className="my-betail-badge-name">{badge.name}</p>
                              <p className="my-betail-badge-rarity">
                                {badge.rarityLabel} • Slot {slot}
                              </p>
                              <button
                                type="button"
                                className="my-betail-badge-remove"
                                onClick={() => handleUnequipBadgeFromSelectedBetail(badge.id)}
                                disabled={unequipBadgeMutation.isPending || selectedIsShippingScheduled}
                              >
                                Retirer
                              </button>
                            </article>
                          )
                        }

                        return (
                          <button
                            key={`badge-empty-slot-${slot}`}
                            type="button"
                            className="my-betail-badge-card my-betail-badge-slot"
                            onClick={() => handleOpenBadgeEquipModal(slot)}
                            aria-label={`Équiper un badge sur le slot ${slot}`}
                            disabled={!canEquipSelectedBetail}
                          >
                            <span className="my-betail-badge-slot-plus" aria-hidden="true">+</span>
                            <p className="my-betail-badge-slot-name">Slot {slot}</p>
                            <p className="my-betail-badge-slot-hint">Équiper un badge</p>
                          </button>
                        )
                      })}
                    </div>
                    {selectedIsShippingScheduled ? (
                      <p className="my-betail-ship-status" role="status" aria-live="polite">
                        {selectedShippingLockReason}
                      </p>
                    ) : null}
                    <button
                      type="button"
                      className="my-betail-btn ghost my-betail-shop-btn"
                      onClick={() => navigate('/boutique')}
                    >
                      Boutique badges
                    </button>
                    {selectedBadgeSlotsRemaining > 0 ? (
                      <p className="my-betail-badge-helper">{selectedBadgeSlotsRemaining} emplacement(s) libre(s).</p>
                    ) : null}
                  </section>

                  <section className="my-betail-section my-betail-shipping-section">
                    <div className="my-betail-section-head">
                      <h3>Expédition</h3>
                    </div>
                    <button
                      type="button"
                      className="my-betail-btn my-betail-ship-btn"
                      onClick={handleOpenShippingPanel}
                      disabled={selectedIsShippingScheduled}
                      title={
                        selectedIsShippingScheduled
                          ? 'Ce bétail est déjà prévu en expédition.'
                          : 'Ouvrir le panneau d’expédition'
                      }
                    >
                      {selectedIsShippingScheduled ? 'Expédition déjà prévue' : 'Expédier le bétail'}
                    </button>
                    {selectedIsShippingScheduled ? (
                      <p className="my-betail-ship-status" role="status" aria-live="polite">
                        {selectedShippingScheduledDate
                          ? `Créneau déjà fixé: ${selectedShippingScheduledDate}.`
                          : 'Créneau déjà fixé pour ce bétail.'}
                      </p>
                    ) : null}
                  </section>
                </div>
              </>
            ) : (
              <div className="my-betail-empty-panel">Sélectionne un bétail pour afficher ses détails.</div>
            )}
          </section>
          </aside>
        ) : isShippingPanelOpen ? (
          <MyBetailsShippingPanel
            isOpen={isShippingPanelOpen}
            onClose={handleCloseShippingPanel}
            shippingTarget={shippingTarget}
            mascotUrl={shippingMascotUrl}
            decorUrls={shippingDecorUrls}
            onPreviewGrowth={handlePreviewShippingGrowth}
            onConfirmGrowth={handleConfirmShippingGrowth}
            isGrowthPending={growBetailAgeMutation.isPending}
            onPreviewShipping={handlePreviewShippingSchedule}
            onConfirmShipping={handleConfirmShippingSchedule}
            isShippingPending={confirmShippingScheduleMutation.isPending}
            onGoToGce={handleGoToGce}
          />
        ) : null}
        {isBadgeModalOpen ? (
          <div
            className="my-betail-badge-modal-backdrop"
            role="presentation"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) {
                handleCloseBadgeModal()
              }
            }}
          >
            <div
              className="my-betail-badge-modal"
              role="dialog"
              aria-modal="true"
              aria-labelledby="my-betail-badge-modal-title"
              onMouseDown={(event) => event.stopPropagation()}
            >
              <p className="my-betail-badge-modal-kicker">Gestion badges</p>
              <h3 id="my-betail-badge-modal-title">Equiper un badge</h3>
              <p className="my-betail-badge-modal-subtitle">
                Selectionne un badge libre pour le slot {badgeModalSlot || 'auto'}.
              </p>

              {availableInventoryBadges.length ? (
                <div className="my-betail-badge-modal-grid" role="list" aria-label="Inventaire badges disponibles">
                  {availableInventoryBadges.map((badge) => (
                    <button
                      key={badge.id}
                      type="button"
                      className={`my-betail-badge-modal-card ${badge.rarity ? `is-${badge.rarity}` : 'is-unknown'}`}
                      role="listitem"
                      onClick={() => handleEquipBadgeOnSelectedBetail(badge.id)}
                      disabled={equipBadgeMutation.isPending}
                    >
                      {badge.imageUrl ? (
                        <img
                          src={badge.imageUrl}
                          alt={badge.filename}
                          className="my-betail-badge-modal-image"
                          loading="lazy"
                          decoding="async"
                          onError={(event) => {
                            event.currentTarget.style.display = 'none'
                          }}
                        />
                      ) : (
                        <span className="my-betail-badge-modal-fallback" aria-hidden="true">?</span>
                      )}
                      <span className="my-betail-badge-modal-name">{badge.name}</span>
                      <span className="my-betail-badge-modal-rarity">{badge.rarityLabel}</span>
                    </button>
                  ))}
                </div>
              ) : (
                <p className="my-betail-badge-modal-empty">
                  Aucun badge libre. Retire un badge d'un autre emplacement ou achete-en en boutique.
                </p>
              )}

              <div className="my-betail-badge-modal-actions">
                <button
                  type="button"
                  className="my-betail-btn ghost"
                  onClick={handleCloseBadgeModal}
                  disabled={equipBadgeMutation.isPending}
                >
                  Fermer
                </button>
                <button
                  type="button"
                  className="my-betail-btn ghost my-betail-shop-btn"
                  onClick={() => {
                    handleCloseBadgeModal()
                    navigate('/boutique')
                  }}
                  disabled={equipBadgeMutation.isPending}
                >
                  Boutique badges
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  )
}

export default MyBetailsPageQuery


