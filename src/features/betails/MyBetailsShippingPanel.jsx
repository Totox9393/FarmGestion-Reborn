import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import cautionSound from '../../assets/sounds/caution.mp3'
import costRevealSound from '../../assets/sounds/SeResourceStd2nd_00000799.wav'
import finalHoverSound from '../../assets/sounds/SE_CTR_HOME_POPUP_POWER.wav'
import finalClickSound from '../../assets/sounds/CMN_MINIGAME_BNK_SE_0000000A.wav'

const COST_FORMATTER = new Intl.NumberFormat('fr-FR')
const MIN_SHIPPING_AGE = 7
const SHIPPING_MIN_DELAY_DAYS = 7
const SHIPPING_MAX_DELAY_DAYS = 60
const SHIPPING_BLOCKED_MM_DD = ['01-01', '01-03', '02-27', '06-26', '12-25']
const FLOWER_LAYOUTS = [
  { top: '10%', left: '12%', size: 70, rotate: -10, opacity: 0.07 },
  { top: '16%', left: '86%', size: 62, rotate: 8, opacity: 0.06 },
  { top: '30%', left: '8%', size: 66, rotate: -6, opacity: 0.07 },
  { top: '33%', left: '92%', size: 64, rotate: 10, opacity: 0.06 },
  { top: '52%', left: '13%', size: 68, rotate: -7, opacity: 0.07 },
  { top: '56%', left: '88%', size: 66, rotate: 9, opacity: 0.06 },
  { top: '73%', left: '9%', size: 62, rotate: -9, opacity: 0.07 },
  { top: '79%', left: '90%', size: 64, rotate: 11, opacity: 0.06 },
  { top: '90%', left: '18%', size: 66, rotate: -8, opacity: 0.06 },
]
const COIN_LAYOUTS = [
  { top: '7%', left: '64%', size: 96, rotate: -12, opacity: 0.05 },
  { top: '91%', left: '78%', size: 86, rotate: 16, opacity: 0.05 },
]

const emitToast = (type, message) => {
  window.dispatchEvent(
    new CustomEvent('farmgestion-toast', {
      detail: { type, message },
    }),
  )
}

const getMonthsSince = (value) => {
  if (!value) return 0
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 0

  const now = new Date()
  let months = (now.getFullYear() - date.getFullYear()) * 12 + (now.getMonth() - date.getMonth())
  if (now.getDate() < date.getDate()) months -= 1
  return Math.max(0, months)
}

const normalizeAge = (value) => {
  const age = Number(value)
  if (!Number.isFinite(age)) return 0
  return Math.max(0, Math.round(age))
}

const estimateGrowthCost = ({ age, premium, badgeCount }) => {
  const currentAge = normalizeAge(age)
  const cappedBadges = Math.max(0, Math.min(Number(badgeCount) || 0, 12))
  const premiumBonus = premium ? 85 : 0
  const ageRamp = currentAge * 34 + currentAge * currentAge * 7
  const badgeRamp = cappedBadges * 18
  return Math.max(120, Math.round(125 + ageRamp + premiumBonus + badgeRamp))
}

const buildShippingStudy = (target) => {
  const baseCost = 250
  const isPremium = Boolean(target?.premium)
  const statusImpact = isPremium ? 390 : 45

  const monthsSinceCreation = getMonthsSince(target?.createdAt)
  const seniorityBonus = monthsSinceCreation * 6

  const badgeCount = Math.max(0, Math.min(Number(target?.badgeCount) || 0, 12))
  const badgeBonus = badgeCount * 72

  const ageValue = Number(target?.age)
  const normalizedAge = Number.isFinite(ageValue) ? ageValue : 9
  const ageDelta = normalizedAge - 8
  const ageImpact = ageDelta >= 0 ? Math.round(ageDelta * 28) : -Math.round(Math.abs(ageDelta) * 22)

  const totalCost = baseCost + statusImpact + seniorityBonus + badgeBonus + ageImpact

  return {
    totalCost,
    factors: [
      { label: 'Base', value: baseCost },
      { label: `Statut premium (${isPremium ? 'oui' : 'non'})`, value: statusImpact },
      { label: `Ancienneté (${monthsSinceCreation} mois)`, value: seniorityBonus },
      { label: `Badges équipés (${badgeCount})`, value: badgeBonus },
      { label: `Âge du bétail (${normalizedAge} an${normalizedAge > 1 ? 's' : ''})`, value: ageImpact },
    ],
  }
}

const formatCost = (value) => `${COST_FORMATTER.format(Math.max(0, Math.round(value)))} coins`
const formatSignedCost = (value) => {
  const sign = value > 0 ? '+' : value < 0 ? '-' : ''
  return `${sign}${COST_FORMATTER.format(Math.abs(Math.round(value)))} coins`
}

const normalizeIsoDate = (value) => {
  if (!value) return ''
  const asString = String(value).trim()
  const match = asString.match(/^(\d{4})-(\d{2})-(\d{2})/)
  return match ? `${match[1]}-${match[2]}-${match[3]}` : ''
}

const randomIsoDateInRange = (minIso, maxIso) => {
  const safeMin = normalizeIsoDate(minIso)
  const safeMax = normalizeIsoDate(maxIso)
  if (!safeMin || !safeMax) return safeMin || safeMax || ''

  const minDate = new Date(`${safeMin}T00:00:00`)
  const maxDate = new Date(`${safeMax}T00:00:00`)
  if (Number.isNaN(minDate.getTime()) || Number.isNaN(maxDate.getTime())) return safeMin

  const minTime = minDate.getTime()
  const maxTime = maxDate.getTime()
  if (maxTime <= minTime) return safeMin

  const dayMs = 24 * 60 * 60 * 1000
  const days = Math.floor((maxTime - minTime) / dayMs)
  const offset = Math.floor(Math.random() * (days + 1))
  return toLocalIsoDate(new Date(minTime + offset * dayMs))
}

