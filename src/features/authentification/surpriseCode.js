import { supabase } from './supabaseClient'

export const SURPRISE_CODE_STORAGE_KEY = 'farmgestion_surprise_code'
export const SURPRISE_DEVICE_ID_STORAGE_KEY = 'farmgestion_device_id'
export const SURPRISE_CODE_QUERY_PARAMS = ['surprise', 'code', 'promo', 'ref']

export const normalizeSurpriseCode = (value) => String(value || '').trim().replace(/\s+/g, '_').toUpperCase()

export const parseRpcResult = (data) => {
  if (typeof data === 'string') {
    try {
      return JSON.parse(data)
    } catch {
      return null
    }
  }
  return data
}

export const getOrCreateSurpriseDeviceId = () => {
  if (typeof window === 'undefined') return ''
  try {
    const existing = window.localStorage.getItem(SURPRISE_DEVICE_ID_STORAGE_KEY)
    if (existing && existing.trim()) return existing.trim()

    const generated = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`
    window.localStorage.setItem(SURPRISE_DEVICE_ID_STORAGE_KEY, generated)
    return generated
  } catch {
    return ''
  }
}

export const saveSurpriseCode = (value) => {
  if (typeof window === 'undefined') return
  try {
    const normalized = normalizeSurpriseCode(value)
    if (!normalized) {
      window.localStorage.removeItem(SURPRISE_CODE_STORAGE_KEY)
      return
    }
    window.localStorage.setItem(SURPRISE_CODE_STORAGE_KEY, normalized)
  } catch {
    // Ignore local storage issues.
  }
}

export const clearSurpriseCode = () => {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.removeItem(SURPRISE_CODE_STORAGE_KEY)
  } catch {
    // Ignore local storage issues.
  }
}

export const readInitialSurpriseCode = () => {
  if (typeof window === 'undefined') return ''

  try {
    const searchParams = new URLSearchParams(window.location.search || '')
    for (const key of SURPRISE_CODE_QUERY_PARAMS) {
      const value = normalizeSurpriseCode(searchParams.get(key))
      if (value) {
        saveSurpriseCode(value)
        return value
      }
    }

    const storedValue = normalizeSurpriseCode(window.localStorage.getItem(SURPRISE_CODE_STORAGE_KEY))
    return storedValue || ''
  } catch {
    return ''
  }
}

export const buildSurpriseLink = (code) => {
  const normalizedCode = normalizeSurpriseCode(code)
  if (!normalizedCode) return ''
  if (typeof window === 'undefined') return `/?surprise=${encodeURIComponent(normalizedCode)}`
  const url = new URL('/', window.location.origin)
  url.searchParams.set('surprise', normalizedCode)
  return url.toString()
}

const broadcastSurpriseRedemption = async (result) => {
  if (typeof window === 'undefined' || !result?.success) return

  const awardedMoney = Number(result?.awarded_money || 0)
  const awardedBadgeIds = Array.isArray(result?.awarded_badge_ids)
    ? result.awarded_badge_ids.filter(Boolean)
    : [result?.awarded_badge_id].filter(Boolean)

  const {
    data: { user },
  } = await supabase.auth.getUser()

  const safeUserId = String(user?.id || '').trim()

  if (safeUserId && awardedMoney > 0) {
    const { data: profileData } = await supabase
      .from('users_profiles')
      .select('money')
      .eq('id', safeUserId)
      .maybeSingle()

    const currentMoney = Number(profileData?.money)
    if (Number.isFinite(currentMoney)) {
      window.dispatchEvent(
        new CustomEvent('farmgestion-balance-updated', {
          detail: {
            userId: safeUserId,
            money: currentMoney,
          },
        }),
      )
    }
  }

  window.dispatchEvent(
    new CustomEvent('farmgestion-surprise-redeemed', {
      detail: {
        userId: safeUserId || null,
        awardedMoney,
        awardedBadgeIds,
      },
    }),
  )
}

export const redeemSurpriseCode = async ({ code, source = 'unknown' }) => {
  const normalizedCode = normalizeSurpriseCode(code)
  if (!normalizedCode) {
    return { success: false, reason: 'EMPTY_CODE' }
  }

  saveSurpriseCode(normalizedCode)

  const { data, error } = await supabase.rpc('redeem_surprise_code_reborn', {
    p_code: normalizedCode,
    p_device_id: getOrCreateSurpriseDeviceId(),
    p_source: source,
  })

  if (error) {
    return { success: false, error }
  }

  const parsed = parseRpcResult(data)
  if (parsed?.success) {
    clearSurpriseCode()
    await broadcastSurpriseRedemption(parsed)
  }

  return parsed || { success: false, reason: 'INVALID_RPC_RESPONSE' }
}
