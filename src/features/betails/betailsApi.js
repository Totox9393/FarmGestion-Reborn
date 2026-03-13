import { supabase } from '../authentification/supabaseClient'

export const BETAILS_PAGE_SIZE = 24
export const MY_BETAILS_PAGE_SIZE = 24

const PUBLIC_BETAIL_FIELDS = [
  'id',
  'name',
  'matricule',
  'avatar_url',
  'age',
  'author_id',
  'created_at',
  'like_count',
]

const BETAILS_DETAIL_FIELDS = [
  'id',
  'comments',
  'created_at',
  'purchased_at',
  'author_id',
  'equipped_badges',
]

const BETAILS_DETAIL_FIELDS_FALLBACK = [
  'id',
  'comments',
  'created_at',
  'purchased_at',
  'author_id',
]

const MY_BETAILS_FIELDS_BASE = [
  'id',
  'name',
  'matricule',
  'avatar_url',
  'age',
  'author_id',
  'created_at',
  'purchased_at',
  'like_count',
  'premium',
  'comments',
  'owner_id',
  'farm_id',
  'pinned',
  'archived',
]

const MY_BETAILS_FIELDS_MINIMAL = [
  'id',
  'name',
  'matricule',
  'avatar_url',
  'age',
  'author_id',
  'created_at',
  'purchased_at',
  'like_count',
  'premium',
  'comments',
  'owner_id',
  'farm_id',
]

const normalizeMyBetail = (item) => {
  const shippingStatus = String(item?.shipping_status || '').toLowerCase()
  const shippingEstimatedGain = Number(item?.shipping_estimated_gain)
  return {
    ...item,
    pinned: Boolean(item?.pinned),
    archived: Boolean(item?.archived),
    shipping_status: item?.shipping_status || null,
    shipping_scheduled_for: item?.shipping_scheduled_for || null,
    shipping_estimated_gain: Number.isFinite(shippingEstimatedGain) ? shippingEstimatedGain : null,
    is_shipping_scheduled: shippingStatus === 'scheduled' || Boolean(item?.is_shipping_scheduled),
  }
}

const attachShippingScheduleFlags = async (items) => {
  if (!Array.isArray(items) || !items.length) return []

  const betailIds = items
    .map((item) => item?.id)
    .filter((id) => typeof id === 'string' && id.length)

  if (!betailIds.length) {
    return items.map(normalizeMyBetail)
  }

  try {
    let { data, error } = await supabase
      .from('shipping')
      .select('betail_id, status, scheduled_for, estimated_gain')
      .in('betail_id', betailIds)

    if (error && isMissingColumnError(error)) {
      const fallback = await supabase
        .from('shipping')
        .select('betail_id, status, scheduled_for')
        .in('betail_id', betailIds)
      data = fallback.data
      error = fallback.error
    }

    if (error) {
      throw error
    }

    const shippingByBetailId = new Map()
    ;(data ?? []).forEach((entry) => {
      const betailId = entry?.betail_id
      if (!betailId) return

      const status = String(entry?.status || '').toLowerCase()
      const previous = shippingByBetailId.get(betailId)
      const previousStatus = String(previous?.status || '').toLowerCase()

      if (status === 'scheduled' || previousStatus !== 'scheduled') {
        shippingByBetailId.set(betailId, entry)
      }
    })

    return items.map((item) => {
      const shippingEntry = shippingByBetailId.get(item.id)
      const shippingStatus = String(shippingEntry?.status || '').toLowerCase()
      return normalizeMyBetail({
        ...item,
        shipping_status: shippingEntry?.status || null,
        shipping_scheduled_for: shippingEntry?.scheduled_for || null,
        shipping_estimated_gain: shippingEntry?.estimated_gain ?? null,
        is_shipping_scheduled: shippingStatus === 'scheduled',
      })
    })
  } catch {
    return items.map(normalizeMyBetail)
  }
}

const isMissingColumnError = (error) => {
  const code = error?.code || ''
  const message = (error?.message || '').toLowerCase()
  return code === '42703' || message.includes('column') || message.includes('could not find')
}

