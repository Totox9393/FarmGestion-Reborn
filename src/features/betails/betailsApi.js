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

const normalizeMyBetail = (item) => ({
  ...item,
  pinned: Boolean(item?.pinned),
  archived: Boolean(item?.archived),
})

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
  const hasMore = items.length === MY_BETAILS_PAGE_SIZE
  return {
    items,
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
