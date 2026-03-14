import { useMemo } from 'react'
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  fetchAuthorsByIds,
  fetchBetailsPage,
  fetchBetailDetails,
  BETAILS_QUERY_KEY,
  purchaseBetail,
  fetchMyBetailsPage,
  previewBetailPremiumUpgrade,
  upgradeBetailToPremium,
  previewBetailAgeGrowth,
  growBetailAge,
  previewBetailShippingSchedule,
  confirmBetailShippingSchedule,
  updateBetailComment,
  toggleBetailPremium,
  toggleBetailPinned,
  toggleBetailArchived,
} from './betailsApi'
import { supabase } from '../authentification/supabaseClient'

const AUTHOR_MAP_STALE = 1000 * 60 * 5
const BETAIL_DETAILS_STALE = 1000 * 60 * 10
const USER_PROFILE_STALE = 1000 * 60 * 2

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

export function useUserFarmId(userId) {
  return useQuery({
    queryKey: ['user-profile', userId],
    queryFn: async () => {
      if (!userId) return null
      const { data, error } = await supabase
        .from('users_profiles')
        .select('farm_id')
        .eq('id', userId)
        .maybeSingle()
      if (error) {
        throw error
      }
      return data?.farm_id ?? null
    },
    enabled: Boolean(userId),
    staleTime: USER_PROFILE_STALE,
  })
}

export function useUserRole(userId) {
  return useQuery({
    queryKey: ['user-role', userId],
    queryFn: async () => {
      if (!userId) return ''
      const { data, error } = await supabase
        .from('users_profiles')
        .select('role, role_ingame')
        .eq('id', userId)
        .maybeSingle()
      if (error) {
        throw error
      }
      const role = String(data?.role || '').trim()
      const roleIngame = String(data?.role_ingame || '').trim()
      return [role, roleIngame].filter(Boolean).join(' ')
    },
    enabled: Boolean(userId),
    staleTime: USER_PROFILE_STALE,
  })
}

export function usePurchaseBetail() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ betailId }) => purchaseBetail({ betailId }),
    onMutate: async ({ betailId }) => {
      await queryClient.cancelQueries({ queryKey: ['betails'] })
      const previous = queryClient.getQueryData(['betails'])

      queryClient.setQueriesData({ queryKey: ['betails'] }, (oldData) => {
        if (!oldData?.pages) return oldData
        const nextPages = oldData.pages.map((page) => ({
          ...page,
          items: page.items.filter((item) => item.id !== betailId),
        }))
        return { ...oldData, pages: nextPages }
      })

      return { previous }
    },
    onError: (_error, _variables, context) => {
      if (context?.previous) {
        queryClient.setQueryData(['betails'], context.previous)
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['betails'] })
    },
  })
}

export function useMyBetailsList({ userId, farmId = null, search = '', sort = 'recent', filter = 'all' }) {
  const trimmedSearch = search?.trim?.() ?? ''

  return useInfiniteQuery({
    queryKey: BETAILS_QUERY_KEY.myList({ userId, search: trimmedSearch, sort, filter, farmId }),
    queryFn: ({ pageParam }) =>
      fetchMyBetailsPage({
        userId,
        farmId,
        search: trimmedSearch,
        sort,
        filter,
        page: pageParam,
      }),
    initialPageParam: 0,
    getNextPageParam: (lastPage) => lastPage.nextPage,
    enabled: Boolean(userId),
    keepPreviousData: true,
  })
}

const updateCachedMyBetailInPages = (oldData, betailId, patch) => {
  if (!oldData?.pages) return oldData
  return {
    ...oldData,
    pages: oldData.pages.map((page) => ({
      ...page,
      items: page.items.map((item) =>
        item.id === betailId
          ? {
              ...item,
              ...patch,
            }
          : item,
      ),
    })),
  }
}

export function useUpdateBetailComment() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ betailId, comment, userId }) => updateBetailComment({ betailId, comment, userId }),
    onSuccess: (_data, variables) => {
      queryClient.setQueriesData({ queryKey: ['betails', 'my-list', variables.userId] }, (oldData) =>
        updateCachedMyBetailInPages(oldData, variables.betailId, { comments: variables.comment ?? '' }),
      )
      queryClient.invalidateQueries({ queryKey: ['betails', 'detail', variables.betailId] })
    },
  })
}