const buildBaseQuery = ({ search, sort }) => {
  let query = supabase
    .from('betails')
    .select(PUBLIC_BETAIL_FIELDS.join(', '))
    .is('farm_id', null)
    .is('owner_id', null)
    .limit(BETAILS_PAGE_SIZE)

  if (search?.length >= 2) {
    query = query.or(`name.ilike.%${search}%,matricule.ilike.%${search}%`)
  }

  if (sort === 'popular') {
    query = query
      .order('like_count', { ascending: false })
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
  } else {
    query = query
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
  }

  return query
}

export const purchaseBetail = async ({ betailId }) => {
  if (!betailId) {
    throw new Error('Betail id manquant')
  }

  const { data, error } = await supabase.rpc('purchase_betail_reborn', {
    p_betail_id: betailId,
  })

  if (error) {
    throw error
  }

  return data
}

const applyCursor = ({ query, cursor, sort }) => {
  if (!cursor) return query

  const { created_at, id, like_count } = cursor

  if (sort === 'popular') {
    const filter = `like_count.lt.${like_count},and(like_count.eq.${like_count},created_at.lt.${created_at}),and(like_count.eq.${like_count},created_at.eq.${created_at},id.lt.${id})`
    return query.or(filter)
  }

  const filter = `created_at.lt.${created_at},and(created_at.eq.${created_at},id.lt.${id})`
  return query.or(filter)
}

export const BETAILS_QUERY_KEY = {
  list: ({ search = '', sort = 'recent' } = {}) => ['betails', 'list', sort, search],
  details: (id) => ['betails', 'detail', id],
  myList: ({ userId = '', search = '', sort = 'recent', filter = 'all', farmId = null } = {}) => [
    'betails',
    'my-list',
    userId,
    sort,
    filter,
    search,
    farmId || 'no-farm',
  ],
}

const applyMyBetailsSort = (query, sort, options = {}) => {
  const {
    supportsPurchasedAt = true,
    supportsPinned = true,
  } = options

  const applyRecentOrder = (baseQuery) => {
    if (supportsPurchasedAt) {
      return baseQuery
        .order('purchased_at', { ascending: false, nullsFirst: false })
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
    }

    return baseQuery
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
  }

  if (sort === 'popular') {
    const base = query
      .order('like_count', { ascending: false, nullsFirst: false })
    return applyRecentOrder(base)
  }

  if (sort === 'premium') {
    const base = query
      .order('premium', { ascending: false })
    return applyRecentOrder(base)
  }

  if (sort === 'pinned') {
    if (supportsPinned) {
      const base = query.order('pinned', { ascending: false })
      return applyRecentOrder(base)
    }

    return applyRecentOrder(query)
  }

  return applyRecentOrder(query)
}

const applyMyBetailsFilter = (query, filter, options = {}) => {
  const { supportsFlags = true } = options
  if (!supportsFlags && (filter === 'pinned' || filter === 'archived')) return query
  if (filter === 'premium') return query.eq('premium', true)
  if (filter === 'pinned') return query.eq('pinned', true)
  if (filter === 'archived') return query.eq('archived', true)
  return query
}

const buildMyBetailsQuery = ({
  userId,
  search,
  sort,
  filter,
  farmId,
  supportsFlags,
  supportsPurchasedAt,
  selectFields,
}) => {
  const fields = selectFields || MY_BETAILS_FIELDS_BASE
  let query = supabase
    .from('betails')
    .select(fields.join(', '))
    .eq('owner_id', userId)

  if (farmId) {
    query = query.eq('farm_id', farmId)
  }

  if (search?.length >= 2) {
    query = query.or(`name.ilike.%${search}%,matricule.ilike.%${search}%`)
  }

  query = applyMyBetailsFilter(query, filter, { supportsFlags })
  query = applyMyBetailsSort(query, sort, {
    supportsPurchasedAt,
    supportsPinned: supportsFlags,
  })

  return query
}

