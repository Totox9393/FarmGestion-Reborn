import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import {
  Archive,
  Bell,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  FileText,
  Gauge,
  Grip,
  ListChecks,
  Package,
  RefreshCcw,
  Settings,
} from 'lucide-react'
import { supabase } from '../../../authentification/supabaseClient'
import gupna1 from '../../../../assets/img/gupna/gupna1.png'
import gupna3 from '../../../../assets/img/gupna/gupna3.png'
import gupna6 from '../../../../assets/img/gupna/gupna6.png'
import './GCEPage.css'

const PARIS_TIMEZONE = 'Europe/Paris'
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
const WEEK_DAYS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim']
const MONTH_NAMES_FR = [
  'Janvier',
  'Février',
  'Mars',
  'Avril',
  'Mai',
  'Juin',
  'Juillet',
  'Août',
  'Septembre',
  'Octobre',
  'Novembre',
  'Décembre',
]
const MAX_PAST_MONTHS = 6
const DEBUG_GCE =  false//Boolean(import.meta.env.DEV)
const REMAINING_PROGRESS_WINDOW_MS = 1000 * 60 * 60 * 24 * 30
const DAY_ACCENT_RGB_PALETTE = [
  '244 114 182',
  '59 130 246',
  '16 185 129',
  '245 158 11',
  '139 92 246',
  '236 72 153',
  '14 165 233',
  '34 197 94',
  '249 115 22',
  '99 102 241',
]
const TRACKING_TAPE_COLORS = ['#c8ff5c', '#7fc6ff', '#ffb65e', '#f79bff', '#6de0c2', '#ffd95a']
const YEAR_AVATAR_VISIBLE_MAX = 3
const COINS_FORMATTER = new Intl.NumberFormat('fr-FR')
const DELIVERED_STATUS_SET = new Set([
  'delivered',
  'shipped',
  'expedie',
  'expédie',
  'expédié',
  'expediee',
  'expediée',
  'expédiée',
])
const USER_SETTING_ARCHIVED_BETAILS = 'archived_betails'

const clamp = (value, min, max) => Math.min(max, Math.max(min, value))

const toMonthStart = (value) => {
  const date = value instanceof Date ? value : new Date(value)
  return new Date(date.getFullYear(), date.getMonth(), 1)
}

const addMonths = (value, delta) => new Date(value.getFullYear(), value.getMonth() + delta, 1)

const monthDiff = (left, right) => (left.getFullYear() - right.getFullYear()) * 12 + (left.getMonth() - right.getMonth())

const monthKey = (value) => `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}`

const monthLabel = (value) =>
  new Intl.DateTimeFormat('fr-FR', {
    month: 'long',
    year: 'numeric',
  }).format(value)

const toSafeDate = (value) => {
  if (!value) return null
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value
  }

  const asString = String(value).trim()
  if (!asString) return null

  let date = new Date(asString)
  if (!Number.isNaN(date.getTime())) return date

  if (asString.includes(' ')) {
    date = new Date(asString.replace(' ', 'T'))
    if (!Number.isNaN(date.getTime())) return date
  }

  return null
}

const getDateKeyInParis = (value) => {
  if (!value) return ''
  const date = toSafeDate(value)
  if (!date) {
    const asString = String(value || '').trim()
    const match = asString.match(/^(\d{4})-(\d{2})-(\d{2})/)
    return match ? `${match[1]}-${match[2]}-${match[3]}` : ''
  }
  const parts = new Intl.DateTimeFormat('fr-FR', {
    timeZone: PARIS_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)
  const year = parts.find((part) => part.type === 'year')?.value
  const month = parts.find((part) => part.type === 'month')?.value
  const day = parts.find((part) => part.type === 'day')?.value
  if (!year || !month || !day) return ''
  return `${year}-${month}-${day}`
}

const getGridDates = (viewMonthStart) => {
  const monthStart = toMonthStart(viewMonthStart)
  const weekDay = monthStart.getDay()
  const mondayBasedOffset = weekDay === 0 ? 6 : weekDay - 1
  const gridStart = new Date(monthStart.getFullYear(), monthStart.getMonth(), 1 - mondayBasedOffset)

  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(gridStart)
    date.setDate(gridStart.getDate() + index)
    return date
  })
}

const getWeekStart = (value) => {
  const date = value instanceof Date ? new Date(value) : new Date(value)
  const weekDay = date.getDay()
  const mondayOffset = weekDay === 0 ? -6 : 1 - weekDay
  date.setDate(date.getDate() + mondayOffset)
  date.setHours(0, 0, 0, 0)
  return date
}

const getWeekDates = (weekStart) =>
  Array.from({ length: 7 }, (_, index) => {
    const date = new Date(weekStart)
    date.setDate(weekStart.getDate() + index)
    return date
  })

