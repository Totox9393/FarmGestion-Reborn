import { supabase } from '../authentification/supabaseClient'

export const BETAILS_PAGE_SIZE = 24

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
  'author_id',
]

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
}

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

  const { data, error } = await supabase
    .from('betails')
    .select(BETAILS_DETAIL_FIELDS.join(', '))
    .eq('id', id)
    .maybeSingle()

  if (error) {
    throw error
  }

  return data
}
