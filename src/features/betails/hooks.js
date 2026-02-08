import { useMemo } from 'react'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import {
  fetchAuthorsByIds,
  fetchBetailsPage,
  fetchBetailDetails,
  BETAILS_QUERY_KEY,
} from './betailsApi'

const AUTHOR_MAP_STALE = 1000 * 60 * 5
const BETAIL_DETAILS_STALE = 1000 * 60 * 10

export function useBetailsList({ search = '', sort = 'recent' }) {
  const trimmedSearch = search?.trim?.() ?? ''

  return useInfiniteQuery({
    queryKey: BETAILS_QUERY_KEY.list({ search: trimmedSearch, sort }),
    queryFn: ({ pageParam }) => fetchBetailsPage({ search: trimmedSearch, sort, cursor: pageParam }),
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    keepPreviousData: true,
  })
}

export function useAuthorsMap(authorIds = []) {
  const uniqueSortedIds = useMemo(() => {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    const filtered = (authorIds || [])
      .filter((id) => typeof id === 'string' && uuidRegex.test(id))
    if (!filtered.length) return []
    return Array.from(new Set(filtered)).sort()
  }, [authorIds])

  return useQuery({
    queryKey: ['authors', uniqueSortedIds],
    queryFn: () => fetchAuthorsByIds(uniqueSortedIds),
    enabled: uniqueSortedIds.length > 0,
    staleTime: AUTHOR_MAP_STALE,
  })
}

export function useBetailDetails(betailId, enabled = true) {
  return useQuery({
    queryKey: BETAILS_QUERY_KEY.details(betailId),
    queryFn: () => fetchBetailDetails(betailId),
    enabled: Boolean(betailId) && enabled,
    staleTime: BETAIL_DETAILS_STALE,
  })
}