export function useUpgradeBetailPremium() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ betailId }) => upgradeBetailToPremium({ betailId }),
    onSuccess: (data, variables) => {
      queryClient.setQueriesData({ queryKey: ['betails', 'my-list'] }, (oldData) =>
        updateCachedMyBetailInPages(oldData, variables.betailId, { premium: true }),
      )

      queryClient.invalidateQueries({ queryKey: ['betails', 'detail', variables.betailId] })
      queryClient.invalidateQueries({ queryKey: ['user-profile'] })

      return data
    },
  })
}

export function usePreviewBetailPremiumUpgrade() {
  return useMutation({
    mutationFn: ({ betailId }) => previewBetailPremiumUpgrade({ betailId }),
  })
}

export function usePreviewBetailAgeGrowth() {
  return useMutation({
    mutationFn: ({ betailId }) => previewBetailAgeGrowth({ betailId }),
  })
}

export function useGrowBetailAge() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ betailId }) => growBetailAge({ betailId, dryRun: false }),
    onSuccess: (data, variables) => {
      const newAge = Number(data?.new_age)
      if (Number.isFinite(newAge)) {
        queryClient.setQueriesData({ queryKey: ['betails', 'my-list'] }, (oldData) =>
          updateCachedMyBetailInPages(oldData, variables.betailId, { age: newAge }),
        )
      }

      queryClient.invalidateQueries({ queryKey: ['betails', 'detail', variables.betailId] })
      queryClient.invalidateQueries({ queryKey: ['user-profile'] })
    },
  })
}

export function usePreviewBetailShippingSchedule() {
  return useMutation({
    mutationFn: ({
      betailId,
      requestedDate = null,
      manualChoice = false,
      note = null,
      estimatedGain = null,
      minDaysAhead = 7,
      maxDaysAhead = 60,
      allowReassign = false,
    }) =>
      previewBetailShippingSchedule({
        betailId,
        requestedDate,
        manualChoice,
        note,
        estimatedGain,
        minDaysAhead,
        maxDaysAhead,
        allowReassign,
      }),
  })
}

export function useConfirmBetailShippingSchedule() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({
      betailId,
      requestedDate = null,
      manualChoice = false,
      note = null,
      estimatedGain = null,
      minDaysAhead = 7,
      maxDaysAhead = 60,
      allowReassign = true,
    }) =>
      confirmBetailShippingSchedule({
        betailId,
        requestedDate,
        manualChoice,
        note,
        estimatedGain,
        minDaysAhead,
        maxDaysAhead,
        allowReassign,
      }),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['shipping'] })
      queryClient.invalidateQueries({ queryKey: ['shipping', 'gce-calendar'] })
      queryClient.invalidateQueries({ queryKey: ['betails', 'my-list'] })
      queryClient.invalidateQueries({ queryKey: ['betails', 'detail', variables.betailId] })
    },
  })
}

const createToggleMutation = (mutationFn, fieldName) => {
  return function useToggleMutation() {
    const queryClient = useQueryClient()

    return useMutation({
      mutationFn,
      onSuccess: (_data, variables) => {
        queryClient.setQueriesData({ queryKey: ['betails', 'my-list', variables.userId] }, (oldData) =>
          updateCachedMyBetailInPages(oldData, variables.betailId, { [fieldName]: variables.nextValue }),
        )
        if (variables?.userId) {
          queryClient.invalidateQueries({ queryKey: ['betails', 'my-list', variables.userId] })
        } else {
          queryClient.invalidateQueries({ queryKey: ['betails', 'my-list'] })
        }
      },
    })
  }
}

export const useToggleBetailPremium = createToggleMutation(toggleBetailPremium, 'premium')
export const useToggleBetailPinned = createToggleMutation(toggleBetailPinned, 'pinned')
export const useToggleBetailArchived = createToggleMutation(toggleBetailArchived, 'archived')

export function useUpdateBetailBadges() {
  return useMutation({
    mutationFn: async () => ({ ok: true }),
  })
}