const formatTimeParis = (value) => {
  if (!value) return '--:--'
  const date = toSafeDate(value)
  if (!date) return '--:--'
  return new Intl.DateTimeFormat('fr-FR', {
    timeZone: PARIS_TIMEZONE,
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

const formatDateTimeParis = (value) => {
  if (!value) return 'Date inconnue'
  const date = toSafeDate(value)
  if (!date) return 'Date inconnue'
  return new Intl.DateTimeFormat('fr-FR', {
    timeZone: PARIS_TIMEZONE,
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date)
}

const formatDateParisUpper = (value) => {
  if (!value) return 'DATE INCONNUE'
  const date = toSafeDate(value)
  if (!date) return 'DATE INCONNUE'
  return new Intl.DateTimeFormat('fr-FR', {
    timeZone: PARIS_TIMEZONE,
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
    .format(date)
    .toUpperCase()
}

const getElapsedDaysHours = (scheduledFor) => {
  const target = toSafeDate(scheduledFor)
  if (!target) return null
  const absMs = Math.abs(target.getTime() - Date.now())
  const totalHours = Math.floor(absMs / 3600000)
  const days = Math.floor(totalHours / 24)
  const hours = totalHours % 24
  return `${days}j ${hours}h`
}

const isShippingDelivered = ({ status, scheduledFor }) => {
  const statusKey = String(status || '').trim().toLowerCase()
  if (DELIVERED_STATUS_SET.has(statusKey)) return true
  const scheduledDate = toSafeDate(scheduledFor)
  return Boolean(scheduledDate && scheduledDate.getTime() <= Date.now())
}

const getTrackingScheduleLine = ({ scheduledFor, delivered }) => {
  const when = formatDateParisUpper(scheduledFor)
  const hour = formatTimeParis(scheduledFor)
  const elapsed = getElapsedDaysHours(scheduledFor)

  if (delivered) {
    return `Expédition effectuée le ${when} à ${hour}${elapsed ? ` (depuis ${elapsed})` : ''}`
  }

  return `Expédition prévue le ${when} à ${hour}${elapsed ? ` (Dans ${elapsed})` : ''}`
}

const getDeliveryRemainingText = (scheduledFor) => {
  if (!scheduledFor) return 'Date d\'expédition inconnue'
  const target = toSafeDate(scheduledFor)
  if (!target) return 'Date d\'expédition inconnue'

  const now = Date.now()
  const deltaMs = target.getTime() - now
  const absMs = Math.abs(deltaMs)
  const totalHours = Math.floor(absMs / 3600000)
  const days = Math.floor(totalHours / 24)
  const hours = totalHours % 24

  if (deltaMs >= 0) {
    return `Expédition dans ${days}j ${hours}h`
  }

  return `Expédition effectuée depuis ${days}j ${hours}h`
}

const getShippingProgressState = (scheduledFor) => {
  const target = toSafeDate(scheduledFor)
  const now = Date.now()

  if (!target) {
    return { ratio: 0, state: 'unknown' }
  }

  const remainingMs = target.getTime() - now
  if (remainingMs <= 0) {
    return { ratio: 1, state: 'delivered' }
  }

  const progress = 1 - clamp(remainingMs / REMAINING_PROGRESS_WINDOW_MS, 0, 1)
  return { ratio: progress, state: 'remaining' }
}

const getTrackingProgress = ({ createdAt, scheduledFor, status }) => {
  const statusKey = String(status || '').trim().toLowerCase()
  if (statusKey === 'delivered') {
    return 1
  }

  const target = toSafeDate(scheduledFor)
  if (!target) return 0

  const fallbackRatio = getShippingProgressState(scheduledFor).ratio

  const created = toSafeDate(createdAt)
  if (!created || created.getTime() >= target.getTime()) {
    return fallbackRatio
  }

  const now = Date.now()
  const startMs = created.getTime()
  const endMs = target.getTime()
  const createdBasedRatio = clamp((now - startMs) / (endMs - startMs), 0, 1)

  // Keep a sensible minimum progression based on remaining time window,
  // so very recent schedules do not appear stuck at 0%.
  return Math.max(createdBasedRatio, fallbackRatio)
}

const getTrackingCardsPerView = () => {
  if (typeof window === 'undefined') return 3
  if (window.innerWidth <= 640) return 1
  if (window.innerWidth <= 1100) return 2
  return 3
}

const getDayAccentRgb = (dayKey) => {
  const safeKey = String(dayKey || '')
  if (!safeKey) return DAY_ACCENT_RGB_PALETTE[0]
  let hash = 0
  for (let index = 0; index < safeKey.length; index += 1) {
    hash = (hash * 31 + safeKey.charCodeAt(index)) >>> 0
  }
  return DAY_ACCENT_RGB_PALETTE[hash % DAY_ACCENT_RGB_PALETTE.length]
}

const getAvatarFallback = (name) => {
  const safe = String(name || '').trim()
  if (!safe) return '?'
  return safe[0].toUpperCase()
}

const formatMoney = (value) => `${COINS_FORMATTER.format(Math.max(0, Math.round(Number(value) || 0)))} 💸`

const isMissingColumnError = (error) => {
  const code = error?.code || ''
  const message = String(error?.message || '').toLowerCase()
  return code === '42703' || message.includes('column')
}

const normalizeSettingBetailIds = (value) => {
  let parsed = value
  if (typeof parsed === 'string') {
    const trimmed = parsed.trim()
    if (!trimmed) return []
    try {
      parsed = JSON.parse(trimmed)
    } catch {
      return []
    }
  }

  if (!Array.isArray(parsed)) return []
  return Array.from(
    new Set(
      parsed
        .filter((item) => typeof item === 'string' && item.trim().length > 0)
        .map((item) => item.trim()),
    ),
  )
}

const fetchArchivedBetailIdsForUser = async (userId) => {
  if (!userId) return []

  const { data, error } = await supabase
    .from('user_settings')
    .select('setting_value')
    .eq('user_id', userId)
    .eq('setting_name', USER_SETTING_ARCHIVED_BETAILS)
    .maybeSingle()

  if (error) return []
  return normalizeSettingBetailIds(data?.setting_value)
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

const isWithinRetentionWindow = (scheduledFor, minMonthStart) => {
  const date = toSafeDate(scheduledFor)
  if (!date) return false
  return date.getTime() >= minMonthStart.getTime()
}

const fetchShippingCalendarRows = async () => {
  const { data: sessionData } = await supabase.auth.getSession()
  const currentUserId = sessionData?.session?.user?.id || null
  const archivedBetailSet = new Set(await fetchArchivedBetailIdsForUser(currentUserId))

  if (DEBUG_GCE) {
    console.debug('[GCE] Session status', {
      hasSession: Boolean(sessionData?.session),
      userId: currentUserId,
      authError: null,
    })
  }

  let { data: shippingRows, error: shippingError } = await supabase
    .from('shipping')
    .select('id, betail_id, scheduled_for, status, notes, estimated_gain, scheduled_by_uuid, created_at, updated_at')
    .order('scheduled_for', { ascending: true })

  if (shippingError && isMissingColumnError(shippingError)) {
    const fallback = await supabase
      .from('shipping')
      .select('id, betail_id, scheduled_for, status, notes, scheduled_by_uuid, created_at, updated_at')
      .order('scheduled_for', { ascending: true })
    shippingRows = fallback.data
    shippingError = fallback.error
  }

  if (shippingError) throw shippingError
  if (DEBUG_GCE) {
    console.debug('[GCE] shipping rows', {
      count: Array.isArray(shippingRows) ? shippingRows.length : 0,
      sample: Array.isArray(shippingRows) ? shippingRows.slice(0, 5) : [],
    })
  }
  if (!Array.isArray(shippingRows) || shippingRows.length === 0) return []

  const betailIds = Array.from(new Set(shippingRows.map((row) => row?.betail_id).filter(Boolean)))
  if (!betailIds.length) {
    return shippingRows
      .map((shipping) => {
        const betailFallbackLabel = String(shipping.betail_id || '').slice(0, 8) || 'inconnu'
        return {
          shippingId: shipping.id,
          betailId: shipping.betail_id,
          status: shipping.status || 'scheduled',
          notes: shipping.notes || '',
          estimatedGain: Number.isFinite(Number(shipping?.estimated_gain))
            ? Math.max(0, Math.round(Number(shipping.estimated_gain)))
            : 0,
          scheduledByUserId: shipping.scheduled_by_uuid || null,
          isScheduledByCurrentUser: Boolean(currentUserId) && shipping.scheduled_by_uuid === currentUserId,
          scheduledFor: shipping.scheduled_for,
          scheduledDayKey: getDateKeyInParis(shipping.scheduled_for),
          createdAt: shipping.created_at,
          updatedAt: shipping.updated_at,
          betailName: `Bétail ${betailFallbackLabel}`,
          matricule: betailFallbackLabel,
          avatarUrl: '',
          premium: false,
          age: null,
          farmName: 'Détails restreints',
          isOwnedByCurrentUser: false,
        }
      })
      .filter((row) => Boolean(row.scheduledDayKey))
  }

  const { data: betailsRows, error: betailsError } = await supabase
    .from('betails')
    .select('id, name, matricule, avatar_url, premium, age, farm_id, owner_id')
    .in('id', betailIds)

  const safeBetailsRows = betailsError ? [] : (betailsRows || [])
  if (DEBUG_GCE) {
    console.debug('[GCE] betails rows', {
      count: safeBetailsRows.length,
      betailsError: betailsError?.message || null,
    })
  }

  const betailById = new Map(safeBetailsRows.map((row) => [row.id, row]))
  const farmIds = Array.from(new Set(safeBetailsRows.map((row) => row?.farm_id).filter(Boolean)))

  let farmById = new Map()
  if (farmIds.length) {
    const { data: farmsRows, error: farmsError } = await supabase
      .from('farms_list')
      .select('id, visible, name')
      .in('id', farmIds)

    if (!farmsError) {
      farmById = new Map((farmsRows || []).map((row) => [row.id, row]))
    }
    if (DEBUG_GCE) {
      console.debug('[GCE] farms rows', {
        count: farmById.size,
        farmsError: farmsError?.message || null,
      })
    }
  }

  const normalizedRows = shippingRows
    .map((shipping) => {
      const betail = betailById.get(shipping.betail_id)
      const farm = betail?.farm_id ? farmById.get(betail.farm_id) : null
      const isFarmPrivate = farm?.visible === false
      const isOwner = Boolean(currentUserId) && Boolean(betail?.owner_id) && betail.owner_id === currentUserId

      const shouldHideArchived = isOwner && archivedBetailSet.has(String(betail?.id || shipping.betail_id || ''))
      const shouldHidePrivateFarm = isFarmPrivate && !isOwner
      if (shouldHideArchived || shouldHidePrivateFarm) {
        if (DEBUG_GCE) {
          console.debug('[GCE] row filtered out', {
            shippingId: shipping.id,
            betailId: shipping.betail_id,
            shouldHideArchived,
            shouldHidePrivateFarm,
            farmVisible: farm?.visible,
            archivedByUserSetting: shouldHideArchived,
            betailOwnerId: betail?.owner_id || null,
            currentUserId,
          })
        }
        return null
      }

      const betailFallbackLabel = String(shipping.betail_id || '').slice(0, 8) || 'inconnu'

      return {
        shippingId: shipping.id,
        betailId: betail?.id || shipping.betail_id,
        status: shipping.status || 'scheduled',
        notes: shipping.notes || '',
        estimatedGain: Number.isFinite(Number(shipping?.estimated_gain))
          ? Math.max(0, Math.round(Number(shipping.estimated_gain)))
          : 0,
        scheduledByUserId: shipping.scheduled_by_uuid || null,
        isScheduledByCurrentUser: Boolean(currentUserId) && shipping.scheduled_by_uuid === currentUserId,
        scheduledFor: shipping.scheduled_for,
        scheduledDayKey: getDateKeyInParis(shipping.scheduled_for),
        createdAt: shipping.created_at,
        updatedAt: shipping.updated_at,
        betailName: betail?.name || `Bétail ${betailFallbackLabel}`,
        matricule: betail?.matricule || betailFallbackLabel,
        avatarUrl: betail?.avatar_url || '',
        premium: Boolean(betail?.premium),
        age: Number.isFinite(Number(betail?.age)) ? Number(betail.age) : null,
        farmName: farm?.name || (betail ? 'Ferme inconnue' : 'Détails restreints'),
        isOwnedByCurrentUser: isOwner,
      }
    })
    .filter(Boolean)

  if (DEBUG_GCE) {
    console.debug('[GCE] normalized rows', {
      count: normalizedRows.length,
      dayKeys: normalizedRows.map((row) => row.scheduledDayKey),
      sample: normalizedRows.slice(0, 5),
    })
  }

  return normalizedRows
}

function OverflowAutoScrollText({ text, className = '', title }) {
  const viewportRef = useRef(null)
  const trackRef = useRef(null)
  const safeText = String(text || '')

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

      const duration = Math.max(6, Math.min(15, overflowDistance / 14))
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
    }, 220)

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

  const viewportClassName = ['gce-overflow-marquee', className].filter(Boolean).join(' ')

  return (
    <span className={viewportClassName} ref={viewportRef} title={title || safeText}>
      <span className="gce-overflow-marquee__track" ref={trackRef}>
        {safeText}
      </span>
    </span>
  )
}

function GCEPage() {
  const navigate = useNavigate()
  const [nowDate, setNowDate] = useState(() => new Date())
  const currentMonthStart = useMemo(() => toMonthStart(nowDate), [nowDate])
  const todayDate = nowDate
  const currentWeekStart = useMemo(() => getWeekStart(todayDate), [todayDate])
  const minMonthStart = useMemo(() => addMonths(currentMonthStart, -MAX_PAST_MONTHS), [currentMonthStart])
  const [viewMonthStart, setViewMonthStart] = useState(currentMonthStart)
  const [viewMode, setViewMode] = useState('month')
  const [weekStart, setWeekStart] = useState(currentWeekStart)
  const [mainPanelMode, setMainPanelMode] = useState('calendar')
  const [isQuickMenuOpen, setIsQuickMenuOpen] = useState(false)
  const [refreshSpinTick, setRefreshSpinTick] = useState(0)
  const [trackingCarouselIndex, setTrackingCarouselIndex] = useState(0)
  const [trackingCardsPerView, setTrackingCardsPerView] = useState(() => getTrackingCardsPerView())
  const [trackingSlideDirection, setTrackingSlideDirection] = useState('next')
  const quickMenuRef = useRef(null)

  const shippingQuery = useQuery({
    queryKey: ['shipping', 'gce-calendar'],
    queryFn: fetchShippingCalendarRows,
    staleTime: 45000,
    gcTime: 300000,
    refetchOnWindowFocus: false,
    retry: 1,
  })

  const shippingRows = shippingQuery.data || []
  const shippingRowsInWindow = useMemo(
    () => shippingRows.filter((row) => isWithinRetentionWindow(row?.scheduledFor, minMonthStart)),
    [shippingRows, minMonthStart],
  )

  const rowsByDay = useMemo(() => {
    const grouped = new Map()
    shippingRowsInWindow.forEach((row) => {
      if (!row?.scheduledDayKey) return
      if (!grouped.has(row.scheduledDayKey)) grouped.set(row.scheduledDayKey, [])
      grouped.get(row.scheduledDayKey).push(row)
    })

    grouped.forEach((rows, key) => {
      grouped.set(
        key,
        [...rows].sort((left, right) => {
          const leftDate = toSafeDate(left.scheduledFor)
          const rightDate = toSafeDate(right.scheduledFor)
          const leftTime = leftDate ? leftDate.getTime() : Number.MAX_SAFE_INTEGER
          const rightTime = rightDate ? rightDate.getTime() : Number.MAX_SAFE_INTEGER
          return leftTime - rightTime
        }),
      )
    })

    if (DEBUG_GCE) {
      console.debug('[GCE] rowsByDay keys', {
        keys: Array.from(grouped.keys()),
        counts: Array.from(grouped.entries()).map(([key, rows]) => ({ key, count: rows.length })),
      })
    }

    return grouped
  }, [shippingRowsInWindow])

  const monthGridDates = useMemo(() => getGridDates(viewMonthStart), [viewMonthStart])
  const weekDates = useMemo(() => getWeekDates(weekStart), [weekStart])
  const todayKey = getDateKeyInParis(todayDate)
  const todayDayNumber = useMemo(
    () =>
      new Intl.DateTimeFormat('fr-FR', {
        day: '2-digit',
        timeZone: PARIS_TIMEZONE,
      }).format(todayDate),
    [todayDate],
  )
  const todayMonthYearLabel = useMemo(
    () =>
      new Intl.DateTimeFormat('fr-FR', {
        month: 'long',
        year: 'numeric',
        timeZone: PARIS_TIMEZONE,
      }).format(todayDate),
    [todayDate],
  )

  const canGoPrev =
    viewMode === 'year'
      ? viewMonthStart.getFullYear() > minMonthStart.getFullYear()
      : viewMode === 'week'
        ? getWeekStart(weekStart).getTime() > getWeekStart(minMonthStart).getTime()
        : monthDiff(viewMonthStart, minMonthStart) > 0

  const handlePrev = () => {
    if (!canGoPrev) return
    if (viewMode === 'year') {
      setViewMonthStart((prev) => new Date(prev.getFullYear() - 1, prev.getMonth(), 1))
      return
    }
    if (viewMode === 'week') {
      setWeekStart((prev) => {
        const next = new Date(prev)
        next.setDate(prev.getDate() - 7)
        if (getWeekStart(next).getTime() < getWeekStart(minMonthStart).getTime()) return prev
        return getWeekStart(next)
      })
      return
    }
    setViewMonthStart((prev) => addMonths(prev, -1))
  }

  const handleNext = () => {
    if (viewMode === 'year') {
      setViewMonthStart((prev) => new Date(prev.getFullYear() + 1, prev.getMonth(), 1))
      return
    }
    if (viewMode === 'week') {
      setWeekStart((prev) => {
        const next = new Date(prev)
        next.setDate(prev.getDate() + 7)
        return getWeekStart(next)
      })
      return
    }
    setViewMonthStart((prev) => addMonths(prev, 1))
  }

  const viewAnchorDate = viewMode === 'week' ? weekStart : viewMonthStart
  const monthTitle = monthLabel(viewMonthStart)
  const monthOptions = MONTH_NAMES_FR.map((label, index) => ({ value: index, label }))
  const minYear = minMonthStart.getFullYear()
  const maxYear = Math.max(viewAnchorDate.getFullYear() + 6, currentMonthStart.getFullYear() + 6)
  const yearOptions = Array.from({ length: maxYear - minYear + 1 }, (_, index) => minYear + index)
  const scheduledAlertsCount = shippingRowsInWindow.filter((row) => {
    const when = toSafeDate(row?.scheduledFor)
    return Boolean(when && when.getTime() >= Date.now())
  }).length
  const miloDemonUrl = useMemo(
    () => getResourceFrameUrl('milo_demon.png', { width: 420, height: 420, quality: 78 }),
    [],
  )

  const shippedRows = useMemo(() => {
    return [...shippingRowsInWindow]
      .filter((row) => {
        return isShippingDelivered({ status: row?.status, scheduledFor: row?.scheduledFor })
      })
      .sort((left, right) => {
        const leftTime = toSafeDate(left?.scheduledFor)?.getTime() || 0
        const rightTime = toSafeDate(right?.scheduledFor)?.getTime() || 0
        return rightTime - leftTime
      })
  }, [shippingRowsInWindow])

  const personalHistoryRows = useMemo(
    () =>
      shippedRows.filter((row) => {
        if (row?.scheduledByUserId) return row.isScheduledByCurrentUser
        return row?.isOwnedByCurrentUser
      }),
    [shippedRows],
  )

  const personalTrackingRows = useMemo(
    () =>
      shippingRowsInWindow
        .filter((row) => {
          const isMine = row?.scheduledByUserId ? row.isScheduledByCurrentUser : row?.isOwnedByCurrentUser
          const statusKey = String(row?.status || '').trim().toLowerCase()
          const isTrackable = statusKey === 'scheduled' || DELIVERED_STATUS_SET.has(statusKey)
          return Boolean(isMine) && isTrackable
        })
        .sort((left, right) => {
          const leftTime = toSafeDate(left?.scheduledFor)?.getTime() || Number.MAX_SAFE_INTEGER
          const rightTime = toSafeDate(right?.scheduledFor)?.getTime() || Number.MAX_SAFE_INTEGER
          return leftTime - rightTime
        }),
    [shippingRowsInWindow],
  )

  const ongoingTrackingRows = useMemo(
    () =>
      personalTrackingRows.filter(
        (row) =>
          !isShippingDelivered({
            status: row?.status,
            scheduledFor: row?.scheduledFor,
          }),
      ),
    [personalTrackingRows],
  )

  const deliveredTrackingRows = useMemo(
    () =>
      personalTrackingRows
        .filter((row) =>
          isShippingDelivered({
            status: row?.status,
            scheduledFor: row?.scheduledFor,
          }),
        )
        .sort((left, right) => {
          const leftTime = toSafeDate(left?.scheduledFor)?.getTime() || 0
          const rightTime = toSafeDate(right?.scheduledFor)?.getTime() || 0
          return rightTime - leftTime
        }),
    [personalTrackingRows],
  )

  const trackingTotalEstimatedGain = useMemo(
    () => ongoingTrackingRows.reduce((sum, row) => sum + (Number(row?.estimatedGain) || 0), 0),
    [ongoingTrackingRows],
  )

  const trackingMaxStart = useMemo(
    () => Math.max(0, ongoingTrackingRows.length - trackingCardsPerView),
    [ongoingTrackingRows.length, trackingCardsPerView],
  )

  const trackingHasPrev = trackingCarouselIndex > 0
  const trackingHasNext = trackingCarouselIndex < trackingMaxStart
  const trackingPageCount = Math.max(1, Math.ceil(ongoingTrackingRows.length / Math.max(1, trackingCardsPerView)))
  const trackingCurrentPage = ongoingTrackingRows.length
    ? Math.floor(trackingCarouselIndex / Math.max(1, trackingCardsPerView)) + 1
    : 1

  const visibleOngoingTrackingRows = useMemo(
    () => ongoingTrackingRows.slice(trackingCarouselIndex, trackingCarouselIndex + trackingCardsPerView),
    [ongoingTrackingRows, trackingCarouselIndex, trackingCardsPerView],
  )

  const handleMonthSelectChange = (event) => {
    const nextMonth = Number(event.target.value)
    if (!Number.isInteger(nextMonth) || nextMonth < 0 || nextMonth > 11) return
    const sourceDate = viewMode === 'week' ? weekStart : viewMonthStart
    const candidate = new Date(sourceDate.getFullYear(), nextMonth, 1)
    if (monthDiff(candidate, minMonthStart) < 0) return
    setViewMonthStart(candidate)
    if (viewMode === 'week') {
      setWeekStart(getWeekStart(candidate))
    }
  }

  const handleYearSelectChange = (event) => {
    const nextYear = Number(event.target.value)
    if (!Number.isInteger(nextYear)) return
    const sourceDate = viewMode === 'week' ? weekStart : viewMonthStart
    const candidate = new Date(nextYear, sourceDate.getMonth(), 1)
    if (monthDiff(candidate, minMonthStart) < 0) return
    setViewMonthStart(candidate)
    if (viewMode === 'week') {
      setWeekStart(getWeekStart(candidate))
    }
  }

  const handleChangeViewMode = (nextMode) => {
    setViewMode(nextMode)
    if (nextMode === 'week') {
      setWeekStart(currentWeekStart)
    }
  }

  const handlePickYearMonth = (monthIndex) => {
    const candidate = new Date(viewMonthStart.getFullYear(), monthIndex, 1)
    if (monthDiff(candidate, minMonthStart) < 0) return
    setViewMonthStart(candidate)
    setViewMode('month')
  }

  const monthYearData = useMemo(() => {
    const targetYear = viewMonthStart.getFullYear()
    const counts = Array.from({ length: 12 }, () => 0)
    const avatars = Array.from({ length: 12 }, () => [])
    const seenByMonth = Array.from({ length: 12 }, () => new Set())

    shippingRowsInWindow.forEach((row) => {
      const date = toSafeDate(row?.scheduledFor)
      if (!date || date.getFullYear() !== targetYear) return
      const monthIndex = date.getMonth()
      counts[monthIndex] += 1

      const uniqueKey = row?.betailId || row?.shippingId || `${monthIndex}-${row?.matricule || row?.betailName || 'betail'}`
      if (seenByMonth[monthIndex].has(uniqueKey)) return
      seenByMonth[monthIndex].add(uniqueKey)

      avatars[monthIndex].push({
        id: uniqueKey,
        avatarUrl: row?.avatarUrl || '',
        name: row?.betailName || row?.matricule || 'Bétail',
      })
    })

    return counts.map((count, index) => ({
      count,
      avatars: avatars[index],
    }))
  }, [shippingRowsInWindow, viewMonthStart])

  const weekRangeLabel = useMemo(() => {
    const first = weekDates[0]
    const last = weekDates[6]
    if (!first || !last) return ''
    const format = new Intl.DateTimeFormat('fr-FR', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    })
    return `${format.format(first)} — ${format.format(last)}`
  }, [weekDates])

  const displaySubtitle =
    viewMode === 'year'
      ? `Année ${viewMonthStart.getFullYear()} • Historique limité à ${MAX_PAST_MONTHS} mois`
      : viewMode === 'week'
        ? `Semaine • ${weekRangeLabel}`
        : `${monthTitle} • Historique limité à ${MAX_PAST_MONTHS} mois`

  const isCalendarPanel = mainPanelMode === 'calendar'

  const handleRefreshCalendar = async () => {
    setRefreshSpinTick((previous) => previous + 1)
    const refreshedDate = new Date()
    setNowDate(refreshedDate)
    await shippingQuery.refetch()
  }

  useEffect(() => {
    const handleOutsideClick = (event) => {
      if (!quickMenuRef.current) return
      if (!quickMenuRef.current.contains(event.target)) {
        setIsQuickMenuOpen(false)
      }
    }

    if (isQuickMenuOpen) {
      document.addEventListener('mousedown', handleOutsideClick)
    }

    return () => {
      document.removeEventListener('mousedown', handleOutsideClick)
    }
  }, [isQuickMenuOpen])

  useEffect(() => {
    const timerId = window.setInterval(() => {
      setNowDate(new Date())
    }, 60000)

    return () => {
      window.clearInterval(timerId)
    }
  }, [])

  useEffect(() => {
    const handleResize = () => {
      setTrackingCardsPerView(getTrackingCardsPerView())
    }

    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  useEffect(() => {
    setTrackingCarouselIndex((previous) => clamp(previous, 0, trackingMaxStart))
  }, [trackingMaxStart])

  const handleQuickPanelSwitch = (mode) => {
    setMainPanelMode(mode)
    setIsQuickMenuOpen(false)
  }

  const handleTrackingPrev = () => {
    setTrackingSlideDirection('prev')
    setTrackingCarouselIndex((previous) => Math.max(0, previous - trackingCardsPerView))
  }

  const handleTrackingNext = () => {
    setTrackingSlideDirection('next')
    setTrackingCarouselIndex((previous) => Math.min(trackingMaxStart, previous + trackingCardsPerView))
  }

  const renderDayCell = (date, options = {}) => {
    const { inCurrentMonth = true, gridColumnIndex = 0 } = options
    const dayKey = getDateKeyInParis(date)
    const rowsForDay = rowsByDay.get(dayKey) || []
    const visibleRows = rowsForDay.slice(0, 2)
    const hiddenCount = Math.max(0, rowsForDay.length - visibleRows.length)
    const isPastDay = dayKey < todayKey
    const isToday = dayKey === todayKey
    const hasShipping = rowsForDay.length > 0
    const dayAccentRgb = hasShipping ? getDayAccentRgb(dayKey) : null
    const shouldFlipTooltipLeft = gridColumnIndex >= 5
      const shouldFlipTooltipUp = options.gridRowIndex != null && options.gridRowIndex >= 4

    return (
      <div
        key={`${dayKey}-${date.getMonth()}-${options.keyPrefix || 'cell'}`}
        className={`gce-day-cell ${inCurrentMonth ? '' : 'is-outside'} ${isPastDay ? 'is-past' : ''} ${isToday ? 'is-today' : ''} ${hasShipping ? 'has-shipping' : ''}`}
        style={hasShipping ? { '--gce-day-accent-rgb': dayAccentRgb } : undefined}
        role="gridcell"
        aria-label={`Jour ${date.getDate()}`}
      >
        <span className="gce-day-number">{String(date.getDate()).padStart(2, '0')}</span>

        <div className="gce-day-ship-stack">
          {visibleRows.map((row) => {
            const progressState = getShippingProgressState(row.scheduledFor)
            return (
              <div key={row.shippingId} className="gce-ship-item">
                <button
                  type="button"
                  className={`gce-avatar-pill ${row.premium ? 'is-premium' : ''}`}
                  aria-label={`${row.betailName} ${row.matricule}`}
                >
                  {row.avatarUrl ? (
                    <img src={row.avatarUrl} alt={row.betailName} loading="lazy" decoding="async" />
                  ) : (
                    <span>{getAvatarFallback(row.betailName)}</span>
                  )}
                </button>

                <div className={`gce-tooltip ${shouldFlipTooltipLeft ? 'is-flip-left' : ''} ${shouldFlipTooltipUp ? 'is-flip-up' : ''}`} role="tooltip">
                  <div className="gce-tooltip-head">
                    <div className="gce-tooltip-avatar">
                      {row.avatarUrl ? <img src={row.avatarUrl} alt={row.betailName} loading="lazy" decoding="async" /> : <span>{getAvatarFallback(row.betailName)}</span>}
                    </div>
                    <div>
                      <p className="gce-tooltip-name">{row.betailName}</p>
                      <p className="gce-tooltip-meta">{row.matricule} • {row.farmName}</p>
                    </div>
                  </div>

                  <p className="gce-tooltip-line">Livraison: {formatDateTimeParis(row.scheduledFor)}</p>
                  <p className="gce-tooltip-line">Heure: {formatTimeParis(row.scheduledFor)} (Europe/Paris)</p>
                  <p className="gce-tooltip-line">{getDeliveryRemainingText(row.scheduledFor)}</p>
                  <p className="gce-tooltip-line">Statut: {row.status}</p>
                  {row.notes ? <p className="gce-tooltip-note">Note: {row.notes}</p> : null}

                  <div className="gce-progress-track" aria-hidden="true">
                    <span
                      className={
                        progressState.state === 'delivered'
                          ? 'is-delivered'
                          : progressState.state === 'remaining'
                            ? 'is-remaining'
                            : ''
                      }
                      style={{ width: `${Math.round(progressState.ratio * 100)}%` }}
                    />
                  </div>
                </div>
              </div>
            )
          })}
        </div>

        {hiddenCount > 0 ? <span className="gce-day-more">+{hiddenCount}</span> : null}
      </div>
    )
  }

  if (DEBUG_GCE) {
    const gridKeys = monthGridDates.map((date) => getDateKeyInParis(date))
    console.debug('[GCE] render snapshot', {
      month: monthKey(viewMonthStart),
      shippingCount: shippingRowsInWindow.length,
      todayKey,
      gridFirst: gridKeys[0],
      gridLast: gridKeys[gridKeys.length - 1],
      has25: rowsByDay.has('2026-03-25'),
      rowsOn25: (rowsByDay.get('2026-03-25') || []).length,
    })
  }

  return (
    <div className="gce-page">
      <div className="gce-shell">
        <aside className="gce-sidebar" aria-label="Navigation calendrier">
          <div className="gce-date-card">
            <p className="gce-date-day">{todayDayNumber}</p>
            <p className="gce-date-month">{todayMonthYearLabel}</p>
          </div>

          <nav className="gce-nav-list" aria-label="Sections GCE">
            <button
              type="button"
              className={`gce-nav-item ${mainPanelMode === 'calendar' ? 'is-active' : ''}`}
              onClick={() => setMainPanelMode('calendar')}
            >
              <CalendarDays size={16} />
              Calendrier
            </button>
            <button
              type="button"
              className={`gce-nav-item ${mainPanelMode === 'tracking' ? 'is-active' : ''}`}
              onClick={() => setMainPanelMode('tracking')}
            >
              <Gauge size={16} />
              Suivi expédition
            </button>
            <button
              type="button"
              className={`gce-nav-item ${mainPanelMode === 'history' ? 'is-active' : ''}`}
              onClick={() => setMainPanelMode('history')}
            >
              <FileText size={16} />
              Historique
            </button>
            <button
              type="button"
              className={`gce-nav-item ${mainPanelMode === 'archives' ? 'is-active' : ''}`}
              onClick={() => setMainPanelMode('archives')}
            >
              <Archive size={16} />
              Archives / Expédiés
            </button>
          </nav>

          <div className="gce-sidebar-bottom">
            <button
              type="button"
              className={`gce-nav-item ${mainPanelMode === 'expeditions-tutorial' ? 'is-active' : ''}`}
              onClick={() => setMainPanelMode('expeditions-tutorial')}
            >
              <Package size={16} />
              Tutoriel d'expédition
            </button>
            <button type="button" className="gce-nav-item" onClick={() => navigate('/mes-betails')}>
              <ListChecks size={16} />
              Mes bétails
            </button>
            <button type="button" className="gce-nav-item" onClick={() => navigate('/home')}>
              <Settings size={16} />
              Tableau de bord
            </button>
          </div>
        </aside>

        <section className="gce-main-panel" aria-live="polite">
          <header className="gce-main-topbar">
            <div className="gce-view-tabs" role="tablist" aria-label="Vues calendrier">
              <button
                type="button"
                className={`gce-view-tab ${viewMode === 'year' ? 'is-active' : ''}`}
                onClick={() => handleChangeViewMode('year')}
                disabled={!isCalendarPanel}
              >
                Année
              </button>
              <button
                type="button"
                className={`gce-view-tab ${viewMode === 'month' ? 'is-active' : ''}`}
                onClick={() => handleChangeViewMode('month')}
                disabled={!isCalendarPanel}
              >
                Mois
              </button>
              <button
                type="button"
                className={`gce-view-tab ${viewMode === 'week' ? 'is-active' : ''}`}
                onClick={() => handleChangeViewMode('week')}
                disabled={!isCalendarPanel}
              >
                Semaine
              </button>
            </div>

            <div className="gce-topbar-center">
              <span className="gce-view-label">Vue :</span>
              <select
                className="gce-select"
                value={viewAnchorDate.getMonth()}
                onChange={handleMonthSelectChange}
                aria-label="Sélectionner le mois"
                disabled={!isCalendarPanel}
              >
                {monthOptions.map((month) => (
                  <option key={month.value} value={month.value}>
                    {month.label}
                  </option>
                ))}
              </select>

              <select
                className="gce-select"
                value={viewAnchorDate.getFullYear()}
                onChange={handleYearSelectChange}
                aria-label="Sélectionner l'année"
                disabled={!isCalendarPanel}
              >
                {yearOptions.map((year) => (
                  <option key={year} value={year}>
                    {year}
                  </option>
                ))}
              </select>

              <div className="gce-month-arrows" aria-label="Navigation rapide">
                <button type="button" className="gce-icon-btn" onClick={handlePrev} disabled={!isCalendarPanel || !canGoPrev}>
                  <ChevronLeft size={16} />
                </button>
                <button type="button" className="gce-icon-btn" onClick={handleNext} disabled={!isCalendarPanel}>
                  <ChevronRight size={16} />
                </button>
              </div>
            </div>

            <div className="gce-topbar-right">
              <button type="button" className="gce-icon-btn gce-alert-btn" aria-label="Alertes expéditions">
                <Bell size={17} />
                {scheduledAlertsCount > 0 ? <span className="gce-alert-badge">{Math.min(scheduledAlertsCount, 99)}</span> : null}
              </button>
              <button type="button" className="gce-profile-btn" aria-label="Rafraîchir le calendrier" onClick={handleRefreshCalendar}>
                <RefreshCcw
                  key={`refresh-spin-${refreshSpinTick}`}
                  size={18}
                  className={`gce-refresh-icon ${refreshSpinTick > 0 ? 'is-spinning' : ''}`}
                />
              </button>
              <button
                type="button"
                className={`gce-icon-btn ${isQuickMenuOpen ? 'is-active' : ''}`}
                aria-label="Actions rapides"
                onClick={() => setIsQuickMenuOpen((prev) => !prev)}
              >
                <Grip size={18} />
              </button>
              {isQuickMenuOpen ? (
                <div className="gce-quick-menu" ref={quickMenuRef} role="menu" aria-label="Actions rapides">
                  <button type="button" onClick={() => handleQuickPanelSwitch('calendar')}>
                    Calendrier
                  </button>
                  <button type="button" onClick={() => handleQuickPanelSwitch('tracking')}>
                    Suivi expédition
                  </button>
                  <button type="button" onClick={() => handleQuickPanelSwitch('history')}>
                    Historique perso
                  </button>
                  <button type="button" onClick={() => handleQuickPanelSwitch('archives')}>
                    Archives / Expédiés
                  </button>
                  <button type="button" onClick={() => handleQuickPanelSwitch('expeditions-tutorial')}>
                    Tuto expéditions
                  </button>
                </div>
              ) : null}
            </div>
          </header>

          <div className="gce-main-header-row">
            <p className="gce-main-title">Grand Calendrier des Expéditions</p>
            <p className="gce-main-subtitle">{displaySubtitle}</p>
          </div>

          {shippingQuery.isLoading ? <p className="gce-state">Chargement des expéditions...</p> : null}
          {shippingQuery.isError ? <p className="gce-state is-error">Impossible de charger les expéditions.</p> : null}

          <div className={`gce-calendar-surface ${mainPanelMode === 'tracking' ? 'is-tracking' : ''}`}>
            {mainPanelMode === 'expeditions-tutorial' ? (
              <section className="gce-tutorial" aria-label="Tutoriel expédition">
                <div className="gce-tutorial-hero" aria-hidden="true">
                  {miloDemonUrl ? <img src={miloDemonUrl} alt="" loading="lazy" decoding="async" /> : null}
                </div>

                <div className="gce-tutorial-content">
                  <p className="gce-tutorial-eyebrow">Tutoriel expédition</p>
                  <h3 className="gce-tutorial-title">Comment expédier un bétail ?</h3>
                  <ol className="gce-tutorial-steps">
                    <li>
                      Ouvre la page
                      <button type="button" className="gce-inline-link" onClick={() => navigate('/mes-betails')}>
                        Mes bétails
                      </button>
                      .
                    </li>
                    <li>Sélectionne le bétail que tu veux expédier.</li>
                    <li>Clique sur le bouton Expédier dans le panneau d’actions du bétail.</li>
                    <li>Laisse toi guider par l'assistant d'expédition.</li>
                    <li>Retourne ici sur le GCE pour suivre la livraison dans le calendrier.</li>
                  </ol>
                </div>

                <div className="gce-tutorial-decor" aria-hidden="true">
                  <img src={gupna1} alt="" loading="lazy" decoding="async" />
                  <img src={gupna3} alt="" loading="lazy" decoding="async" />
                  <img src={gupna6} alt="" loading="lazy" decoding="async" />
                </div>
              </section>
            ) : mainPanelMode === 'history' ? (
              <section className="gce-list-panel" aria-label="Historique personnel des expéditions">
                <p className="gce-list-eyebrow">Historique personnel</p>
                <h3 className="gce-list-title">Historique de vos dernières expéditions</h3>
                {personalHistoryRows.length === 0 ? (
                  <p className="gce-list-empty">Aucune expédition personnelle pour le moment.</p>
                ) : (
                  <div className="gce-list-items">
                    {personalHistoryRows.map((row) => (
                      <article key={`history-${row.shippingId}`} className="gce-list-item">
                        <div className="gce-list-avatar">
                          {row.avatarUrl ? <img src={row.avatarUrl} alt={row.betailName} loading="lazy" decoding="async" /> : <span>{getAvatarFallback(row.betailName)}</span>}
                        </div>
                        <div>
                          <p className="gce-list-item-title">{row.betailName}</p>
                          <p className="gce-list-item-meta">{row.matricule} • {row.farmName}</p>
                          <p className="gce-list-item-meta">Expédié le {formatDateTimeParis(row.scheduledFor)}</p>
                        </div>
                      </article>
                    ))}
                  </div>
                )}
              </section>
            ) : mainPanelMode === 'archives' ? (
              <section className="gce-list-panel" aria-label="Archives et bétails expédiés">
                <p className="gce-list-eyebrow">Archives / Expédiés</p>
                <h3 className="gce-list-title">Bétails expédiés</h3>
                {shippedRows.length === 0 ? (
                  <p className="gce-list-empty">Aucun bétail expédié à afficher pour l’instant.</p>
                ) : (
                  <div className="gce-list-items">
                    {shippedRows.map((row) => (
                      <article key={`archived-${row.shippingId}`} className="gce-list-item">
                        <div className="gce-list-avatar">
                          {row.avatarUrl ? <img src={row.avatarUrl} alt={row.betailName} loading="lazy" decoding="async" /> : <span>{getAvatarFallback(row.betailName)}</span>}
                        </div>
                        <div>
                          <p className="gce-list-item-title">{row.betailName}</p>
                          <p className="gce-list-item-meta">{row.matricule} • {row.farmName}</p>
                          <p className="gce-list-item-meta">Dernier statut : {row.status || 'scheduled'} • {formatDateTimeParis(row.scheduledFor)}</p>
                        </div>
                      </article>
                    ))}
                  </div>
                )}
              </section>
            ) : mainPanelMode === 'tracking' ? (
              <section className="gce-list-panel gce-tracking-panel" aria-label="Suivi des expéditions personnelles">
                <p className="gce-list-eyebrow">Suivi expédition</p>
                <h3 className="gce-list-title">Suivi de mes bétails expédiés</h3>
                <p className="gce-list-summary">
                  Gain total à venir : <strong>{formatMoney(trackingTotalEstimatedGain)}</strong>
                </p>
                {personalTrackingRows.length === 0 ? (
                  <p className="gce-list-empty">Aucun bétail expédié ou en cours d’expédition pour le moment.</p>
                ) : (
                  <div className="gce-track-sections">
                    <section className="gce-track-block" aria-label="Bétails en cours d'expédition">
                      <div className="gce-track-block-head">
                        <h4>En cours d'expédition</h4>
                        <div className="gce-track-block-head-right">
                          <span>{ongoingTrackingRows.length}</span>
                          <p className="gce-track-page-indicator" aria-label="Page actuelle">
                            {trackingCurrentPage}/{trackingPageCount}
                          </p>
                          <button
                            type="button"
                            className="gce-track-carousel-btn"
                            onClick={handleTrackingPrev}
                            disabled={!trackingHasPrev}
                            aria-label="Voir les expéditions précédentes"
                          >
                            <ChevronLeft size={14} />
                          </button>
                          <button
                            type="button"
                            className="gce-track-carousel-btn"
                            onClick={handleTrackingNext}
                            disabled={!trackingHasNext}
                            aria-label="Voir les expéditions suivantes"
                          >
                            <ChevronRight size={14} />
                          </button>
                        </div>
                      </div>

                      {ongoingTrackingRows.length === 0 ? (
                        <p className="gce-list-empty">Aucun bétail en cours d’expédition actuellement.</p>
                      ) : (
                        <>
                          <div
                            className={`gce-track-live-viewport ${trackingHasPrev ? 'has-prev' : ''} ${trackingHasNext ? 'has-next' : ''}`}
                          >
                            <div
                              key={`tracking-page-${trackingCarouselIndex}`}
                              className={`gce-track-live-grid ${trackingSlideDirection === 'prev' ? 'is-slide-prev' : 'is-slide-next'}`}
                              style={{ '--gce-track-columns': String(trackingCardsPerView) }}
                            >
                              {visibleOngoingTrackingRows.map((row, rowIndex) => {
                                const progressRatio = getTrackingProgress({
                                  createdAt: row?.createdAt,
                                  scheduledFor: row?.scheduledFor,
                                  status: row?.status,
                                })
                                const progressPct = clamp(Math.round(progressRatio * 100), 0, 100)
                                const tapeColor = TRACKING_TAPE_COLORS[(trackingCarouselIndex + rowIndex) % TRACKING_TAPE_COLORS.length]

                                return (
                                  <article
                                    key={`tracking-live-${row.shippingId}`}
                                    className="gce-track-live-card"
                                    style={{ '--gce-track-tape-color': tapeColor }}
                                  >
                                    <div className="gce-track-time-badge" aria-label="Temps restant">
                                      <span className="gce-track-clock-icon" aria-hidden="true" />
                                      <span>{getDeliveryRemainingText(row?.scheduledFor)}</span>
                                    </div>

                                    <div className="gce-track-illustration" aria-hidden="true">
                                      <div className="gce-track-conveyor-belt" />
                                      <div className="gce-track-package">
                                        <div className="gce-track-box">
                                          <div className="gce-track-box-face gce-track-box-top">
                                            <span className="gce-track-tape" />
                                            <span className="gce-track-tape-horizontal" />
                                            <span className="gce-track-avatar-core">
                                              {row.avatarUrl ? (
                                                <img src={row.avatarUrl} alt={row.betailName} loading="lazy" decoding="async" />
                                              ) : (
                                                <span>{getAvatarFallback(row.betailName)}</span>
                                              )}
                                            </span>
                                          </div>
                                        </div>
                                      </div>
                                    </div>

                                    <div className="gce-track-content">
                                      <h4 className="gce-track-card-title">
                                        <OverflowAutoScrollText
                                          className="gce-overflow-marquee--title"
                                          text="Suivi de votre expédition"
                                        />
                                      </h4>
                                      <p className="gce-track-card-description">
                                        <OverflowAutoScrollText
                                          className="gce-overflow-marquee--meta"
                                          text={`${row.betailName} (${row.matricule}) • ${row.farmName}`}
                                        />
                                      </p>
                                      <p className="gce-track-card-description">
                                        {getTrackingScheduleLine({ scheduledFor: row?.scheduledFor, delivered: false })}
                                      </p>
                                      <p className="gce-track-card-description">
                                        Gain : <strong>{formatMoney(row?.estimatedGain)}</strong>
                                      </p>
                                      {row.notes ? (
                                        <p className="gce-track-card-note">Note: {row.notes}</p>
                                      ) : null}

                                      <div className="gce-track-footer">
                                        <div className="gce-track-progress-indicator" aria-label={`Progression ${progressPct}%`}>
                                          <span style={{ width: `${progressPct}%` }} />
                                        </div>
                                        <p className="gce-track-progress-text">Progression en cours: {progressPct}%</p>
                                        <p className="gce-track-status-message">
                                          <span className="gce-track-package-icon" aria-hidden="true" />
                                          Acheminement en cours
                                        </p>
                                      </div>
                                    </div>
                                  </article>
                                )
                              })}
                            </div>
                          </div>

                          {trackingHasNext ? (
                            <button
                              type="button"
                              className="gce-track-more-hint"
                              aria-live="polite"
                              onClick={handleTrackingNext}
                            >
                              <span>D'autres expéditions sont disponibles</span>
                              <ChevronRight size={14} aria-hidden="true" />
                            </button>
                          ) : null}
                        </>
                      )}
                    </section>

                    <section className="gce-track-block" aria-label="Bétails déjà expédiés">
                      <div className="gce-track-block-head">
                        <h4>Déjà expédiés</h4>
                        <span>{deliveredTrackingRows.length}</span>
                      </div>

                      {deliveredTrackingRows.length === 0 ? (
                        <p className="gce-list-empty">Aucun bétail déjà expédié pour le moment.</p>
                      ) : (
                        <div className="gce-list-items gce-track-delivered-list">
                          {deliveredTrackingRows.map((row) => (
                            <article key={`tracking-delivered-${row.shippingId}`} className="gce-list-item gce-track-item">
                              <div className="gce-list-avatar">
                                {row.avatarUrl ? <img src={row.avatarUrl} alt={row.betailName} loading="lazy" decoding="async" /> : <span>{getAvatarFallback(row.betailName)}</span>}
                              </div>
                              <div>
                                <p className="gce-list-item-title">{row.betailName}</p>
                                <p className="gce-list-item-meta">{row.matricule} • {row.farmName}</p>
                                <p className="gce-list-item-meta">
                                  {getTrackingScheduleLine({ scheduledFor: row?.scheduledFor, delivered: true })}
                                </p>
                                <p className="gce-track-gain">
                                  <span aria-hidden="true">💸</span>
                                  <span>Gain reçu: <strong>{formatMoney(row?.estimatedGain)}</strong></span>
                                </p>
                              </div>
                            </article>
                          ))}
                        </div>
                      )}
                    </section>
                  </div>
                )}
              </section>
            ) : viewMode === 'year' ? (
              <div className="gce-year-grid" role="grid" aria-label="Vue annuelle des expéditions">
                {MONTH_NAMES_FR.map((label, index) => (
                  <button
                    key={label}
                    type="button"
                    className={`gce-year-month-card ${index === viewMonthStart.getMonth() ? 'is-current' : ''}`}
                    onClick={() => handlePickYearMonth(index)}
                  >
                    <span className="gce-year-month-name">{label}</span>
                    {monthYearData[index]?.avatars?.length ? (
                      <span className="gce-year-month-avatars" aria-hidden="true">
                        {monthYearData[index].avatars.slice(0, YEAR_AVATAR_VISIBLE_MAX).map((avatar) => (
                          <span key={avatar.id} className="gce-year-avatar" title={avatar.name}>
                            {avatar.avatarUrl ? <img src={avatar.avatarUrl} alt="" loading="lazy" decoding="async" /> : <span>{getAvatarFallback(avatar.name)}</span>}
                          </span>
                        ))}
                        {monthYearData[index].avatars.length > YEAR_AVATAR_VISIBLE_MAX ? (
                          <span className="gce-year-avatar is-more">+{monthYearData[index].avatars.length - YEAR_AVATAR_VISIBLE_MAX}</span>
                        ) : null}
                      </span>
                    ) : (
                      <span className="gce-year-month-avatars is-empty" aria-hidden="true" />
                    )}
                    <span className="gce-year-month-count">
                      {monthYearData[index]?.count || 0} expédition{(monthYearData[index]?.count || 0) > 1 ? 's' : ''}
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              <div className={`gce-grid ${viewMode === 'week' ? 'gce-grid-week' : 'gce-grid-month'}`} role="grid" aria-label="Grand Calendrier des Expéditions">
                {WEEK_DAYS.map((day) => (
                  <div key={day} className="gce-grid-weekday" role="columnheader">
                    {day}
                  </div>
                ))}

                {(viewMode === 'week' ? weekDates : monthGridDates).map((date, index) => {
                  const gridColumnIndex = index % 7
                  const inCurrentMonth = viewMode === 'week' ? true : date.getMonth() === viewMonthStart.getMonth()
                  return renderDayCell(date, {
                    inCurrentMonth,
                    gridRowIndex: Math.floor(index / 7),
                    keyPrefix: viewMode,
                    gridColumnIndex,
                  })
                })}
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  )
}

export default GCEPage