export const fetchMyBetailsPage = async ({
  userId,
  farmId = null,
  search = '',
  sort = 'recent',
  filter = 'all',
  page = 0,
}) => {
  if (!userId) {
    return { items: [], nextPage: undefined }
  }

  const trimmedSearch = search?.trim?.() ?? ''
  const start = page * MY_BETAILS_PAGE_SIZE
  const end = start + MY_BETAILS_PAGE_SIZE - 1

  let query = buildMyBetailsQuery({
    userId,
    farmId,
    search: trimmedSearch,
    sort,
    filter,
    supportsFlags: true,
    supportsPurchasedAt: true,
    selectFields: MY_BETAILS_FIELDS_BASE,
  }).range(start, end)

  let { data, error } = await query

  if (error && isMissingColumnError(error)) {
    query = buildMyBetailsQuery({
      userId,
      farmId,
      search: trimmedSearch,
      sort,
      filter,
      supportsFlags: false,
      supportsPurchasedAt: false,
      selectFields: MY_BETAILS_FIELDS_MINIMAL,
    }).range(start, end)

    const fallbackResult = await query
    data = fallbackResult.data
    error = fallbackResult.error
  }

  if (error) {
    throw error
  }

  const items = (data ?? []).map(normalizeMyBetail)
  const itemsWithShipping = await attachShippingScheduleFlags(items)
  const hasMore = items.length === MY_BETAILS_PAGE_SIZE
  return {
    items: itemsWithShipping,
    nextPage: hasMore ? page + 1 : undefined,
  }
}

export const updateBetailComment = async ({ betailId, comment, userId }) => {
  if (!betailId || !userId) {
    throw new Error('Informations manquantes')
  }

  const { data, error } = await supabase
    .from('betails')
    .update({ comments: comment ?? '' })
    .eq('id', betailId)
    .eq('owner_id', userId)
    .select('id, comments')
    .maybeSingle()

  if (error) throw error
  if (!data) throw new Error('Bétail introuvable')
  return data
}

export const upgradeBetailToPremium = async ({ betailId }) => {
  if (!betailId) {
    throw new Error('Betail id manquant')
  }

  const { data, error } = await supabase.rpc('upgrade_to_premium_reborn', {
    p_betail_id: betailId,
    p_dry_run: false,
  })

  if (error) {
    throw error
  }

  if (!data || typeof data !== 'object') {
    throw new Error('Réponse premium invalide')
  }

  return data
}

export const previewBetailPremiumUpgrade = async ({ betailId }) => {
  if (!betailId) {
    throw new Error('Betail id manquant')
  }

  const { data, error } = await supabase.rpc('upgrade_to_premium_reborn', {
    p_betail_id: betailId,
    p_dry_run: true,
  })

  if (error) {
    throw error
  }

  if (!data || typeof data !== 'object') {
    throw new Error('Réponse preview premium invalide')
  }

  return data
}

export const growBetailAge = async ({ betailId, dryRun = false }) => {
  if (!betailId) {
    throw new Error('Betail id manquant')
  }

  const { data, error } = await supabase.rpc('grow_betail_age_reborn', {
    p_betail_id: betailId,
    p_dry_run: Boolean(dryRun),
  })

  if (error) {
    throw error
  }

  if (!data || typeof data !== 'object') {
    throw new Error('Réponse croissance invalide')
  }

  return data
}

export const previewBetailAgeGrowth = async ({ betailId }) => growBetailAge({ betailId, dryRun: true })

export const scheduleBetailShipping = async ({
  betailId,
  requestedDate = null,
  manualChoice = false,
  note = null,
  estimatedGain = null,
  dryRun = true,
  minDaysAhead = 7,
  maxDaysAhead = 60,
  allowReassign = false,
}) => {
  if (!betailId) {
    throw new Error('Betail id manquant')
  }

  const normalizedRequestedDate = typeof requestedDate === 'string' && requestedDate.trim().length
    ? requestedDate.trim()
    : null
  const normalizedNote = typeof note === 'string' && note.trim().length ? note.trim() : null
  const normalizedEstimatedGain = Number.isFinite(Number(estimatedGain))
    ? Math.max(0, Math.round(Number(estimatedGain)))
    : null

  const { data, error } = await supabase.rpc('schedule_shipping_reborn', {
    p_betail_id: betailId,
    p_requested_date: normalizedRequestedDate,
    p_manual_choice: Boolean(manualChoice),
    p_notes: normalizedNote,
    p_estimated_gain: normalizedEstimatedGain,
    p_dry_run: Boolean(dryRun),
    p_min_days_ahead: Number(minDaysAhead) || 7,
    p_max_days_ahead: Number(maxDaysAhead) || 60,
    p_allow_reassign: Boolean(allowReassign),
  })

  if (error) {
    throw error
  }

  if (!data || typeof data !== 'object') {
    throw new Error('Réponse planification expédition invalide')
  }

  return data
}

