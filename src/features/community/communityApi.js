import { supabase } from '../authentification/supabaseClient';
import { normalizeCenterStyle, normalizeSiteColors } from '../utils/FarmDesign/farmDesignUtils';

const PAGE_SIZE = 20;
const MAX_CREATION_ROWS = 900;
const MAX_PURCHASE_ROWS = 900;
const SEARCH_USER_LIMIT = 120;
const RETRY_ATTEMPTS = 2;

const sleep = (ms) => new Promise((resolve) => {
  window.setTimeout(resolve, ms);
});

const isRetriableSupabaseError = (error) => {
  if (!error) return false;
  const status = Number(error?.status || 0);
  const code = String(error?.code || '').toUpperCase();
  if (status >= 500) return true;
  return code === '57014' || code === '53300' || code === '08006' || code === '08001';
};

const runWithRetry = async (runQuery, { attempts = RETRY_ATTEMPTS, fallbackData, throwOnError = true } = {}) => {
  let lastError = null;

  for (let attempt = 0; attempt <= attempts; attempt += 1) {
    const response = await runQuery();
    if (!response?.error) {
      return response;
    }

    lastError = response.error;
    if (attempt >= attempts || !isRetriableSupabaseError(response.error)) {
      break;
    }

    const backoffMs = 180 * (2 ** attempt) + Math.floor(Math.random() * 120);
    await sleep(backoffMs);
  }

  if (throwOnError && lastError) throw lastError;
  return { data: fallbackData, error: lastError };
};

const normalizeSearchTerm = (value) =>
  String(value || '')
    .replace(/[(),]/g, ' ')
    .replace(/[%_]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);

const getMonthStartIso = () => {
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0));
  return monthStart.toISOString();
};

const buildInClause = (ids) => {
  const values = Array.from(new Set((ids || []).filter(Boolean)));
  if (!values.length) return '';
  return values.join(',');
};

const fetchMatchingProfileIds = async (searchTerm) => {
  if (!searchTerm) return [];

  const { data, error } = await runWithRetry(
    () => supabase
      .from('users_profiles')
      .select('id')
      .ilike('username', `%${searchTerm}%`)
      .limit(SEARCH_USER_LIMIT),
    { throwOnError: false, fallbackData: [] },
  );

  if (error || !Array.isArray(data)) return [];
  return Array.from(new Set(data.map((row) => row?.id).filter(Boolean)));
};

export const fetchActiveUserIdsThisMonth = async () => {
  const monthStartIso = getMonthStartIso();

  const [createdRowsResponse, purchasedRowsResponse] = await Promise.all([
    runWithRetry(() =>
      supabase
        .from('betails')
        .select('author_id')
        .gte('created_at', monthStartIso)
        .order('created_at', { ascending: false })
        .limit(MAX_CREATION_ROWS)),
    runWithRetry(() =>
      supabase
        .from('betails')
        .select('owner_id')
        .gte('purchased_at', monthStartIso)
        .order('purchased_at', { ascending: false })
        .limit(MAX_PURCHASE_ROWS)),
  ]);

  if (createdRowsResponse.error) throw createdRowsResponse.error;
  if (purchasedRowsResponse.error) throw purchasedRowsResponse.error;

  const scoreByUser = new Map();
  const addScore = (userId) => {
    if (!userId) return;
    scoreByUser.set(userId, (scoreByUser.get(userId) || 0) + 1);
  };

  (createdRowsResponse.data || []).forEach((row) => addScore(row?.author_id));
  (purchasedRowsResponse.data || []).forEach((row) => addScore(row?.owner_id));

  const activeUserIds = Array.from(scoreByUser.keys());
  const spotlightIds = Array.from(scoreByUser.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([userId]) => userId);

  const { data: spotlightProfiles } = spotlightIds.length
    ? await runWithRetry(
        () => supabase
          .from('users_profiles')
          .select('id, username, avatar_url')
          .in('id', spotlightIds),
        { throwOnError: false, fallbackData: [] },
      )
    : { data: [] };

  const { data: spotlightVisibleFarms } = spotlightIds.length
    ? await runWithRetry(
        () => supabase
          .from('farms_list')
          .select('proprietaire')
          .eq('visible', true)
          .in('proprietaire', spotlightIds),
        { throwOnError: false, fallbackData: [] },
      )
    : { data: [] };

  const profileById = new Map((spotlightProfiles || []).map((row) => [row.id, row]));
  const publicFarmOwnerSet = new Set((spotlightVisibleFarms || []).map((row) => row?.proprietaire).filter(Boolean));
  const spotlightUsers = spotlightIds.map((id) => {
    const profile = profileById.get(id);
    return {
      id,
      username: profile?.username || 'Utilisateur',
      avatarUrl: profile?.avatar_url || '',
      score: scoreByUser.get(id) || 0,
      hasPublicFarm: publicFarmOwnerSet.has(id),
    };
  });

  return {
    monthStartIso,
    activeUserIds,
    spotlightUsers,
  };
};

