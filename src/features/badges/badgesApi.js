import { supabase } from '../authentification/supabaseClient'
import { normalizeBadgeCatalogRow, normalizeBadgeFromRelation, sortBadgesByRarityThenName } from './badgeUtils'

const CATALOG_SELECT = 'id,filename,name,rarity,price,stock_total,sold_count,is_active'
const CATALOG_SELECT_WITH_SHOP_VISIBILITY = `${CATALOG_SELECT},is_shop_visible`
const CATALOG_REL_SELECT = 'badges_catalog_reborn!badges_inventory_reborn_badge_id_fkey(id,filename,name,rarity,price,stock_total,sold_count,is_active)'
const EQUIP_CATALOG_REL_SELECT = 'badges_catalog_reborn!badges_equips_reborn_badge_id_fkey(id,filename,name,rarity,price,stock_total,sold_count,is_active)'

const parseRpcResult = (data) => {
  if (typeof data === 'string') {
    try {
      return JSON.parse(data)
    } catch {
      return null
    }
  }
  return data
}

export const fetchBadgesCatalogReborn = async () => {
  const { data, error } = await supabase
    .from('badges_catalog_reborn')
    .select(CATALOG_SELECT_WITH_SHOP_VISIBILITY)
    .eq('is_active', true)

  if (error) {
    const message = String(error?.message || '').toLowerCase()
    const isMissingColumn = message.includes('is_shop_visible') || error?.code === '42703'

    if (!isMissingColumn) throw error

    const { data: fallbackData, error: fallbackError } = await supabase
      .from('badges_catalog_reborn')
      .select(CATALOG_SELECT)
      .eq('is_active', true)

    if (fallbackError) throw fallbackError

    return sortBadgesByRarityThenName(
      (fallbackData || [])
        .map((row) => normalizeBadgeCatalogRow(row))
        .filter(Boolean),
    )
  }

  return sortBadgesByRarityThenName(
    (data || [])
      .map((row) => normalizeBadgeCatalogRow(row))
      .filter(Boolean),
  )
}

export const fetchUserBadgesInventoryReborn = async (userId) => {
  if (!userId) return []

  const { data, error } = await supabase
    .from('badges_inventory_reborn')
    .select(`id,user_id,badge_id,purchase_price,purchased_at,${CATALOG_REL_SELECT}`)
    .eq('user_id', userId)

  if (error) throw error

  return sortBadgesByRarityThenName(
    (data || [])
      .map((row) => normalizeBadgeFromRelation(row))
      .filter(Boolean),
  )
}

export const fetchUserBadgesEquipsReborn = async (userId) => {
  if (!userId) return []

  const { data, error } = await supabase
    .from('badges_equips_reborn')
    .select(`id,user_id,badge_id,farm_id,betail_id,slot,equipped_at,${EQUIP_CATALOG_REL_SELECT}`)
    .eq('user_id', userId)

  if (error) throw error

  return (data || [])
    .map((row) => normalizeBadgeFromRelation(row))
    .filter(Boolean)
}

export const fetchFarmBadgesEquipsReborn = async (farmId) => {
  if (!farmId) return []

  const { data, error } = await supabase
    .from('badges_equips_reborn')
    .select(`id,user_id,badge_id,farm_id,betail_id,slot,equipped_at,${EQUIP_CATALOG_REL_SELECT}`)
    .eq('farm_id', farmId)
    .order('slot', { ascending: true })

  if (error) throw error

  return (data || [])
    .map((row) => normalizeBadgeFromRelation(row))
    .filter(Boolean)
}

export const fetchBetailBadgesEquipsReborn = async (betailId) => {
  if (!betailId) return []

  const { data, error } = await supabase
    .from('badges_equips_reborn')
    .select(`id,user_id,badge_id,farm_id,betail_id,slot,equipped_at,${EQUIP_CATALOG_REL_SELECT}`)
    .eq('betail_id', betailId)
    .order('slot', { ascending: true })

  if (error) throw error

  return (data || [])
    .map((row) => normalizeBadgeFromRelation(row))
    .filter(Boolean)
}

export const fetchUserProfileBadgesReborn = async (userId) => {
  if (!userId) return []

  const { data, error } = await supabase
    .from('user_badges_profile_reborn')
    .select('user_id,badge_id,filename,name,rarity,price,purchased_at')
    .eq('user_id', userId)

  if (error) throw error

  return sortBadgesByRarityThenName(
    (data || [])
      .map((row) => {
        const normalized = normalizeBadgeCatalogRow({
          id: row.badge_id,
          filename: row.filename,
          name: row.name,
          rarity: row.rarity,
          price: row.price,
          stock_total: 0,
          sold_count: 0,
          is_active: true,
        })
        if (!normalized) return null
        return {
          ...normalized,
          userId: row.user_id,
          purchasedAt: row.purchased_at || null,
        }
      })
      .filter(Boolean),
  )
}

export const buyBadgeReborn = async ({ badgeId }) => {
  const { data, error } = await supabase.rpc('buy_badge_reborn', {
    p_badge_id: badgeId,
  })

  if (error) throw error
  return parseRpcResult(data)
}

export const equipBetailBadgeReborn = async ({ badgeId, betailId, slot = null }) => {
  const { data, error } = await supabase.rpc('equip_betail_badge_reborn', {
    p_badge_id: badgeId,
    p_betail_id: betailId,
    p_slot: slot,
  })

  if (error) throw error
  return parseRpcResult(data)
}

export const unequipBetailBadgeReborn = async ({ badgeId, betailId }) => {
  const { data, error } = await supabase.rpc('unequip_betail_badge_reborn', {
    p_badge_id: badgeId,
    p_betail_id: betailId,
  })

  if (error) throw error
  return parseRpcResult(data)
}

export const equipFarmBadgeReborn = async ({ badgeId, slot = null }) => {
  const { data, error } = await supabase.rpc('equip_farm_badge_reborn', {
    p_badge_id: badgeId,
    p_slot: slot,
  })

  if (error) throw error
  return parseRpcResult(data)
}

export const unequipFarmBadgeReborn = async ({ badgeId }) => {
  const { data, error } = await supabase.rpc('unequip_farm_badge_reborn', {
    p_badge_id: badgeId,
  })

  if (error) throw error
  return parseRpcResult(data)
}