export const previewBetailShippingSchedule = async ({
  betailId,
  requestedDate = null,
  manualChoice = false,
  note = null,
  estimatedGain = null,
  minDaysAhead = 7,
  maxDaysAhead = 60,
  allowReassign = false,
}) =>
  scheduleBetailShipping({
    betailId,
    requestedDate,
    manualChoice,
    note,
    estimatedGain,
    dryRun: true,
    minDaysAhead,
    maxDaysAhead,
    allowReassign,
  })

export const confirmBetailShippingSchedule = async ({
  betailId,
  requestedDate = null,
  manualChoice = false,
  note = null,
  estimatedGain = null,
  minDaysAhead = 7,
  maxDaysAhead = 60,
  allowReassign = true,
}) =>
  scheduleBetailShipping({
    betailId,
    requestedDate,
    manualChoice,
    note,
    estimatedGain,
    dryRun: false,
    minDaysAhead,
    maxDaysAhead,
    allowReassign,
  })

const updateBetailFlag = async ({ betailId, userId, field, value }) => {
  if (!betailId || !userId) {
    throw new Error('Informations manquantes')
  }

  const { data, error } = await supabase
    .from('betails')
    .update({ [field]: value })
    .eq('id', betailId)
    .eq('owner_id', userId)
    .select(`id, ${field}`)
    .maybeSingle()

  if (error) throw error
  if (!data) throw new Error('Bétail introuvable')
  return data
}

export const toggleBetailPremium = async ({ betailId, userId, nextValue }) =>
  updateBetailFlag({ betailId, userId, field: 'premium', value: nextValue })

export const toggleBetailPinned = async ({ betailId, userId, nextValue }) =>
  updateBetailFlag({ betailId, userId, field: 'pinned', value: nextValue })

export const toggleBetailArchived = async ({ betailId, userId, nextValue }) =>
  updateBetailFlag({ betailId, userId, field: 'archived', value: nextValue })

export const fetchBetailsPage = async ({ search = '', sort = 'recent', cursor }) => {
  const trimmedSearch = search?.trim?.() ?? ''
  let query = buildBaseQuery({ search: trimmedSearch, sort })
  query = applyCursor({ query, cursor, sort })

  const { data, error } = await query
  if (error) {
    throw error
  }

  const items = data ?? []
  const hasMore = items.length === BETAILS_PAGE_SIZE
  return {
    items,
    nextCursor: hasMore ? items[items.length - 1] : undefined,
  }
}

export const fetchAuthorsByIds = async (ids) => {
  if (!ids.length) {
    return []
  }

  const { data, error } = await supabase
    .from('users_profiles')
    .select('id, username')
    .in('id', ids)

  if (error) {
    throw error
  }

  return data ?? []
}

export const fetchBetailDetails = async (id) => {
  if (!id) {
    throw new Error('Betail id manquant')
  }

  let { data, error } = await supabase
    .from('betails')
    .select(BETAILS_DETAIL_FIELDS.join(', '))
    .eq('id', id)
    .maybeSingle()

  if (error && isMissingColumnError(error)) {
    const fallbackResult = await supabase
      .from('betails')
      .select(BETAILS_DETAIL_FIELDS_FALLBACK.join(', '))
      .eq('id', id)
      .maybeSingle()
    data = fallbackResult.data
    error = fallbackResult.error
  }

  if (error) {
    throw error
  }

  return data
}