const toLocalIsoDate = (date) => {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return ''
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

const getLocalShippingDateBounds = () => {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const minDate = new Date(today)
  minDate.setDate(minDate.getDate() + SHIPPING_MIN_DELAY_DAYS)
  const maxDate = new Date(today)
  maxDate.setDate(maxDate.getDate() + SHIPPING_MAX_DELAY_DAYS)
  return {
    minIso: toLocalIsoDate(minDate),
    maxIso: toLocalIsoDate(maxDate),
  }
}

const formatFrenchDateShort = (isoDate) => {
  const safeIso = normalizeIsoDate(isoDate)
  if (!safeIso) return 'Date non définie'
  const date = new Date(`${safeIso}T00:00:00`)
  if (Number.isNaN(date.getTime())) return 'Date non définie'
  return new Intl.DateTimeFormat('fr-FR', {
    weekday: 'short',
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  }).format(date)
}

const hasManualRolePrivilege = (role) => {
  const normalized = String(role || '').trim().toUpperCase()
  if (!normalized) return false
  return ['VIP', 'MODERATION', 'ADMIN'].some((keyword) => normalized.includes(keyword))
}

const getShippingScheduleReason = (reason) => {
  if (reason === 'VIP_MANUAL_ONLY') return 'Réservation manuelle réservée aux VIP.'
  if (reason === 'DATE_INVALID') return 'Format de date invalide.'
  if (reason === 'DATE_BLOCKED') return 'Cette date est interdite par les règles d’expédition.'
  if (reason === 'DATE_OUT_OF_RANGE') return 'Date hors période autorisée (7 à 60 jours).'
  if (reason === 'DAY_FULL') return 'Ce jour est déjà complet pour les expéditions.'
  if (reason === 'NO_SLOT_AVAILABLE') return 'Aucun créneau libre trouvé dans la période demandée.'
  if (reason === 'AGE_NOT_ELIGIBLE') return 'Le bétail doit avoir plus de 6 ans avant planification.'
  if (reason === 'ALREADY_DELIVERED') return 'Ce bétail est déjà marqué comme livré.'
  if (reason === 'SHIPPING_RPC_MISSING') return 'Fonction SQL schedule_shipping_reborn absente côté base.'
  if (reason === 'SHIPPING_PREVIEW_ERROR' || reason === 'SHIPPING_CONFIRM_ERROR') {
    return 'Erreur lors de la planification d’expédition.'
  }
  return 'Planification impossible pour le moment.'
}

const getConstraintReason = (reason, fallback = false) => {
  if (reason === 'INSUFFICIENT_FUNDS') {
    return 'Solde insuffisant pour la croissance.'
  }
  if (reason === 'AGE_ALREADY_ELIGIBLE') {
    return 'Ce bétail a déjà l’âge requis.'
  }
  if (reason === 'NOT_AUTHENTICATED') {
    return 'Session expirée. Recharge la page.'
  }
  if (reason === 'NOT_FOUND') {
    return 'Bétail introuvable.'
  }
  if (reason === 'PROFILE_NOT_FOUND') {
    return 'Profil introuvable.'
  }
  if (reason === 'GROWTH_RPC_MISSING') {
    return 'Fonction de croissance non déployée côté base.'
  }
  if (reason === 'PREVIEW_ERROR' || reason === 'GROWTH_ERROR') {
    return 'Erreur lors de la requête de croissance.'
  }
  if (fallback) {
    return 'Impossible de calculer la croissance pour le moment.'
  }
  return 'Action impossible pour le moment.'
}

function MyBetailsShippingPanel({
  isOpen,
  onClose,
  onGoToGce,
  shippingTarget,
  mascotUrl,
  decorUrls,
  onPreviewGrowth,
  onConfirmGrowth,
  isGrowthPending = false,
  onPreviewShipping,
  onConfirmShipping,
  isShippingPending = false,
}) {
  const [stepIndex, setStepIndex] = useState(1)
  const [studyStatus, setStudyStatus] = useState('idle')
  const [displayedCost, setDisplayedCost] = useState(0)
  const [studyResult, setStudyResult] = useState(() => buildShippingStudy(shippingTarget))
  const [ackLocked, setAckLocked] = useState(false)
  const [currentAge, setCurrentAge] = useState(() => normalizeAge(shippingTarget?.age))
  const [growthPreview, setGrowthPreview] = useState({
    status: 'idle',
    cost: 0,
    money: null,
    canAfford: null,
    reason: null,
    message: '',
  })
  const [growthConfirmArmed, setGrowthConfirmArmed] = useState(false)
  const [activeFactorLabel, setActiveFactorLabel] = useState('')
  const [shippingPlan, setShippingPlan] = useState({
    status: 'idle',
    selectedDate: '',
    suggestedDate: '',
    minDate: '',
    maxDate: '',
    dayCount: 0,
    dayLimit: 1,
    estimatedGain: Number.isFinite(Number(shippingTarget?.shippingEstimatedGain))
      ? Math.max(0, Math.round(Number(shippingTarget.shippingEstimatedGain)))
      : 0,
    reassigned: false,
    alreadyScheduled: false,
    manualChoice: false,
    message: '',
  })
  const [manualDateInput, setManualDateInput] = useState('')
  const [isManualDateLoading, setIsManualDateLoading] = useState(false)
  const [isVipManualOpen, setIsVipManualOpen] = useState(false)
  const [showBlockedDays, setShowBlockedDays] = useState(false)
  const [shippingNote, setShippingNote] = useState('')
  const [dateRoll, setDateRoll] = useState({ active: false, text: '' })
  const [slotSliderValue, setSlotSliderValue] = useState(0)
  const [slotSliderLock, setSlotSliderLock] = useState(false)
  const [confirmState, setConfirmState] = useState({
    status: 'idle',
    message: '',
  })
  const [successModal, setSuccessModal] = useState({
    open: false,
    message: '',
    selectedDate: '',
  })
  const raffleIntervalRef = useRef(null)
  const cautionAudioRef = useRef(null)
  const costRevealAudioRef = useRef(null)
  const finalHoverAudioRef = useRef(null)
  const finalClickAudioRef = useRef(null)
  const ackUnlockTimeoutRef = useRef(null)
  const lastGrowthPreviewKeyRef = useRef('')
  const costRevealBlobUrlRef = useRef('')
  const costRevealPlayedRef = useRef(false)
  const dateRollIntervalRef = useRef(null)
  const dateRollTimeoutRef = useRef(null)
  const successModalTimeoutRef = useRef(null)

  const clearRaffleAnimation = useCallback(() => {
    if (!raffleIntervalRef.current) return
    window.clearInterval(raffleIntervalRef.current)
    raffleIntervalRef.current = null
  }, [])

  const clearCautionAudio = useCallback(() => {
    if (!cautionAudioRef.current) return
    try {
      cautionAudioRef.current.pause()
      cautionAudioRef.current.currentTime = 0
    } catch {
      // noop
    }
    cautionAudioRef.current = null
  }, [])

  const clearCostRevealAudio = useCallback(() => {
    if (costRevealAudioRef.current) {
      try {
        costRevealAudioRef.current.pause()
        costRevealAudioRef.current.currentTime = 0
      } catch {
        // noop
      }
      costRevealAudioRef.current = null
    }
    if (costRevealBlobUrlRef.current) {
      URL.revokeObjectURL(costRevealBlobUrlRef.current)
      costRevealBlobUrlRef.current = ''
    }
  }, [])

  const clearFinalHoverAudio = useCallback(() => {
    if (!finalHoverAudioRef.current) return
    try {
      finalHoverAudioRef.current.pause()
      finalHoverAudioRef.current.currentTime = 0
    } catch {
      // noop
    }
    finalHoverAudioRef.current = null
  }, [])

  const clearFinalClickAudio = useCallback(() => {
    if (!finalClickAudioRef.current) return
    try {
      finalClickAudioRef.current.pause()
      finalClickAudioRef.current.currentTime = 0
    } catch {
      // noop
    }
    finalClickAudioRef.current = null
  }, [])

  const clearAckUnlockTimeout = useCallback(() => {
    if (!ackUnlockTimeoutRef.current) return
    window.clearTimeout(ackUnlockTimeoutRef.current)
    ackUnlockTimeoutRef.current = null
  }, [])

  const clearDateRoll = useCallback(() => {
    if (dateRollIntervalRef.current) {
      window.clearInterval(dateRollIntervalRef.current)
      dateRollIntervalRef.current = null
    }
    if (dateRollTimeoutRef.current) {
      window.clearTimeout(dateRollTimeoutRef.current)
      dateRollTimeoutRef.current = null
    }
    setDateRoll((prev) => ({ ...prev, active: false }))
  }, [])

  const clearSuccessModalTimeout = useCallback(() => {
    if (!successModalTimeoutRef.current) return
    window.clearTimeout(successModalTimeoutRef.current)
    successModalTimeoutRef.current = null
  }, [])

  useEffect(
    () => () => {
      clearRaffleAnimation()
      clearCautionAudio()
      clearCostRevealAudio()
      clearFinalHoverAudio()
      clearFinalClickAudio()
      clearAckUnlockTimeout()
      clearDateRoll()
      clearSuccessModalTimeout()
    },
    [
      clearRaffleAnimation,
      clearCautionAudio,
      clearCostRevealAudio,
      clearFinalHoverAudio,
      clearFinalClickAudio,
      clearAckUnlockTimeout,
      clearDateRoll,
      clearSuccessModalTimeout,
    ],
  )

  useEffect(() => {
    if (!isOpen) {
      clearRaffleAnimation()
      clearCautionAudio()
      clearCostRevealAudio()
      clearFinalHoverAudio()
      clearFinalClickAudio()
      clearSuccessModalTimeout()
      return
    }

    const nextStudy = buildShippingStudy(shippingTarget)
    setStudyResult(nextStudy)
    setStepIndex(1)
    setStudyStatus('idle')
    setDisplayedCost(0)
    setCurrentAge(normalizeAge(shippingTarget?.age))
    setGrowthPreview({
      status: 'idle',
      cost: 0,
      money: null,
      canAfford: null,
      reason: null,
      message: '',
    })
    setGrowthConfirmArmed(false)
    setActiveFactorLabel('')
    setShippingPlan({
      status: 'idle',
      selectedDate: '',
      suggestedDate: '',
      minDate: '',
      maxDate: '',
      dayCount: 0,
      dayLimit: 1,
      estimatedGain: Number.isFinite(Number(shippingTarget?.shippingEstimatedGain))
        ? Math.max(0, Math.round(Number(shippingTarget.shippingEstimatedGain)))
        : 0,
      reassigned: false,
      alreadyScheduled: false,
      manualChoice: false,
      message: '',
    })
    setManualDateInput('')
    setIsManualDateLoading(false)
    setIsVipManualOpen(false)
    setShowBlockedDays(false)
    setShippingNote('')
    setDateRoll({ active: false, text: '' })
    setSlotSliderValue(0)
    setSlotSliderLock(false)
    setConfirmState({ status: 'idle', message: '' })
    setSuccessModal({ open: false, message: '', selectedDate: '' })
    setAckLocked(true)
    clearAckUnlockTimeout()
    lastGrowthPreviewKeyRef.current = ''
    costRevealPlayedRef.current = false
    clearDateRoll()
  }, [
    isOpen,
    shippingTarget?.id,
    shippingTarget?.premium,
    shippingTarget?.age,
    shippingTarget?.createdAt,
    shippingTarget?.badgeCount,
    clearRaffleAnimation,
    clearCautionAudio,
    clearCostRevealAudio,
    clearFinalHoverAudio,
    clearFinalClickAudio,
    clearAckUnlockTimeout,
    clearDateRoll,
    clearSuccessModalTimeout,
  ])

  useEffect(() => {
    if (!isOpen || stepIndex !== 1) {
      clearAckUnlockTimeout()
      return
    }

    setAckLocked(true)
    clearAckUnlockTimeout()
    ackUnlockTimeoutRef.current = window.setTimeout(() => {
      setAckLocked(false)
      ackUnlockTimeoutRef.current = null
    }, 2500)

    return () => {
      clearAckUnlockTimeout()
    }
  }, [isOpen, stepIndex, shippingTarget?.id, clearAckUnlockTimeout])

  useEffect(() => {
    if (!isOpen) return
    clearCautionAudio()
    try {
      const audio = new Audio(cautionSound)
      audio.volume = 0.82
      audio.preload = 'auto'
      cautionAudioRef.current = audio
      void audio.play().catch(() => {})
    } catch {
      // noop
    }
  }, [isOpen, shippingTarget?.id, clearCautionAudio])

  const shippingLabel = useMemo(() => {
    const matricule = shippingTarget?.matricule || '---'
    const name = shippingTarget?.name || 'Bétail inconnu'
    return `${matricule} - ${name}`
  }, [shippingTarget])

  const shippingInitial = useMemo(() => {
    const name = shippingTarget?.name || ''
    return name.trim()?.[0]?.toUpperCase() || '?'
  }, [shippingTarget?.name])

  const decorSprites = useMemo(() => {
    const sprites = []
    if (Array.isArray(decorUrls?.gupna)) {
      decorUrls.gupna.forEach((url, index) => {
        if (!url) return
        const layout = FLOWER_LAYOUTS[index % FLOWER_LAYOUTS.length]
        sprites.push({ key: `flower-${index}`, url, kind: 'flower', ...layout })
      })
    }
    if (decorUrls?.coins) {
      COIN_LAYOUTS.forEach((layout, index) => {
        sprites.push({ key: `coin-${index}`, url: decorUrls.coins, kind: 'coin', ...layout })
      })
    }
    return sprites
  }, [decorUrls])

  const estimatedGrowthCost = useMemo(
    () =>
      estimateGrowthCost({
        age: currentAge,
        premium: shippingTarget?.premium,
        badgeCount: shippingTarget?.badgeCount,
      }),
    [currentAge, shippingTarget?.premium, shippingTarget?.badgeCount],
  )

  const isAgeEligible = currentAge > 6
  const growthCost = Number.isFinite(Number(growthPreview?.cost))
    ? Number(growthPreview.cost)
    : estimatedGrowthCost
  const isGrowthLoading = isGrowthPending || growthPreview.status === 'loading'
  const showConstraintWarning = !isAgeEligible
  const shouldShowConstraintStep = stepIndex === 3 && showConstraintWarning
  const isVipUser = hasManualRolePrivilege(shippingTarget?.role)
  const vipDisabledReason = 'Réservé aux membres VIP.'
  const localShippingDateBounds = useMemo(() => getLocalShippingDateBounds(), [])
  const selectedShippingDate = shippingPlan.selectedDate || shippingPlan.suggestedDate
  const estimatedShippingGain = useMemo(() => {
    const studyGain = Number(studyResult?.totalCost)
    if (Number.isFinite(studyGain) && studyGain > 0) {
      return Math.max(0, Math.round(studyGain))
    }

    const targetGain = Number(shippingTarget?.shippingEstimatedGain)
    if (Number.isFinite(targetGain) && targetGain > 0) {
      return Math.max(0, Math.round(targetGain))
    }

    return 0
  }, [studyResult?.totalCost, shippingTarget?.shippingEstimatedGain])
  const selectedEstimatedGain = Number.isFinite(Number(shippingPlan.estimatedGain)) && Number(shippingPlan.estimatedGain) > 0
    ? Math.max(0, Math.round(Number(shippingPlan.estimatedGain)))
    : estimatedShippingGain
  const canValidateSlot = shippingPlan.status === 'ready' && Boolean(selectedShippingDate)
  const isSlotSliderReady = canValidateSlot && !slotSliderLock && shippingPlan.status === 'ready'
  const isSlotSliderDisabled = !canValidateSlot || slotSliderLock || shippingPlan.status !== 'ready'
  const studyCompletionPercent = useMemo(() => {
    const base = Number(studyResult?.totalCost)
    if (!Number.isFinite(base) || base <= 0) return 0
    return Math.max(0, Math.min(100, Math.round((displayedCost / base) * 100)))
  }, [displayedCost, studyResult?.totalCost])
  const activeFactor = useMemo(() => {
    if (!Array.isArray(studyResult?.factors) || studyResult.factors.length === 0) return null
    const selected = studyResult.factors.find((factor) => factor.label === activeFactorLabel)
    return selected || studyResult.factors[0]
  }, [studyResult, activeFactorLabel])
  const growthPreviewKey = useMemo(
    () => `${shippingTarget?.id || 'none'}:${currentAge}:${isAgeEligible ? 'ok' : 'ko'}`,
    [shippingTarget?.id, currentAge, isAgeEligible],
  )

  const playCostReveal = useCallback(async () => {
    clearCostRevealAudio()

    try {
      const audio = new Audio(costRevealSound)
      audio.preload = 'auto'
      audio.volume = 0.72
      costRevealAudioRef.current = audio
      await audio.play()
      return
    } catch {
      // fallback below
    }

    try {
      const response = await fetch(costRevealSound, { cache: 'no-store' })
      if (!response.ok) return
      const blob = await response.blob()
      const blobUrl = URL.createObjectURL(blob)
      costRevealBlobUrlRef.current = blobUrl
      const audio = new Audio(blobUrl)
      audio.preload = 'auto'
      audio.volume = 0.72
      costRevealAudioRef.current = audio
      audio.addEventListener(
        'ended',
        () => {
          if (costRevealBlobUrlRef.current) {
            URL.revokeObjectURL(costRevealBlobUrlRef.current)
            costRevealBlobUrlRef.current = ''
          }
        },
        { once: true },
      )
      void audio.play().catch(() => {
        if (costRevealBlobUrlRef.current) {
          URL.revokeObjectURL(costRevealBlobUrlRef.current)
          costRevealBlobUrlRef.current = ''
        }
      })
    } catch {
      // noop
    }
  }, [clearCostRevealAudio])

  const playFinalHover = useCallback(() => {
    clearFinalHoverAudio()
    try {
      const audio = new Audio(finalHoverSound)
      audio.preload = 'auto'
      audio.volume = 0.7
      finalHoverAudioRef.current = audio
      void audio.play().catch(() => {})
    } catch {
      // noop
    }
  }, [clearFinalHoverAudio])

  const playFinalClick = useCallback(() => {
    clearFinalClickAudio()
    try {
      const audio = new Audio(finalClickSound)
      audio.preload = 'auto'
      audio.volume = 0.76
      finalClickAudioRef.current = audio
      void audio.play().catch(() => {})
    } catch {
      // noop
    }
  }, [clearFinalClickAudio])

  const closeSuccessModal = useCallback(() => {
    clearSuccessModalTimeout()
    setSuccessModal({ open: false, message: '', selectedDate: '' })
    if (typeof onClose === 'function') {
      onClose()
    }
  }, [clearSuccessModalTimeout, onClose])

  const goToGceFromModal = useCallback(() => {
    clearSuccessModalTimeout()
    setSuccessModal({ open: false, message: '', selectedDate: '' })
    if (typeof onClose === 'function') {
      onClose()
    }
    if (typeof onGoToGce === 'function') {
      onGoToGce()
    }
  }, [clearSuccessModalTimeout, onClose, onGoToGce])

  const loadShippingPreview = useCallback(async ({
    requestedDate = null,
    manualChoice = false,
    note = null,
    allowReassign = false,
  } = {}) => {
    if (!shippingTarget?.id || !isAgeEligible) return

    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const minDate = new Date(today)
    minDate.setDate(minDate.getDate() + SHIPPING_MIN_DELAY_DAYS)
    const maxDate = new Date(today)
    maxDate.setDate(maxDate.getDate() + SHIPPING_MAX_DELAY_DAYS)
    const minIso = toLocalIsoDate(minDate)
    const maxIso = toLocalIsoDate(maxDate)

    clearDateRoll()
    const rollStartedAt = Date.now()
    setDateRoll({
      active: true,
      text: formatFrenchDateShort(randomIsoDateInRange(minIso, maxIso)),
    })
    dateRollIntervalRef.current = window.setInterval(() => {
      setDateRoll({
        active: true,
        text: formatFrenchDateShort(randomIsoDateInRange(minIso, maxIso)),
      })
    }, 58)

    const finishRoll = (text) => {
      const elapsed = Date.now() - rollStartedAt
      const waitMs = Math.max(0, 2300 - elapsed)
      dateRollTimeoutRef.current = window.setTimeout(() => {
        clearDateRoll()
        setDateRoll({ active: false, text })
      }, waitMs)
    }

    if (typeof onPreviewShipping !== 'function') {
      setShippingPlan({
        status: 'error',
        selectedDate: '',
        suggestedDate: '',
        minDate: minIso,
        maxDate: maxIso,
        dayCount: 0,
        dayLimit: 1,
        estimatedGain: selectedEstimatedGain,
        reassigned: false,
        alreadyScheduled: false,
        manualChoice,
        message: getShippingScheduleReason('SHIPPING_RPC_MISSING'),
      })
      finishRoll('Échec du tirage')
      return
    }

    setShippingPlan((prev) => ({
      ...prev,
      status: 'loading',
      message: '',
    }))

    const preview = await onPreviewShipping({
      betailId: shippingTarget.id,
      requestedDate,
      manualChoice,
      note,
      estimatedGain: selectedEstimatedGain,
      minDaysAhead: SHIPPING_MIN_DELAY_DAYS,
      maxDaysAhead: SHIPPING_MAX_DELAY_DAYS,
      allowReassign,
    })

    if (!preview?.success) {
      setShippingPlan((prev) => ({
        ...prev,
        status: 'error',
        alreadyScheduled: false,
        message: getShippingScheduleReason(preview?.reason),
      }))
      finishRoll('Créneau indisponible')
      return
    }

    const suggestedDate = normalizeIsoDate(preview?.suggested_date)
    const selectedDate = normalizeIsoDate(preview?.selected_date) || suggestedDate
    const minFromServer = normalizeIsoDate(preview?.min_date)
    const maxFromServer = normalizeIsoDate(preview?.max_date)
    const serverNote = typeof preview?.notes === 'string' ? preview.notes : ''

    setShippingPlan({
      status: 'ready',
      selectedDate,
      suggestedDate,
      minDate: minFromServer || minIso,
      maxDate: maxFromServer || maxIso,
      dayCount: Number.isFinite(Number(preview?.day_count)) ? Number(preview.day_count) : 0,
      dayLimit: Number.isFinite(Number(preview?.day_limit)) ? Number(preview.day_limit) : 1,
      estimatedGain: Number.isFinite(Number(preview?.estimated_gain))
        ? Math.max(0, Math.round(Number(preview.estimated_gain)))
        : selectedEstimatedGain,
      reassigned: Boolean(preview?.reassigned),
      alreadyScheduled: Boolean(preview?.already_scheduled),
      manualChoice: Boolean(preview?.manual_choice),
      message: preview?.message || '',
    })

    if (selectedDate) {
      setManualDateInput(selectedDate)
    }
    if (serverNote) {
      setShippingNote(serverNote)
    }
    finishRoll(formatFrenchDateShort(selectedDate))
  }, [shippingTarget?.id, isAgeEligible, onPreviewShipping, clearDateRoll, selectedEstimatedGain])

  const goToScheduleStep = useCallback(() => {
    if (!isAgeEligible) return
    setStepIndex(4)
    setIsVipManualOpen(false)
    setShowBlockedDays(false)
    setSlotSliderValue(0)
    setSlotSliderLock(false)
    setConfirmState({ status: 'idle', message: '' })
  }, [isAgeEligible])

  const handleManualDatePick = useCallback(async () => {
    setShowBlockedDays(true)
    if (!isVipUser || !manualDateInput || isManualDateLoading || shippingPlan.status === 'loading') return

    const normalizedManualDate = normalizeIsoDate(manualDateInput)
    const minAllowedDate = shippingPlan.minDate || localShippingDateBounds.minIso
    const maxAllowedDate = shippingPlan.maxDate || localShippingDateBounds.maxIso

    if (!normalizedManualDate || normalizedManualDate < minAllowedDate || normalizedManualDate > maxAllowedDate) {
      const message = getShippingScheduleReason('DATE_OUT_OF_RANGE')
      setShippingPlan((prev) => ({
        ...prev,
        status: 'error',
        message,
      }))
      emitToast('error', message)
      return
    }

    setIsManualDateLoading(true)
    await loadShippingPreview({
      requestedDate: normalizedManualDate,
      manualChoice: true,
      note: shippingNote,
      allowReassign: true,
    })
    setIsManualDateLoading(false)
  }, [
    isVipUser,
    manualDateInput,
    isManualDateLoading,
    shippingPlan.status,
    shippingPlan.minDate,
    shippingPlan.maxDate,
    localShippingDateBounds.minIso,
    localShippingDateBounds.maxIso,
    loadShippingPreview,
    shippingNote,
  ])

  const handleAutoDateAssign = useCallback(async () => {
    if (shippingPlan.status === 'loading') return
    setIsVipManualOpen(false)
    setIsManualDateLoading(false)
    await loadShippingPreview({
      requestedDate: null,
      manualChoice: false,
      note: shippingNote,
      allowReassign: true,
    })
  }, [shippingPlan.status, loadShippingPreview, shippingNote])

  const handleToggleVipManual = useCallback(() => {
    if (!isVipUser) return
    setIsVipManualOpen((prev) => !prev)
    setShowBlockedDays(true)
  }, [isVipUser])

  const handleSlotSliderCommit = useCallback(() => {
    if (!canValidateSlot || slotSliderLock) return
    setSlotSliderLock(true)
    window.requestAnimationFrame(() => {
      setSlotSliderValue(0)
      setStepIndex(5)
      setSlotSliderLock(false)
      setConfirmState({ status: 'idle', message: '' })
    })
  }, [canValidateSlot, slotSliderLock])

  const handleConfirmShippingSlot = useCallback(async () => {
    if (!shippingTarget?.id || !selectedShippingDate || isShippingPending) return

    if (typeof onConfirmShipping !== 'function') {
      setConfirmState({
        status: 'error',
        message: getShippingScheduleReason('SHIPPING_RPC_MISSING'),
      })
      return
    }

    setConfirmState({ status: 'loading', message: '' })
    playFinalClick()
    const result = await onConfirmShipping({
      betailId: shippingTarget.id,
      requestedDate: selectedShippingDate,
      manualChoice: Boolean(shippingPlan.manualChoice),
      note: shippingNote,
      estimatedGain: selectedEstimatedGain,
      minDaysAhead: SHIPPING_MIN_DELAY_DAYS,
      maxDaysAhead: SHIPPING_MAX_DELAY_DAYS,
      allowReassign: true,
    })

    if (!result?.success) {
      setConfirmState({
        status: 'error',
        message: getShippingScheduleReason(result?.reason),
      })
      return
    }

    const updatedDate = normalizeIsoDate(result?.selected_date) || selectedShippingDate
    const wasReassigned = Boolean(result?.reassigned)

    setShippingPlan((prev) => ({
      ...prev,
      selectedDate: updatedDate,
      estimatedGain: Number.isFinite(Number(result?.estimated_gain))
        ? Math.max(0, Math.round(Number(result.estimated_gain)))
        : prev.estimatedGain,
      reassigned: wasReassigned,
      alreadyScheduled: Boolean(result?.already_scheduled) || prev.alreadyScheduled,
      message: result?.message || prev.message,
    }))

    if (typeof result?.notes === 'string') {
      setShippingNote(result.notes)
    }

    setConfirmState({
      status: 'success',
      message: wasReassigned
        ? `Le créneau demandé a été pris entre-temps. Nouvelle date attribuée: ${formatFrenchDateShort(updatedDate)}.`
        : 'Expédition programmée avec succès.',
    })
    clearSuccessModalTimeout()
    setSuccessModal({
      open: true,
      selectedDate: updatedDate,
      message: wasReassigned
        ? `Le créneau a été réassigné puis validé au ${formatFrenchDateShort(updatedDate)}.`
        : 'Expédition validée. Le registre GCE est prêt.',
    })
    successModalTimeoutRef.current = window.setTimeout(() => {
      closeSuccessModal()
      successModalTimeoutRef.current = null
    }, 4000)
    setStepIndex(7)
  }, [
    shippingTarget?.id,
    selectedShippingDate,
    isShippingPending,
    onConfirmShipping,
    shippingPlan.manualChoice,
    shippingNote,
    selectedEstimatedGain,
    playFinalClick,
    clearSuccessModalTimeout,
    closeSuccessModal,
  ])

  const loadGrowthPreview = useCallback(async () => {
    if (!shippingTarget?.id || isAgeEligible) {
      setGrowthPreview({
        status: 'idle',
        cost: 0,
        money: null,
        canAfford: null,
        reason: null,
        message: '',
      })
      return
    }

    if (typeof onPreviewGrowth !== 'function') {
      setGrowthPreview({
        status: 'ready',
        cost: estimatedGrowthCost,
        money: null,
        canAfford: null,
        reason: 'PREVIEW_UNAVAILABLE',
        message: 'Prévisualisation serveur indisponible, estimation locale appliquée.',
      })
      return
    }

    setGrowthPreview((prev) => ({
      ...prev,
      status: 'loading',
      reason: null,
      message: '',
    }))

    const preview = await onPreviewGrowth(shippingTarget.id)
    if (preview?.success) {
      const previewCost = Number(preview?.cost)
      const previewMoney = Number(preview?.money)
      const normalizedCost = Number.isFinite(previewCost) ? previewCost : estimatedGrowthCost
      const normalizedMoney = Number.isFinite(previewMoney) ? previewMoney : null
      const canAfford =
        preview?.can_afford === false
          ? false
          : normalizedMoney === null
            ? null
            : normalizedMoney >= normalizedCost

      setGrowthPreview({
        status: 'ready',
        cost: normalizedCost,
        money: normalizedMoney,
        canAfford,
        reason: null,
        message: '',
      })
      return
    }

    if (preview?.reason === 'AGE_ALREADY_ELIGIBLE') {
      setCurrentAge((prev) => Math.max(prev, MIN_SHIPPING_AGE))
      setGrowthPreview({
        status: 'idle',
        cost: 0,
        money: null,
        canAfford: true,
        reason: null,
        message: '',
      })
      return
    }

    setGrowthPreview({
      status: 'error',
      cost: estimatedGrowthCost,
      money: null,
      canAfford: null,
      reason: preview?.reason || 'PREVIEW_ERROR',
      message: getConstraintReason(preview?.reason, true),
    })
  }, [shippingTarget?.id, isAgeEligible, onPreviewGrowth, estimatedGrowthCost])

  useEffect(() => {
    if (!isOpen || stepIndex !== 3) return
    if (isAgeEligible) {
      setGrowthConfirmArmed(false)
      return
    }
    if (growthPreview.status === 'loading') return
    if (lastGrowthPreviewKeyRef.current === growthPreviewKey && growthPreview.status !== 'idle') return
    lastGrowthPreviewKeyRef.current = growthPreviewKey
    void loadGrowthPreview()
  }, [isOpen, stepIndex, isAgeEligible, loadGrowthPreview, growthPreview.status, growthPreviewKey])

  useEffect(() => {
    if (stepIndex !== 2 || studyStatus !== 'done' || !Array.isArray(studyResult?.factors)) return
    if (!studyResult.factors.length) return
    setActiveFactorLabel((prev) => {
      if (prev && studyResult.factors.some((factor) => factor.label === prev)) return prev
      return studyResult.factors[0].label
    })
  }, [stepIndex, studyStatus, studyResult])

  useEffect(() => {
    if (!isOpen || stepIndex !== 2 || studyStatus !== 'done') return
    if (costRevealPlayedRef.current) return
    costRevealPlayedRef.current = true
    void playCostReveal()
  }, [isOpen, stepIndex, studyStatus, playCostReveal])

  useEffect(() => {
    if (!isOpen || stepIndex !== 3 || !isAgeEligible) return
    setStepIndex(4)
  }, [isOpen, stepIndex, isAgeEligible])

  useEffect(() => {
    if (!isOpen || stepIndex !== 4 || !isAgeEligible) return
    if (shippingPlan.status !== 'idle') return
    void loadShippingPreview()
  }, [isOpen, stepIndex, isAgeEligible, shippingPlan.status, loadShippingPreview])

  const startCostStudy = useCallback(() => {
    if (!shippingTarget || ackLocked) return
    const nextStudy = buildShippingStudy(shippingTarget)
    const finalCost = nextStudy.totalCost
    const durationMs = 2200
    const tickMs = 70
    const startedAt = Date.now()

    clearRaffleAnimation()
    setStudyResult(nextStudy)
    setDisplayedCost(0)
    setStepIndex(2)
    setStudyStatus('running')
    setActiveFactorLabel('')
    costRevealPlayedRef.current = false

    raffleIntervalRef.current = window.setInterval(() => {
      const elapsed = Date.now() - startedAt
      const progress = Math.min(elapsed / durationMs, 1)
      const eased = 1 - Math.pow(1 - progress, 3)
      if (progress >= 1) {
        setDisplayedCost(finalCost)
        setStudyStatus('done')
        clearRaffleAnimation()
        return
      }
      const baseline = finalCost * eased
      const jitterAmplitude = Math.max(24, finalCost * (0.65 * (1 - eased)))
      const jitter = (Math.random() * 2 - 1) * jitterAmplitude
      const nextValue = Math.max(0, Math.round(baseline + jitter))
      setDisplayedCost(nextValue)
    }, tickMs)
  }, [shippingTarget, ackLocked, clearRaffleAnimation])

  const goToConstraintsStep = useCallback(() => {
    if (isAgeEligible) return
    setStepIndex(3)
    setGrowthConfirmArmed(false)
  }, [isAgeEligible])

  const handleGrowthClick = useCallback(async () => {
    if (!shippingTarget?.id || isAgeEligible || isGrowthLoading) return

    if (!growthConfirmArmed) {
      setGrowthConfirmArmed(true)
      return
    }

    if (typeof onConfirmGrowth !== 'function') {
      setGrowthPreview((prev) => ({
        ...prev,
        status: 'error',
        reason: 'GROWTH_UNAVAILABLE',
        message: 'Croissance indisponible pour le moment.',
      }))
      setGrowthConfirmArmed(false)
      return
    }

    const growthResult = await onConfirmGrowth(shippingTarget.id)
    if (growthResult?.success) {
      const nextAge = normalizeAge(growthResult?.new_age)
      const appliedAge = nextAge > 0 ? nextAge : currentAge + 1
      const moneyAfter = Number(growthResult?.money_after)
      const paidCost = Number(growthResult?.cost)

      setCurrentAge(appliedAge)
      setGrowthConfirmArmed(false)
      setGrowthPreview((prev) => ({
        ...prev,
        status: 'ready',
        cost: Number.isFinite(paidCost) ? paidCost : prev.cost,
        money: Number.isFinite(moneyAfter) ? moneyAfter : prev.money,
        canAfford: true,
        reason: null,
        message: `Croissance appliquée: le bétail a désormais ${appliedAge} an${appliedAge > 1 ? 's' : ''}.`,
      }))

      emitToast('success', `Croissance réussie: ${shippingLabel} passe à ${appliedAge} an${appliedAge > 1 ? 's' : ''}.`)

      return
    }

    const reason = growthResult?.reason || 'GROWTH_ERROR'
    if (reason === 'AGE_ALREADY_ELIGIBLE') {
      setCurrentAge((prev) => Math.max(prev, MIN_SHIPPING_AGE))
      setGrowthConfirmArmed(false)
      setGrowthPreview((prev) => ({
        ...prev,
        status: 'idle',
        reason: null,
        message: '',
      }))
      return
    }

    const resultCost = Number(growthResult?.cost)
    const resultMoney = Number(growthResult?.money)
    const nextCost = Number.isFinite(resultCost) ? resultCost : growthCost
    const nextMoney = Number.isFinite(resultMoney) ? resultMoney : growthPreview.money
    const canAfford = Number.isFinite(resultMoney) && Number.isFinite(resultCost) ? resultMoney >= resultCost : false

    setGrowthPreview((prev) => ({
      ...prev,
      status: reason === 'INSUFFICIENT_FUNDS' ? 'ready' : 'error',
      cost: nextCost,
      money: nextMoney,
      canAfford,
      reason,
      message: getConstraintReason(reason),
    }))
    setGrowthConfirmArmed(false)
    emitToast('error', getConstraintReason(reason))
  }, [
    shippingTarget?.id,
    shippingLabel,
    isAgeEligible,
    isGrowthLoading,
    growthConfirmArmed,
    onConfirmGrowth,
    currentAge,
    growthCost,
    growthPreview.money,
  ])

  const growthButtonLabel = useMemo(() => {
    if (isGrowthLoading) return 'Croissance en cours...'
    if (growthConfirmArmed) return `Confirmer croissance (+1 an • ${formatCost(growthCost)})`
    return `Croissance (+1 an • ${formatCost(growthCost)})`
  }, [isGrowthLoading, growthConfirmArmed, growthCost])

  return (
    <aside
      className="betails-column-panel my-betails-panel-column my-shipping-panel-column"
      aria-hidden={!isOpen}
    >
      <section
        className={`betail-details-panel betails-panel my-betail-panel my-shipping-panel ${isOpen ? 'is-open' : ''}`}
        aria-live="polite"
      >
        {isOpen ? (
          <>
            <header className="betail-details-header">
              <h2 className="betail-details-title">Expédition du bétail</h2>
              <div className="betail-details-actions my-betail-panel-actions">
                <button
                  type="button"
                  className="betail-details-close"
                  onClick={onClose}
                  aria-label="Fermer les détails"
                >
                  ✕
                </button>
              </div>
            </header>

            <div className="betail-details-body my-shipping-panel-body">
              {decorSprites.length ? (
                <div className="my-shipping-bg-layer" aria-hidden="true">
                  {decorSprites.map((sprite) => (
                    <img
                      key={sprite.key}
                      src={sprite.url}
                      alt=""
                      className={`my-shipping-bg-sprite ${sprite.kind === 'coin' ? 'is-coin' : 'is-flower'}`}
                      loading="lazy"
                      decoding="async"
                      fetchPriority="low"
                      style={{
                        top: sprite.top,
                        left: sprite.left,
                        width: `${sprite.size}px`,
                        opacity: sprite.opacity,
                        transform: `translate(-50%, -50%) rotate(${sprite.rotate}deg)`,
                      }}
                    />
                  ))}
                </div>
              ) : null}

              <div className="my-shipping-target-chip" aria-label="Bétail concerné par l'expédition">
                <div
                  className={`my-shipping-target-avatar ${shippingTarget?.premium ? 'is-premium' : ''}`}
                  aria-hidden={!shippingTarget?.avatarUrl}
                >
                  {shippingTarget?.avatarUrl ? (
                    <img src={shippingTarget.avatarUrl} alt={shippingTarget?.name || 'Bétail'} />
                  ) : (
                    <span>{shippingInitial}</span>
                  )}
                </div>
                <div className="my-shipping-target-meta">
                  <p className="my-shipping-target-label">Tu t'apprêtes à expédier</p>
                  <p className="my-shipping-target-name">{shippingLabel}</p>
                </div>
              </div>

              <div className="my-shipping-flow">
                {stepIndex === 1 ? (
                  <section className="my-shipping-stage my-shipping-warning-stage" role="alert">
                    {mascotUrl ? (
                      <img
                        src={mascotUrl}
                        alt=""
                        aria-hidden="true"
                        className="my-shipping-mascot"
                        loading="lazy"
                        decoding="async"
                      />
                    ) : null}

                    <div className="my-shipping-warning-copy">
                      <p className="my-shipping-warning-kicker">Opération irréversible</p>
                      <p className="my-shipping-warning-text">
                        Cette action est irréversible: ce bétail ne figurera plus dans ta ferme ni dans aucune autre.
                      </p>
                      <p className="my-shipping-warning-text">
                        En échange de cette offrande, tu recevras une prime dont le montant sera déterminé par une
                        étude basée sur ce bétail.
                      </p>
                    </div>
                    <div className="my-shipping-ack-wrap">
                      <button
                        type="button"
                        className={`my-betail-btn my-shipping-ack-btn ${ackLocked ? 'is-locked' : ''}`}
                        onClick={startCostStudy}
                        disabled={!shippingTarget || ackLocked}
                      >
                        Je comprends
                      </button>
                    </div>
                    <p
                      className={`my-shipping-caution-hint ${ackLocked ? '' : 'is-hidden'}`}
                      aria-hidden={!ackLocked}
                    >
                      Merci de prendre connaissance des informations ci-dessus avant de continuer.
                    </p>
                  </section>
                ) : null}

                {stepIndex === 2 ? (
                  <section className="my-shipping-stage my-shipping-cost-stage">
                    <div
                      className={`my-shipping-cost-reel ${studyStatus === 'running' ? 'is-running' : 'is-done'}`}
                      role="status"
                      aria-live="polite"
                    >
                      <span className="my-shipping-cost-label">Coût estimé</span>
                      <strong className="my-shipping-cost-number">{formatCost(displayedCost)}</strong>
                      <span className="my-shipping-cost-meta">
                        {studyStatus === 'running' ? 'Analyse du bétail en cours...' : 'Estimation terminée.'}
                      </span>
                      <div className="my-shipping-cost-progress" aria-hidden="true">
                        <div className="my-shipping-cost-progress-track">
                          <span
                            className="my-shipping-cost-progress-fill"
                            style={{ width: `${studyCompletionPercent}%` }}
                          />
                        </div>
                        <span className="my-shipping-cost-progress-value">{studyCompletionPercent}%</span>
                      </div>
                    </div>
                    {studyStatus === 'done' ? (
                      <>
                        <div className="my-shipping-factor-list" aria-label="Facteurs du coût">
                          {studyResult.factors.map((factor) => (
                            <button
                              type="button"
                              key={factor.label}
                              className={`my-shipping-factor-row ${
                                factor.value > 0 ? 'is-positive' : factor.value < 0 ? 'is-negative' : 'is-neutral'
                              } ${activeFactor?.label === factor.label ? 'is-active' : ''}`}
                              onMouseEnter={() => setActiveFactorLabel(factor.label)}
                              onFocus={() => setActiveFactorLabel(factor.label)}
                            >
                              <span>{factor.label}</span>
                              <strong>{formatSignedCost(factor.value)}</strong>
                            </button>
                          ))}
                        </div>
                        {activeFactor ? (
                          <div className="my-shipping-factor-spotlight" role="status" aria-live="polite">
                            <p className="my-shipping-factor-spotlight-title">Facteur sélectionné</p>
                            <p className="my-shipping-factor-spotlight-value">{activeFactor.label}</p>
                            <p className="my-shipping-factor-spotlight-hint">
                              {activeFactor.value > 0
                                ? 'Ce facteur augmente le coût final.'
                                : activeFactor.value < 0
                                  ? 'Ce facteur réduit le coût final.'
                                  : 'Ce facteur est neutre sur le coût final.'}
                            </p>
                          </div>
                        ) : null}

                        {showConstraintWarning ? (
                          <button
                            type="button"
                            className="my-betail-btn my-shipping-next-btn"
                            onClick={goToConstraintsStep}
                          >
                            Vérifier les contraintes d’expédition
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="my-betail-btn my-shipping-next-btn"
                            onClick={goToScheduleStep}
                          >
                            Fixer la date d’expédition
                          </button>
                        )}
                      </>
                    ) : null}
                  </section>
                ) : null}

                {shouldShowConstraintStep ? (
                  <section className="my-shipping-stage my-shipping-constraint-stage">
                    <h3 className="my-shipping-cost-title">Contraintes d’expédition</h3>
                    <p className="my-shipping-stage-caption">
                      Cette étape n’apparaît que quand une contrainte bloque l’expédition.
                    </p>

                    <div
                      className={`my-shipping-constraint-box ${showConstraintWarning ? 'is-warning' : 'is-success'}`}
                      role="status"
                      aria-live="polite"
                    >
                      <p className="my-shipping-warning-kicker">Âge insuffisant</p>
                      <p className="my-shipping-warning-text">
                        Ce bétail a <strong>{currentAge} an{currentAge > 1 ? 's' : ''}</strong>. Il doit avoir
                        <strong> plus de 6 ans</strong> pour être expédié.
                      </p>
                      <p className="my-shipping-warning-subtext">
                        Tu peux revenir en arrière, ou acheter une croissance de +1 an.
                      </p>
                    </div>

                    <div className="my-shipping-constraint-checks" aria-label="Vérification des contraintes">
                      <div className="my-shipping-check-item is-fail">
                        <span className="my-shipping-check-dot" aria-hidden="true">!</span>
                        <div>
                          <p>Âge minimal requis</p>
                          <small>Condition non remplie ({currentAge}/7 ans)</small>
                        </div>
                      </div>
                    </div>

                    <div className="my-shipping-growth-meta">
                      <span>Coût croissance</span>
                      <strong>{formatCost(growthCost)}</strong>
                    </div>
                    {Number.isFinite(growthPreview.money) ? (
                      <p className="my-shipping-growth-hint">
                        Solde actuel: <strong>{formatCost(growthPreview.money)}</strong>
                      </p>
                    ) : null}
                    {growthPreview.message ? (
                      <p className={`my-shipping-growth-hint ${growthPreview.status === 'error' ? 'is-error' : ''}`}>
                        {growthPreview.message}
                      </p>
                    ) : null}

                    <div className="my-shipping-constraint-actions">
                      <button type="button" className="my-betail-btn ghost my-shipping-back-btn" onClick={onClose}>
                        Retour
                      </button>
                      <button
                        type="button"
                        className="my-betail-btn my-shipping-growth-btn"
                        onClick={handleGrowthClick}
                        disabled={isGrowthLoading}
                      >
                        {growthButtonLabel}
                      </button>
                    </div>
                  </section>
                ) : null}

                {stepIndex === 4 ? (
                  <section className="my-shipping-stage my-shipping-schedule-stage">
                    <h3 className="my-shipping-cost-title">Fixer la date d’expédition</h3>

                    <div className="my-shipping-slot-box" role="status" aria-live="polite">
                      {shippingPlan.status === 'loading' ? (
                        <>
                          <p className="my-shipping-slot-label">Invocation épique du créneau</p>
                          <p className={`my-shipping-slot-main my-shipping-roll-date ${dateRoll.active ? 'is-rolling' : ''}`}>
                            {dateRoll.text || 'Recherche d’un créneau...'}
                          </p>
                          <p className="my-shipping-slot-meta">Le registre astral défile pour trouver ton slot.</p>
                        </>
                      ) : shippingPlan.status === 'error' ? (
                        <>
                          <p className="my-shipping-slot-main is-error">{shippingPlan.message || 'Impossible de proposer un créneau.'}</p>
                          <button
                            type="button"
                            className="my-betail-btn ghost"
                            onClick={handleAutoDateAssign}
                            disabled={shippingPlan.status === 'loading'}
                          >
                            Utiliser l’attribution automatique
                          </button>
                        </>
                      ) : (
                        <>
                          <p className="my-shipping-slot-label">Créneau proposé</p>
                          <p className="my-shipping-slot-main">{formatFrenchDateShort(selectedShippingDate)}</p>
                          <p className="my-shipping-slot-meta">
                            Expedition le même jour: {shippingPlan.dayCount}
                          </p>
                          {shippingPlan.alreadyScheduled ? (
                            <p className="my-shipping-slot-meta is-warn">
                              Date déjà fixée pour ce bétail: elle restera identique après actualisation.
                            </p>
                          ) : null}
                          {shippingPlan.reassigned ? (
                            <p className="my-shipping-slot-meta is-warn">
                              Le créneau a été ajusté automatiquement pour éviter un conflit.
                            </p>
                          ) : null}
                        </>
                      )}
                    </div>

                    <div className="my-shipping-vip-picker">
                      <p className="my-shipping-vip-title">Réservation manuelle</p>
                      <div
                        className={`my-shipping-vip-toggle-wrap ${isVipUser ? '' : 'is-disabled'}`}
                        data-tooltip={isVipUser ? '' : vipDisabledReason}
                      >
                        <button
                          type="button"
                          className="my-betail-btn my-shipping-vip-toggle-btn"
                          onClick={handleToggleVipManual}
                          disabled={!isVipUser || shippingPlan.status === 'loading'}
                          aria-label={isVipUser ? 'Choisir une date manuelle' : vipDisabledReason}
                        >
                          {isVipManualOpen ? 'Masquer le choix manuel' : 'Choisir ma date - VIP'}
                        </button>
                      </div>
                      {isVipUser && isVipManualOpen ? (
                        <div className="my-shipping-vip-controls">
                          <input
                            type="date"
                            className="my-shipping-date-input"
                            value={manualDateInput}
                            min={shippingPlan.minDate || localShippingDateBounds.minIso || undefined}
                            max={shippingPlan.maxDate || localShippingDateBounds.maxIso || undefined}
                            onChange={(event) => setManualDateInput(event.target.value)}
                            disabled={isManualDateLoading || shippingPlan.status === 'loading'}
                          />
                          <button
                            type="button"
                            className="my-betail-btn my-shipping-vip-btn"
                            onClick={handleManualDatePick}
                            disabled={!manualDateInput || isManualDateLoading || shippingPlan.status === 'loading'}
                          >
                            {isManualDateLoading ? 'Vérification...' : 'Valider ma date'}
                          </button>
                        </div>
                      ) : null}
                      {isVipUser && isVipManualOpen && showBlockedDays ? (
                        <div className="my-shipping-blocked-days" aria-label="Jours interdits">
                          <span>Jours interdits:</span>
                          <strong>{SHIPPING_BLOCKED_MM_DD.join(' • ')}</strong>
                        </div>
                      ) : null}
                      <p className="my-shipping-vip-hint">
                        {isVipUser
                          ? 'Un 2e bétail peut partager la même journée qu’un autre.'
                          : 'Ton rôle actuel utilise uniquement l’attribution automatique.'}
                      </p>
                    </div>

                    <div
                      className={`my-shipping-slider-wrap ${isSlotSliderReady ? 'is-ready' : ''} ${
                        isSlotSliderDisabled ? 'is-disabled' : ''
                      }`}
                    >
                      <p className="my-shipping-slider-label">
                        <span>Glisse pour valider ce créneau</span>
                        <span className="my-shipping-slider-chevrons" aria-hidden="true">
                          {'>>>'}
                        </span>
                      </p>
                      <div className="my-shipping-slider-rail">
                        <input
                          type="range"
                          min="0"
                          max="100"
                          step="1"
                          value={slotSliderValue}
                          className="my-shipping-slider"
                          style={{ '--slider-value': slotSliderValue }}
                          onChange={(event) => {
                            const nextValue = Number(event.target.value) || 0
                            setSlotSliderValue(nextValue)
                            if (nextValue >= 96) {
                              handleSlotSliderCommit()
                            }
                          }}
                          onMouseUp={() => {
                            if (slotSliderValue < 96) setSlotSliderValue(0)
                          }}
                          onTouchEnd={() => {
                            if (slotSliderValue < 96) setSlotSliderValue(0)
                          }}
                          disabled={isSlotSliderDisabled}
                        />
                      </div>
                    </div>

                    <div className="my-shipping-constraint-actions">
                      <button type="button" className="my-betail-btn ghost my-shipping-back-btn" onClick={() => setStepIndex(2)}>
                        Retour à l’étude
                      </button>
                    </div>
                  </section>
                ) : null}

                {stepIndex === 5 ? (
                  <section className="my-shipping-stage my-shipping-review-stage">
                    <h3 className="my-shipping-cost-title">Récapitulatif de l'expédition</h3>
                    <div className="my-shipping-review-box">
                      <p className="my-shipping-slot-label">Date retenue</p>
                      <p className="my-shipping-slot-main">{formatFrenchDateShort(selectedShippingDate)}</p>
                      <p className="my-shipping-slot-meta">
                        Bétail: <strong>{shippingLabel}</strong>
                      </p>
                      <p className="my-shipping-slot-meta">
                        Gain estimé: <strong>{formatCost(selectedEstimatedGain)}</strong>
                      </p>
                      {shippingPlan.reassigned ? (
                        <p className="my-shipping-slot-meta is-warn">
                          Ce créneau peut être réajusté au dernier moment si un conflit apparaît.
                        </p>
                      ) : null}
                    </div>

                    <div className="my-shipping-postcard">
                      <div className="my-shipping-postcard-bow" aria-hidden="true" />
                      <p className="my-shipping-postcard-title">Carte postale d’expédition (optionnel)</p>
                      <textarea
                        className="my-shipping-postcard-input"
                        value={shippingNote}
                        maxLength={220}
                        onChange={(event) => setShippingNote(event.target.value)}
                        placeholder="Ecris un message pour accompagner l’expédition..."
                      />
                      <p className="my-shipping-postcard-count">{shippingNote.length}/220</p>
                    </div>

                    <div className="my-shipping-final-warning">
                      <p className="my-shipping-warning-kicker">Rappel important</p>
                      <p className="my-shipping-warning-text">
                        Valider maintenant enregistrera la date d’expédition dans le registre officiel.
                      </p>
                      <p className="my-shipping-warning-subtext">
                        L’action reste définitive pour ce bétail après l’expédition.
                      </p>
                    </div>

                    {confirmState.status === 'error' ? (
                      <p className="my-shipping-growth-hint is-error">{confirmState.message}</p>
                    ) : null}

                    <div className="my-shipping-constraint-actions">
                      <button type="button" className="my-betail-btn my-shipping-final-btn" onClick={() => setStepIndex(6)}>
                        Passer à la validation finale
                      </button>
                      <button type="button" className="my-betail-btn ghost my-shipping-back-btn my-shipping-edit-btn" onClick={() => setStepIndex(4)}>
                        Modifier le créneau
                      </button>
                    </div>
                  </section>
                ) : null}

                {stepIndex === 6 ? (
                  <section className="my-shipping-stage my-shipping-destruct-stage">
                    <h3 className="my-shipping-cost-title">Validation finale</h3>
                    <p className="my-shipping-stage-caption">
                      Déclenche la séquence d'expedition en cliquant sur le bouton ci-dessous.
                    </p>

                    {confirmState.status === 'error' ? (
                      <p className="my-shipping-growth-hint is-error">{confirmState.message}</p>
                    ) : null}

                    <div className="my-shipping-destruct-wrap">
                      <button
                        type="button"
                        className="button"
                        onClick={handleConfirmShippingSlot}
                        onMouseEnter={playFinalHover}
                        onFocus={playFinalHover}
                        disabled={isShippingPending || confirmState.status === 'loading'}
                      >
                        <div className="lid">
                          <span className="side top" />
                          <span className="side front" />
                          <span className="side back" />
                          <span className="side left" />
                          <span className="side right" />
                        </div>
                        <div className="panels">
                          <div className="panel-1">
                            <div className="panel-2">
                              <div className="btn-trigger">
                                <span className="btn-trigger-1" />
                                <span className="btn-trigger-2" />
                              </div>
                            </div>
                          </div>
                        </div>
                      </button>
                    </div>

                    <div className="my-shipping-constraint-actions">
                      <button type="button" className="my-betail-btn ghost my-shipping-back-btn" onClick={() => setStepIndex(5)}>
                        Retour au récapitulatif
                      </button>
                    </div>
                  </section>
                ) : null}

                {stepIndex === 7 ? (
                  <section className="my-shipping-stage my-shipping-success-stage">
                    <h3 className="my-shipping-cost-title">Expédition programmée</h3>
                    <p className="my-shipping-warning-text">
                      {confirmState.message || 'Le créneau a été confirmé.'}
                    </p>
                    <p className="my-shipping-warning-subtext">
                      Date enregistrée: <strong>{formatFrenchDateShort(selectedShippingDate)}</strong>
                    </p>
                    <p className="my-shipping-warning-subtext">
                      Gain enregistré: <strong>{formatCost(selectedEstimatedGain)}</strong>
                    </p>
                    {shippingNote.trim() ? (
                      <div className="my-shipping-review-box">
                        <p className="my-shipping-slot-label">Message joint</p>
                        <p className="my-shipping-slot-meta">{shippingNote}</p>
                      </div>
                    ) : null}
                    <div className="my-shipping-constraint-actions">
                      <button type="button" className="my-betail-btn my-shipping-next-btn" onClick={onClose}>
                        Fermer
                      </button>
                    </div>
                  </section>
                ) : null}
              </div>

              {successModal.open ? (
                <div className="my-shipping-success-modal" role="dialog" aria-modal="true" aria-label="Confirmation expédition">
                  <div className="my-shipping-success-modal-card">
                    <p className="my-shipping-success-modal-kicker">Expédition confirmée</p>
                    <h4 className="my-shipping-success-modal-title">{shippingLabel}</h4>
                    <p className="my-shipping-success-modal-line">
                      Date validée: <strong>{formatFrenchDateShort(successModal.selectedDate || selectedShippingDate)}</strong>
                    </p>
                    <p className="my-shipping-success-modal-line">
                      Gain estimé: <strong>{formatCost(selectedEstimatedGain)}</strong>
                    </p>
                    <p className="my-shipping-success-modal-line">{successModal.message || confirmState.message}</p>
                    {shippingNote.trim() ? (
                      <p className="my-shipping-success-modal-note">Message: {shippingNote}</p>
                    ) : null}
                    <p className="my-shipping-success-modal-timer">Fermeture automatique dans 4 secondes.</p>
                    <div className="my-shipping-success-modal-actions">
                      <button type="button" className="my-betail-btn" onClick={goToGceFromModal}>
                        Aller au GCE
                      </button>
                      <button type="button" className="my-betail-btn ghost" onClick={closeSuccessModal}>
                        Fermer
                      </button>
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
          </>
        ) : (
          <div className="my-betail-empty-panel" />
        )}
      </section>
    </aside>
  )
}

export default MyBetailsShippingPanel
