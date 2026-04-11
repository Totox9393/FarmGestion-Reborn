export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || ''
export const BADGES_BUCKET_URL = SUPABASE_URL ? `${SUPABASE_URL}/storage/v1/object/public/badges` : ''

export const BADGE_RARITY_LABELS = {
  '0_auto': 'Auto',
  '1_common': 'Commun',
  '2_rare': 'Rare',
  '3_epic': 'Epique',
  '4_legendary': 'Legendaire',
}

export const BADGE_RARITY_ORDER = {
  '4_legendary': 5,
  '3_epic': 4,
  '2_rare': 3,
  '1_common': 2,
  '0_auto': 1,
}

export const MAX_BADGE_SLOTS = 3

export const getBadgeImageUrl = (filename, rarity) => {
  if (!BADGES_BUCKET_URL || !filename || !rarity) return ''
  return `${BADGES_BUCKET_URL}/${rarity}/${filename}`
}

export const sortBadgesByRarityThenName = (items) => {
  return [...(items || [])].sort((a, b) => {
    const leftOrder = BADGE_RARITY_ORDER[a?.rarity] || 0
    const rightOrder = BADGE_RARITY_ORDER[b?.rarity] || 0
    if (rightOrder !== leftOrder) return rightOrder - leftOrder
    return String(a?.filename || '').localeCompare(String(b?.filename || ''), 'fr')
  })
}

export const normalizeBadgeCatalogRow = (row) => {
  if (!row) return null
  const rarity = String(row.rarity || '').trim()
  const filename = String(row.filename || '').trim()
  if (!filename || !rarity) return null

  const stockTotal = Number(row.stock_total)
  const soldCount = Number(row.sold_count)
  const safeStockTotal = Number.isFinite(stockTotal) ? Math.max(0, Math.round(stockTotal)) : 0
  const safeSoldCount = Number.isFinite(soldCount) ? Math.max(0, Math.round(soldCount)) : 0

  return {
    id: row.id,
    filename,
    name: String(row.name || filename.replace(/\.gif$/i, '')),
    rarity,
    rarityLabel: BADGE_RARITY_LABELS[rarity] || rarity,
    rarityOrder: BADGE_RARITY_ORDER[rarity] || 0,
    price: Math.max(0, Number(row.price) || 0),
    stockTotal: safeStockTotal,
    soldCount: safeSoldCount,
    stockLeft: Math.max(0, safeStockTotal - safeSoldCount),
    isActive: Boolean(row.is_active),
    isShopVisible: row.is_shop_visible === undefined ? true : Boolean(row.is_shop_visible),
    imageUrl: getBadgeImageUrl(filename, rarity),
  }
}

export const normalizeBadgeFromRelation = (row, catalogKey = 'badges_catalog_reborn') => {
  const catalog = row?.[catalogKey]
  const normalized = normalizeBadgeCatalogRow(catalog)
  if (!normalized) return null

  return {
    ...normalized,
    relationId: row?.id || null,
    slot: Number.isFinite(Number(row?.slot)) ? Math.max(1, Math.round(Number(row.slot))) : null,
    farmId: row?.farm_id ?? null,
    betailId: row?.betail_id ?? null,
    purchasedAt: row?.purchased_at || null,
    purchasePrice: Number.isFinite(Number(row?.purchase_price)) ? Math.max(0, Number(row.purchase_price)) : null,
    equippedAt: row?.equipped_at || null,
    userId: row?.user_id || null,
  }
}