export const fetchCommunityPage = async ({ page = 0, searchTerm = '', activeUserIds = [] }) => {
  const safePage = Number.isInteger(page) && page >= 0 ? page : 0;
  const normalizedSearch = normalizeSearchTerm(searchTerm);
  const searchPattern = normalizedSearch ? `%${normalizedSearch.replace(/\s+/g, '%')}%` : '';
  const from = safePage * PAGE_SIZE;
  const to = from + PAGE_SIZE;

  let query = supabase
    .from('farms_list')
    .select('id, name, proprietaire, state, visible, site_colors, center_style, creation_date')
    .eq('visible', true)
    .order('creation_date', { ascending: false })
    .range(from, to);

  if (searchPattern) {
    const matchingProfileIds = await fetchMatchingProfileIds(normalizedSearch);
    const ownerClause = buildInClause(matchingProfileIds);

    if (ownerClause) {
      query = query.or(`name.ilike.${searchPattern},proprietaire.in.(${ownerClause})`);
    } else {
      query = query.ilike('name', searchPattern);
    }
  }

  const { data: farmsRows, error } = await runWithRetry(() => query);
  if (error) {
    throw error;
  }

  const rows = Array.isArray(farmsRows) ? farmsRows : [];
  const hasNextPage = rows.length > PAGE_SIZE;
  const currentRows = rows.slice(0, PAGE_SIZE);
  const ownerIds = Array.from(new Set(currentRows.map((row) => row?.proprietaire).filter(Boolean)));

  const { data: profileRows } = ownerIds.length
    ? await runWithRetry(
        () => supabase
          .from('users_profiles')
          .select('id, username, avatar_url')
          .in('id', ownerIds),
        { throwOnError: false, fallbackData: [] },
      )
    : { data: [] };

  const profileById = new Map((profileRows || []).map((row) => [row.id, row]));
  const activeSet = new Set((activeUserIds || []).filter(Boolean));

  const items = currentRows
    .map((row) => {
      const ownerProfile = profileById.get(row.proprietaire);
      const username = ownerProfile?.username || 'Utilisateur inconnu';
      const avatarUrl = ownerProfile?.avatar_url || '';
      return {
        farmId: row.id,
        farmName: row.name || 'Ferme sans nom',
        farmState: row.state || '',
        ownerId: row.proprietaire,
        username,
        avatarUrl,
        creationDate: row.creation_date || '',
        isActive: activeSet.has(row.proprietaire),
        siteColors: normalizeSiteColors(row.site_colors),
        centerStyle: normalizeCenterStyle(row.center_style),
      };
    })
    .sort((a, b) => {
      if (a.isActive !== b.isActive) return a.isActive ? -1 : 1;
      return Date.parse(b.creationDate || 0) - Date.parse(a.creationDate || 0);
    });

  let userItems = [];
  if (searchPattern) {
    const { data: matchingProfiles } = await runWithRetry(
      () => supabase
        .from('users_profiles')
        .select('id, username, avatar_url, farm_id')
        .ilike('username', searchPattern)
        .limit(12),
      { throwOnError: false, fallbackData: [] },
    );

    const profileRows = Array.isArray(matchingProfiles) ? matchingProfiles : [];
    const profileFarmIds = Array.from(new Set(profileRows.map((row) => row?.farm_id).filter(Boolean)));
    const { data: profileFarms } = profileFarmIds.length
      ? await runWithRetry(
          () => supabase
            .from('farms_list')
            .select('id, visible')
            .in('id', profileFarmIds),
          { throwOnError: false, fallbackData: [] },
        )
      : { data: [] };

    const visibleFarmSet = new Set((profileFarms || []).filter((row) => row?.visible).map((row) => row?.id));
    const visibleOwnerSet = new Set(items.map((row) => row.ownerId).filter(Boolean));

    userItems = profileRows
      .filter((profile) => !visibleOwnerSet.has(profile.id))
      .filter((profile) => {
        if (!profile?.farm_id) return true;
        return !visibleFarmSet.has(profile.farm_id);
      })
      .map((profile) => ({
        id: profile.id,
        username: profile.username || 'Utilisateur',
        avatarUrl: profile.avatar_url || '',
        farmId: profile.farm_id || null,
      }));
  }

  return {
    items,
    userItems,
    hasNextPage,
    page: safePage,
    pageSize: PAGE_SIZE,
  };
};

export const fetchCommunityStats = async () => {
  const [farmsResponse, usersResponse] = await Promise.all([
    runWithRetry(() =>
      supabase
        .from('farms_list')
        .select('id', { count: 'planned', head: true })
        .eq('visible', true), { throwOnError: false, fallbackData: null }),
    runWithRetry(() =>
      supabase
        .from('users_profiles')
        .select('id', { count: 'planned', head: true }), { throwOnError: false, fallbackData: null }),
  ]);

  return {
    totalVisibleFarms: Number(farmsResponse.count || 0),
    totalUsers: Number(usersResponse.count || 0),
  };
};
