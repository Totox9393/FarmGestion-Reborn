import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, Check, ChevronDown, Search, ScanSearch, Trash2, X } from 'lucide-react';
import defaultProfileUser from '../../assets/defaut_profile_user.png';
import defaultBetailAvatar from '../../assets/defaut_profile.png';
import premiumSuccessSound from '../../assets/sounds/GOCHISOU_7.WAV';
import deletePromptIntro from '../../assets/sounds/Ask_suppr1.wav';
import deletePromptLoop from '../../assets/sounds/Ask_Suppr2loop.wav';
import deleteSuccessSound from '../../assets/sounds/Ask_Suppr3.wav';
import { supabase } from '../authentification/supabaseClient';
import { useAuth } from '../authentification/AuthContext';
import { BADGE_RARITY_LABELS, getBadgeImageUrl } from '../badges/badgeUtils';
import { createSafeAudio, restartAudioSafely } from '../utils/safeAudio';
import { createHexagonPoints, createTrianglePoints } from '../utils/FarmDesign/farmDesignUtils';
import { FarmDesignPreview } from '../utils/FarmDesign';
import { formatMatricule } from '../utils/formatMatricule';
import Settings_AdminDuplicateBetailsPanel from './Settings_AdminDuplicateBetailsPanel';
import './Settings_CentralePage.css';

const RESULT_LIMIT = 30;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const NUMERIC_PATTERN = /^\d+$/;
const DEFAULT_BETAIL_AVATAR_PREVIEW_SIZE = 220;
const DEFAULT_BETAIL_AVATAR_OUTPUT_SIZE = 512;
const DEFAULT_BETAIL_AVATAR_ZOOM = 1.15;
const DEFAULT_BETAIL_AVATAR_OFFSET = { x: 0, y: 12 };
const PREMIUM_CONFETTI_COLORS = ['#f7cb58', '#ffe59a', '#5fa8f4', '#8b6cd7', '#f28ab2'];

const ADMIN_ROLE_OPTIONS = [
  { value: 'STANDARD', label: 'Standard' },
  { value: 'MODERATION', label: 'Modérateur' },
  { value: 'ADMIN', label: 'Administrateur' },
];

const EMPTY_DELETE_FLOW = {
  phase: 'idle',
  target: null,
  confirmation: '',
  progress: 0,
  error: '',
  result: null,
};

const ACCOUNT_DELETE_CONSEQUENCES = [
  'Le compte, le profil, la ferme et les réglages seront supprimés.',
  'Les expéditions en cours disparaîtront du calendrier.',
  'Les enchères et mises actives seront annulées.',
  'Les bétails retourneront au registre public avec leurs attributs et leurs badges.',
  'Les badges de ferme et d’inventaire issus de la boutique retourneront en stock.',
  'Les likes, relations et blocages du joueur seront supprimés.',
  'Les historiques terminés resteront consultables sous « Compte supprimé ».',
  'Le pseudo sera immédiatement disponible.',
];

const getOverviewRowsCount = (total) => (
  Math.min(28, Math.max(4, Math.ceil(Math.sqrt(total * 0.5))))
);

const createOverviewDots = (firstValue, secondValue) => {
  const first = Math.max(0, Number(firstValue) || 0);
  const second = Math.max(0, Number(secondValue) || 0);
  const total = first + second;
  if (!total) return [];

  const dots = [];
  const baseY = 102;
  const rows = getOverviewRowsCount(total);
  const outerRadius = 88;
  const innerRadius = 24;
  const radii = Array.from({ length: rows }, (_, row) => (
    outerRadius - ((outerRadius - innerRadius) * row) / Math.max(1, rows - 1)
  ));
  const radiiSum = radii.reduce((sum, radius) => sum + radius, 0);
  const seatAllocations = radii.map((radius, row) => {
    const exact = (total * radius) / radiiSum;
    return { row, seats: Math.floor(exact), remainder: exact % 1 };
  });

  let remainingSeats = total - seatAllocations.reduce((sum, allocation) => sum + allocation.seats, 0);
  [...seatAllocations]
    .sort((left, right) => right.remainder - left.remainder)
    .forEach((allocation) => {
      if (remainingSeats <= 0) return;
      allocation.seats += 1;
      remainingSeats -= 1;
    });

  radii.forEach((radius, row) => {
    const seats = seatAllocations[row].seats;
    for (let point = 0; point < seats; point += 1) {
      const angle = Math.PI - ((point + 0.5) / seats) * Math.PI;
      dots.push({
        key: `${row}-${point}`,
        x: 100 + Math.cos(angle) * radius,
        y: baseY - Math.sin(angle) * radius,
        tone: 'empty',
      });
    }
  });

  const secondDots = Math.round((second / total) * dots.length);
  [...dots]
    .sort((left, right) => left.x - right.x || right.y - left.y)
    .forEach((dot, index) => {
      dot.tone = index < secondDots ? 'second' : 'first';
    });

  return dots;
};

const ACTIVITY_RAYS = Array.from({ length: 56 }, (_, index) => {
  const angle = (index * 360) / 56 - 90;
  const radians = (angle * Math.PI) / 180;
  const innerRadius = 36 + ((index * 7) % 10);
  const outerRadius = 60 + ((index * 13) % 21);
  return {
    key: index,
    x1: 100 + Math.cos(radians) * innerRadius,
    y1: 100 + Math.sin(radians) * innerRadius,
    x2: 100 + Math.cos(radians) * outerRadius,
    y2: 100 + Math.sin(radians) * outerRadius,
    tone: ['blue', 'violet', 'pink', 'teal'][index % 4],
    delay: `${(index % 14) * 0.11}s`,
  };
});

const cleanupDeletedUserAvatarFiles = async (userId) => {
  const prefixes = [userId, `farm-centers/${userId}`];
  const paths = [];
  let warning = false;

  for (const prefix of prefixes) {
    const { data, error } = await supabase.storage.from('avatars').list(prefix, { limit: 1000 });
    if (error) {
      warning = true;
      continue;
    }
    (data || []).forEach((item) => {
      if (item?.name) paths.push(`${prefix}/${item.name}`);
    });
  }

  if (paths.length) {
    const { error } = await supabase.storage.from('avatars').remove(paths);
    if (error) warning = true;
  }

  return {
    avatar_files_deleted: warning ? 0 : paths.length,
    avatar_cleanup_warning: warning,
  };
};

const normalizeAdminRole = (userRow) => {
  const roles = `${userRow?.role || ''} ${userRow?.role_ingame || ''}`.toUpperCase();
  if (roles.includes('ADMIN')) return 'ADMIN';
  if (roles.includes('MODERATION') || roles.includes('MODERATOR')) return 'MODERATION';
  return 'STANDARD';
};

const buildAvatarCandidates = (value, supabaseUrl) => {
  const raw = String(value || '').trim();
  if (!raw) return [];
  if (raw.startsWith('http://') || raw.startsWith('https://')) return [raw];
  if (!supabaseUrl) return [raw];

  const candidates = [raw];
  if (raw.startsWith('/storage/v1/object/public/')) {
    candidates.push(`${supabaseUrl}${raw}`);
  } else if (raw.startsWith('storage/v1/object/public/')) {
    candidates.push(`${supabaseUrl}/${raw}`);
  } else if (raw.startsWith('/')) {
    candidates.push(`${supabaseUrl}${raw}`);
    const normalized = raw.replace(/^\/+/, '');
    candidates.push(`${supabaseUrl}/${normalized}`);
  } else if (raw.includes('/')) {
    candidates.push(`${supabaseUrl}/storage/v1/object/public/${raw}`);
  } else {
    candidates.push(`${supabaseUrl}/storage/v1/object/public/avatars/${raw}`);
    candidates.push(`${supabaseUrl}/storage/v1/object/public/ressources/${raw}`);
    candidates.push(`${supabaseUrl}/storage/v1/object/public/betails/${raw}`);
  }

  return Array.from(new Set(candidates));
};

const normalizeBetailAvatar = (value, supabaseUrl) => {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (raw.startsWith('http://') || raw.startsWith('https://')) return raw;
  if (!supabaseUrl) return raw;
  if (raw.startsWith('/storage/v1/object/public/')) return `${supabaseUrl}${raw}`;
  if (raw.startsWith('storage/v1/object/public/')) return `${supabaseUrl}/${raw}`;
  if (raw.startsWith('/')) return `${supabaseUrl}${raw}`;
  if (raw.includes('/')) return `${supabaseUrl}/storage/v1/object/public/${raw}`;
  return `${supabaseUrl}/storage/v1/object/public/betails/${raw}`;
};

const sanitizeForIlike = (value) => {
  const safe = String(value || '').replace(/[,%()]/g, ' ').replace(/\s+/g, ' ').trim();
  return safe;
};

const loadImageFromUrl = async (src) => {
  const image = new Image();
  image.crossOrigin = 'anonymous';
  image.src = src;
  await new Promise((resolve, reject) => {
    image.onload = resolve;
    image.onerror = reject;
  });
  return image;
};

const uploadModerationDefaultBetailAvatar = async () => {
  const image = await loadImageFromUrl(defaultBetailAvatar);
  const canvas = document.createElement('canvas');
  canvas.width = DEFAULT_BETAIL_AVATAR_OUTPUT_SIZE;
  canvas.height = DEFAULT_BETAIL_AVATAR_OUTPUT_SIZE;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas indisponible pour la photo standard.');

  const baseScale = Math.max(
    DEFAULT_BETAIL_AVATAR_PREVIEW_SIZE / image.naturalWidth,
    DEFAULT_BETAIL_AVATAR_PREVIEW_SIZE / image.naturalHeight,
  );
  const scaleRatio = DEFAULT_BETAIL_AVATAR_OUTPUT_SIZE / DEFAULT_BETAIL_AVATAR_PREVIEW_SIZE;

  context.clearRect(0, 0, DEFAULT_BETAIL_AVATAR_OUTPUT_SIZE, DEFAULT_BETAIL_AVATAR_OUTPUT_SIZE);
  context.save();
  context.beginPath();
  context.arc(
    DEFAULT_BETAIL_AVATAR_OUTPUT_SIZE / 2,
    DEFAULT_BETAIL_AVATAR_OUTPUT_SIZE / 2,
    DEFAULT_BETAIL_AVATAR_OUTPUT_SIZE / 2,
    0,
    Math.PI * 2,
  );
  context.clip();
  context.translate(
    DEFAULT_BETAIL_AVATAR_OUTPUT_SIZE / 2 + DEFAULT_BETAIL_AVATAR_OFFSET.x * scaleRatio,
    DEFAULT_BETAIL_AVATAR_OUTPUT_SIZE / 2 + DEFAULT_BETAIL_AVATAR_OFFSET.y * scaleRatio,
  );
  context.scale(baseScale * DEFAULT_BETAIL_AVATAR_ZOOM * scaleRatio, baseScale * DEFAULT_BETAIL_AVATAR_ZOOM * scaleRatio);
  context.drawImage(image, -image.naturalWidth / 2, -image.naturalHeight / 2);
  context.restore();

  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('Impossible de générer la photo standard.');

  const suffix = Math.random().toString(36).slice(2, 8);
  const filePath = `moderation/default-${Date.now()}-${suffix}.png`;
  const { error: uploadError } = await supabase.storage.from('betails').upload(filePath, blob, {
    cacheControl: '3600',
    upsert: true,
    contentType: 'image/png',
  });
  if (uploadError) throw uploadError;

  const { data } = supabase.storage.from('betails').getPublicUrl(filePath);
  if (!data?.publicUrl) throw new Error('Impossible de récupérer la photo standard.');
  return data.publicUrl;
};

function AvatarMedia({ avatarUrl, alt }) {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || '';
  const candidates = useMemo(() => buildAvatarCandidates(avatarUrl, supabaseUrl), [avatarUrl, supabaseUrl]);
  const [index, setIndex] = useState(0);
  const nextSrc = candidates[index] || '';

  useEffect(() => {
    setIndex(0);
  }, [avatarUrl]);

  if (!nextSrc || index >= candidates.length) {
    return <img src={defaultProfileUser} alt={alt} loading="lazy" />;
  }

  return (
    <img
      src={nextSrc}
      alt={alt}
      loading="lazy"
      onError={() => {
        if (index < candidates.length - 1) {
          setIndex((current) => current + 1);
          return;
        }
        setIndex(candidates.length);
      }}
    />
  );
}

const parseFarmColors = (value) => {
  if (Array.isArray(value) && value.length === 6) return value;
  if (value && typeof value === 'object') {
    const objectValues = Object.values(value);
    if (objectValues.length === 6) return objectValues;
  }
  return ['#C7EECF', '#BFE9FF', '#FFF2B8', '#D8F7CF', '#DDE8FF', '#FFE9A9'];
};

const parseCenterStyle = (value) => {
  if (!value || typeof value !== 'object') return { type: 'emoji', emoji: 'H' };
  return value;
};

const formatDate = (value) => {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return new Intl.DateTimeFormat('fr-FR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(date);
};

const IMAGE_NAME_PATTERN = /([^/]+\.(?:gif|png|jpe?g|webp|svg))$/i;

const normalizeBadgeStringEntry = (value) => {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const filenameMatch = raw.match(IMAGE_NAME_PATTERN);
  const filename = filenameMatch ? filenameMatch[1] : (IMAGE_NAME_PATTERN.test(raw) ? raw : '');
  const badgeId = UUID_PATTERN.test(raw) || NUMERIC_PATTERN.test(raw) ? raw : '';

  return {
    badgeId,
    filename,
    name: '',
    rarity: '',
    imageUrl: raw.startsWith('http://') || raw.startsWith('https://') ? raw : '',
    raw,
  };
};

const normalizeBadgeObjectEntry = (value) => {
  if (!value || typeof value !== 'object') return null;

  const badgeId = String(value.badge_id || value.badgeId || value.id || '').trim();
  const filenameRaw = String(value.filename || value.file_name || value.badge_filename || value.path || '').trim();
  const filenameMatch = filenameRaw.match(IMAGE_NAME_PATTERN);
  const filename = filenameMatch ? filenameMatch[1] : (IMAGE_NAME_PATTERN.test(filenameRaw) ? filenameRaw : '');
  const imageUrl = String(value.image_url || value.imageUrl || '').trim();

  return {
    badgeId,
    filename,
    name: String(value.name || value.label || '').trim(),
    rarity: String(value.rarity || '').trim(),
    imageUrl,
    raw: badgeId || filename || imageUrl || String(value.name || ''),
  };
};

const normalizeBadgeEntries = (value) => {
  if (!value) return [];

  const parseUnknown = (input) => {
    if (!input) return [];

    if (Array.isArray(input)) {
      return input.flatMap((item) => {
        if (typeof item === 'string' || typeof item === 'number') {
          const token = normalizeBadgeStringEntry(item);
          return token ? [token] : [];
        }
        if (item && typeof item === 'object') {
          const objectToken = normalizeBadgeObjectEntry(item);
          if (objectToken?.raw) return [objectToken];
          return Object.values(item).flatMap((nested) => parseUnknown(nested));
        }
        return [];
      });
    }

    if (typeof input === 'string') {
      try {
        const parsed = JSON.parse(input);
        return parseUnknown(parsed);
      } catch {
        const token = normalizeBadgeStringEntry(input);
        return token ? [token] : [];
      }
    }

    if (typeof input === 'number') {
      const token = normalizeBadgeStringEntry(String(input));
      return token ? [token] : [];
    }

    if (input && typeof input === 'object') {
      const objectToken = normalizeBadgeObjectEntry(input);
      if (objectToken?.raw) return [objectToken];
      return Object.values(input).flatMap((nested) => parseUnknown(nested));
    }

    return [];
  };

  const parsed = parseUnknown(value).filter((entry) => entry && (entry.badgeId || entry.filename || entry.name || entry.imageUrl));
  const seen = new Set();
  return parsed.filter((entry) => {
    const key = String(entry.badgeId || entry.filename || entry.name || entry.imageUrl || entry.raw || '').toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const isPublicRegisterBetail = (betail) => {
  if (!betail || typeof betail !== 'object') return false;
  return Boolean(betail.visible && !betail.purchased_at && !betail.owner_id);
};

const MiniFarmPreview = ({ siteColors, centerStyle, label }) => {
  const colors = parseFarmColors(siteColors);
  const center = parseCenterStyle(centerStyle);

  return (
    <div className="centrale-mini-farm" style={{ '--farm-glow': colors[0] || '#c6d978' }} aria-hidden="true">
      <svg viewBox="0 0 200 200" className="centrale-mini-farm__svg" aria-label={`Ferme ${label}`}>
        <polygon className="centrale-mini-farm__outline" points={createHexagonPoints(100, 100, 86)} />
        {colors.map((color, index) => (
          <polygon
            key={index}
            className="centrale-mini-farm__site"
            points={createTrianglePoints(100, 100, 86, index)}
            style={{ fill: color }}
          />
        ))}
        <circle className="centrale-mini-farm__core" cx="100" cy="100" r="28" />
      </svg>
      <div className="centrale-mini-farm__center">
        {center?.type === 'image' && center?.imageUrl ? (
          <img src={center.imageUrl} alt="Centre de ferme" loading="lazy" />
        ) : (
          <span>{center?.emoji || 'H'}</span>
        )}
      </div>
    </div>
  );
};

const runCentralSearch = async ({ query, filters }) => {
  const term = String(query || '').trim();
  if (!term) {
    return {
      users: [],
      farms: [],
      betails: [],
      profileMap: new Map(),
      farmMap: new Map(),
      badgeCatalogMap: new Map(),
      badgeCatalogByFilenameMap: new Map(),
    };
  }

  const safeLike = sanitizeForIlike(term);
  const likeValue = `%${safeLike}%`;
  const isUuid = UUID_PATTERN.test(term);
  const isFarmId = NUMERIC_PATTERN.test(term);
  const farmIdValue = isFarmId ? Number(term) : null;

  const requests = [];

  if (filters.users) {
    const userClauses = [];
    if (safeLike) {
      userClauses.push(`username.ilike.${likeValue}`, `email.ilike.${likeValue}`);
    }
    if (isUuid) {
      userClauses.push(`id.eq.${term}`);
    }
    if (isFarmId) {
      userClauses.push(`farm_id.eq.${farmIdValue}`);
    }

    let request = supabase
      .from('users_profiles')
      .select('id,username,email,role,role_ingame,money,farm_id,avatar_url,created_at,updated_at')
      .limit(RESULT_LIMIT);

    if (userClauses.length) {
      request = request.or(userClauses.join(','));
    }

    requests.push(request.then(({ data, error }) => {
      if (error) throw error;
      return { key: 'users', rows: data || [] };
    }));
  }

  if (filters.farms) {
    const farmClauses = [];
    if (safeLike) {
      farmClauses.push(`name.ilike.${likeValue}`);
    }
    if (isUuid) {
      farmClauses.push(`proprietaire.eq.${term}`);
    }
    if (isFarmId) {
      farmClauses.push(`id.eq.${farmIdValue}`);
    }

    let request = supabase
      .from('farms_list')
      .select('id,name,creation_date,proprietaire,state,visible,site_colors,center_style,equipped_badges')
      .limit(RESULT_LIMIT);

    if (farmClauses.length) {
      request = request.or(farmClauses.join(','));
    }

    requests.push(request.then(({ data, error }) => {
      if (error) throw error;
      return { key: 'farms', rows: data || [] };
    }));
  }

  if (filters.betails) {
    const betailClauses = [];
    if (safeLike) {
      betailClauses.push(`name.ilike.${likeValue}`, `matricule.ilike.${likeValue}`);
      if (filters.commentKeywords) {
        betailClauses.push(`comments.ilike.${likeValue}`);
      }
    }
    if (isUuid) {
      betailClauses.push(`id.eq.${term}`, `author_id.eq.${term}`, `owner_id.eq.${term}`);
    }
    if (isFarmId) {
      betailClauses.push(`farm_id.eq.${farmIdValue}`);
    }

    let request = supabase
      .from('betails')
      .select('id,matricule,name,avatar_url,farm_id,farm_site,age,premium,comments,author_id,owner_id,created_at,like_count,purchased_at,visible,invisible_reason,invisible_at,equipped_badges,admin_reward_badge_ids')
      .limit(RESULT_LIMIT);

    if (betailClauses.length) {
      request = request.or(betailClauses.join(','));
    }

    requests.push(request.then(({ data, error }) => {
      if (error) throw error;
      return { key: 'betails', rows: data || [] };
    }));
  }

  const settled = await Promise.all(requests);
  const grouped = settled.reduce((acc, block) => {
    acc[block.key] = block.rows;
    return acc;
  }, { users: [], farms: [], betails: [] });

  const relatedFarmIds = new Set();
  grouped.users.forEach((row) => {
    if (row?.farm_id != null) relatedFarmIds.add(Number(row.farm_id));
  });
  grouped.betails.forEach((row) => {
    if (row?.farm_id != null) relatedFarmIds.add(Number(row.farm_id));
  });
  grouped.farms.forEach((row) => {
    if (row?.id != null) relatedFarmIds.add(Number(row.id));
  });

  const farmIds = Array.from(relatedFarmIds).filter((id) => Number.isFinite(id));
  let farmMap = new Map((grouped.farms || []).map((farm) => [Number(farm.id), farm]));
  if (farmIds.length) {
    const missingIds = farmIds.filter((id) => !farmMap.has(id));
    if (missingIds.length) {
      const { data: farmsRows, error: farmsError } = await supabase
        .from('farms_list')
        .select('id,name,creation_date,proprietaire,state,visible,site_colors,center_style,equipped_badges')
        .in('id', missingIds);

      if (farmsError) throw farmsError;
      (farmsRows || []).forEach((row) => {
        farmMap.set(Number(row.id), row);
      });
    }
  }

  const relatedProfileIds = new Set();
  grouped.users.forEach((row) => relatedProfileIds.add(String(row.id)));
  grouped.farms.forEach((row) => {
    if (row?.proprietaire) relatedProfileIds.add(String(row.proprietaire));
  });
  farmMap.forEach((farm) => {
    if (farm?.proprietaire) relatedProfileIds.add(String(farm.proprietaire));
  });
  grouped.betails.forEach((row) => {
    if (row?.author_id) relatedProfileIds.add(String(row.author_id));
    if (row?.owner_id) relatedProfileIds.add(String(row.owner_id));
  });

  const ids = Array.from(relatedProfileIds).filter(Boolean);
  let profileMap = new Map();
  if (ids.length) {
    const { data: profileRows, error: profileError } = await supabase
      .rpc('get_public_profiles_reborn')
      .select('id,username,avatar_url')
      .in('id', ids);

    if (profileError) throw profileError;
    profileMap = new Map((profileRows || []).map((row) => [String(row.id), row]));
  }

  const relatedBadgeIds = new Set();
  const relatedBadgeFilenames = new Set();
  grouped.betails.forEach((row) => {
    normalizeBadgeEntries(row?.equipped_badges).forEach((badge) => {
      const id = String(badge?.badgeId || '').trim();
      const filename = String(badge?.filename || '').trim();
      if (UUID_PATTERN.test(id) || NUMERIC_PATTERN.test(id)) relatedBadgeIds.add(id);
      if (filename) relatedBadgeFilenames.add(filename);
    });
    normalizeBadgeEntries(row?.admin_reward_badge_ids).forEach((badge) => {
      const id = String(badge?.badgeId || '').trim();
      const filename = String(badge?.filename || '').trim();
      if (UUID_PATTERN.test(id) || NUMERIC_PATTERN.test(id)) relatedBadgeIds.add(id);
      if (filename) relatedBadgeFilenames.add(filename);
    });
  });
  grouped.farms.forEach((row) => {
    normalizeBadgeEntries(row?.equipped_badges).forEach((badge) => {
      const id = String(badge?.badgeId || '').trim();
      const filename = String(badge?.filename || '').trim();
      if (UUID_PATTERN.test(id) || NUMERIC_PATTERN.test(id)) relatedBadgeIds.add(id);
      if (filename) relatedBadgeFilenames.add(filename);
    });
  });

  let badgeCatalogMap = new Map();
  let badgeCatalogByFilenameMap = new Map();
  const badgeIds = Array.from(relatedBadgeIds);
  const badgeFilenames = Array.from(relatedBadgeFilenames);
  const badgeRequests = [];

  if (badgeIds.length) {
    badgeRequests.push(
      supabase
        .from('badges_catalog_reborn')
        .select('id,name,filename,rarity')
        .in('id', badgeIds),
    );
  }
  if (badgeFilenames.length) {
    badgeRequests.push(
      supabase
        .from('badges_catalog_reborn')
        .select('id,name,filename,rarity')
        .in('filename', badgeFilenames),
    );
  }

  if (badgeRequests.length) {
    const responses = await Promise.all(badgeRequests);
    const allRows = [];
    responses.forEach(({ data, error }) => {
      if (error) throw error;
      (data || []).forEach((row) => {
        allRows.push(row);
      });
    });

    badgeCatalogMap = new Map(allRows.map((row) => [String(row.id), row]));
    badgeCatalogByFilenameMap = new Map(
      allRows
        .filter((row) => String(row?.filename || '').trim())
        .map((row) => [String(row.filename).trim().toLowerCase(), row]),
    );
  }

  return {
    users: grouped.users,
    farms: grouped.farms,
    betails: grouped.betails,
    profileMap,
    farmMap,
    badgeCatalogMap,
    badgeCatalogByFilenameMap,
  };
};

const fetchCentralSuggestions = async (term) => {
  const safeTerm = sanitizeForIlike(term);
  if (!safeTerm) return [];
  const startsWith = `${safeTerm}%`;

  const [usersResponse, farmsResponse, betailsResponse] = await Promise.all([
    supabase
      .from('users_profiles')
      .select('id,username,email')
      .or(`username.ilike.${startsWith},email.ilike.${startsWith}`)
      .order('username', { ascending: true })
      .limit(4),
    supabase
      .from('farms_list')
      .select('id,name')
      .ilike('name', startsWith)
      .order('name', { ascending: true })
      .limit(4),
    supabase
      .from('betails')
      .select('id,name,matricule,premium')
      .or(`name.ilike.${startsWith},matricule.ilike.${startsWith}`)
      .order('name', { ascending: true })
      .limit(4),
  ]);

  const error = [usersResponse, farmsResponse, betailsResponse].find((response) => response.error)?.error;
  if (error) throw error;

  return [
    ...(usersResponse.data || []).map((row) => ({
      key: `user-${row.id}`,
      type: 'Utilisateur',
      label: row.username || 'Utilisateur sans nom',
      detail: row.email || row.id,
      searchTerm: row.username || row.email || row.id,
    })),
    ...(farmsResponse.data || []).map((row) => ({
      key: `farm-${row.id}`,
      type: 'Ferme',
      label: row.name || `Ferme #${row.id}`,
      detail: `Ferme #${row.id}`,
      searchTerm: row.name || String(row.id),
    })),
    ...(betailsResponse.data || []).map((row) => ({
      key: `betail-${row.id}`,
      type: 'Bétail',
      label: row.name || 'Bétail sans nom',
      detail: `${formatMatricule(row.matricule)}${row.premium ? ' · Premium' : ''}`,
      searchTerm: row.name || row.matricule || row.id,
    })),
  ];
};

function Settings_CentralePage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || '';
  const [searchInput, setSearchInput] = useState('');
  const [suggestionTerm, setSuggestionTerm] = useState('');
  const [submittedQuery, setSubmittedQuery] = useState('');
  const [isSearchVisible, setIsSearchVisible] = useState(true);
  const [livestockOverviewMode, setLivestockOverviewMode] = useState('ownership');
  const [isDuplicateDetectionVisible, setIsDuplicateDetectionVisible] = useState(false);
  const [aiAvailability, setAiAvailability] = useState('checking');
  const [selectedBetail, setSelectedBetail] = useState(null);
  const [betailActionBusy, setBetailActionBusy] = useState('');
  const [isBetailCommentEditorOpen, setIsBetailCommentEditorOpen] = useState(false);
  const [betailCommentDraft, setBetailCommentDraft] = useState('');
  const [premiumTransition, setPremiumTransition] = useState('idle');
  const [selectedFarm, setSelectedFarm] = useState(null);
  const [selectedUser, setSelectedUser] = useState(null);
  const [moneyDraft, setMoneyDraft] = useState('');
  const [roleDraft, setRoleDraft] = useState('STANDARD');
  const [roleMenuOpen, setRoleMenuOpen] = useState(false);
  const [savingUserField, setSavingUserField] = useState('');
  const [userActionBusy, setUserActionBusy] = useState('');
  const [userActionFeedback, setUserActionFeedback] = useState(null);
  const [banFlow, setBanFlow] = useState({ isOpen: false, target: null, error: '' });
  const [deleteFlow, setDeleteFlow] = useState(EMPTY_DELETE_FLOW);
  const roleMenuRef = useRef(null);
  const deletePhaseRef = useRef('idle');
  const deleteIntroAudioRef = useRef(null);
  const deleteLoopAudioRef = useRef(null);
  const deleteFinalAudioRef = useRef(null);
  const deleteProgressTimerRef = useRef(null);
  const deleteSuccessTimerRef = useRef(null);
  const premiumTransitionTimerRef = useRef(null);
  const farmRequestRef = useRef(0);
  const [filters, setFilters] = useState({
    betails: true,
    farms: true,
    users: true,
    commentKeywords: false,
  });

  const isCentraleModalOpen = Boolean(selectedBetail || selectedFarm || selectedUser || banFlow.isOpen || deleteFlow.phase !== 'idle');

  useEffect(() => {
    if (!isCentraleModalOpen) return undefined;
    const previousBodyOverflow = document.body.style.overflow;
    const previousDocumentOverscroll = document.documentElement.style.overscrollBehavior;
    document.body.style.overflow = 'hidden';
    document.documentElement.style.overscrollBehavior = 'none';
    return () => {
      document.body.style.overflow = previousBodyOverflow;
      document.documentElement.style.overscrollBehavior = previousDocumentOverscroll;
    };
  }, [isCentraleModalOpen]);

  const hasActiveFilter = filters.betails || filters.farms || filters.users;
  const effectiveQuery = submittedQuery.trim();

  const searchQuery = useQuery({
    queryKey: ['admin', 'centrale-search', effectiveQuery, filters],
    enabled: Boolean(effectiveQuery) && hasActiveFilter && !isSearchVisible,
    staleTime: 30_000,
    gcTime: 180_000,
    retry: 1,
    refetchOnWindowFocus: false,
    queryFn: () => runCentralSearch({ query: effectiveQuery, filters }),
  });

  useEffect(() => {
    const timeoutId = window.setTimeout(() => setSuggestionTerm(searchInput.trim()), 180);
    return () => window.clearTimeout(timeoutId);
  }, [searchInput]);

  const suggestionsQuery = useQuery({
    queryKey: ['admin', 'centrale-suggestions', suggestionTerm],
    enabled: isSearchVisible && suggestionTerm.length > 0,
    staleTime: 20_000,
    gcTime: 120_000,
    retry: 1,
    refetchOnWindowFocus: false,
    queryFn: () => fetchCentralSuggestions(suggestionTerm),
  });

  const overviewQuery = useQuery({
    queryKey: ['admin', 'centrale-overview'],
    staleTime: 60_000,
    gcTime: 300_000,
    retry: 1,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const responses = await Promise.all([
        supabase.from('betails').select('*', { count: 'exact', head: true }),
        supabase.from('betails').select('*', { count: 'exact', head: true }).is('farm_id', null),
        supabase.from('betails').select('*', { count: 'exact', head: true }).not('farm_id', 'is', null),
        supabase.from('betails').select('*', { count: 'exact', head: true }).eq('premium', false),
        supabase.from('betails').select('*', { count: 'exact', head: true }).eq('premium', true),
        supabase.from('users_profiles').select('*', { count: 'exact', head: true }),
      ]);
      const error = responses.find((response) => response.error)?.error;
      if (error) throw error;

      return {
        totalBetails: responses[0].count || 0,
        publicBetails: responses[1].count || 0,
        farmBetails: responses[2].count || 0,
        standardBetails: responses[3].count || 0,
        premiumBetails: responses[4].count || 0,
        totalUsers: responses[5].count || 0,
      };
    },
  });

  useEffect(() => {
    let active = true;
    const checkAiAvailability = async () => {
      try {
        const { data, error } = await supabase.functions.invoke('detect-betail-duplicates', {
          body: { action: 'health' },
        });
        if (active) setAiAvailability(!error && data?.available ? 'available' : 'unavailable');
      } catch {
        if (active) setAiAvailability('unavailable');
      }
    };
    void checkAiAvailability();
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!roleMenuOpen) return undefined;
    const handlePointerDown = (event) => {
      if (!roleMenuRef.current?.contains(event.target)) setRoleMenuOpen(false);
    };
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') setRoleMenuOpen(false);
    };
    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [roleMenuOpen]);

  useEffect(() => () => {
    [deleteIntroAudioRef, deleteLoopAudioRef, deleteFinalAudioRef].forEach((audioRef) => {
      if (!audioRef.current) return;
      audioRef.current.pause();
      audioRef.current.onended = null;
    });
    if (deleteProgressTimerRef.current) window.clearInterval(deleteProgressTimerRef.current);
    if (deleteSuccessTimerRef.current) window.clearInterval(deleteSuccessTimerRef.current);
    if (premiumTransitionTimerRef.current) window.clearTimeout(premiumTransitionTimerRef.current);
  }, []);

  const results = searchQuery.data || {
    users: [],
    farms: [],
    betails: [],
    profileMap: new Map(),
    farmMap: new Map(),
    badgeCatalogMap: new Map(),
    badgeCatalogByFilenameMap: new Map(),
  };
  const totalCount = results.users.length + results.farms.length + results.betails.length;
  const overview = overviewQuery.data || {
    totalBetails: 0,
    farmBetails: 0,
    publicBetails: 0,
    standardBetails: 0,
    premiumBetails: 0,
    totalUsers: 0,
  };
  const livestockOverview = livestockOverviewMode === 'ownership'
    ? {
      first: overview.publicBetails,
      second: overview.farmBetails,
      firstLabel: 'Registre public',
      secondLabel: 'En ferme',
      description: 'Répartition selon leur présence dans une ferme.',
    }
    : {
      first: overview.standardBetails,
      second: overview.premiumBetails,
      firstLabel: 'Standard',
      secondLabel: 'Premium',
      description: 'Répartition par qualité, tous emplacements confondus.',
    };
  const overviewDots = useMemo(
    () => createOverviewDots(livestockOverview.first, livestockOverview.second),
    [livestockOverview.first, livestockOverview.second],
  );
  const livestockRowsCount = getOverviewRowsCount(overview.totalBetails);
  const livestockDotRadius = Math.max(
    1.15,
    Math.min(2.6, (64 / Math.max(1, livestockRowsCount - 1)) * 0.43),
  );

  const getProfile = (id) => results.profileMap.get(String(id || '')) || null;
  const getProfileName = (id) => getProfile(id)?.username || 'Utilisateur inconnu';
  const getFarm = (id) => {
    const numericId = Number(id);
    if (!Number.isFinite(numericId)) return null;
    return results.farmMap.get(numericId) || null;
  };
  const getFarmName = (id) => {
    const farm = getFarm(id);
    if (farm?.name) return farm.name;
    return id != null ? `Ferme #${id}` : 'Aucune ferme';
  };
  const getRoleLabel = (userRow) => {
    const role = String(userRow?.role || '').trim();
    const roleInGame = String(userRow?.role_ingame || '').trim();
    return role || roleInGame || '-';
  };

  const hasResults = totalCount > 0;
  const suggestions = suggestionsQuery.data || [];

  const handleSubmit = (event) => {
    event.preventDefault();
    const nextQuery = searchInput.trim();
    if (!nextQuery || !hasActiveFilter) return;
    setSubmittedQuery(nextQuery);
    setSelectedBetail(null);
    closeFarmModal();
    setSelectedUser(null);
    setIsSearchVisible(false);
  };

  const handleResetSearch = () => {
    setIsSearchVisible(true);
    setIsDuplicateDetectionVisible(false);
    setSelectedBetail(null);
    farmRequestRef.current += 1;
    setSelectedFarm(null);
    setSelectedUser(null);
  };

  const handleSelectSuggestion = (suggestion) => {
    const nextQuery = String(suggestion?.searchTerm || '').trim();
    if (!nextQuery) return;
    setSearchInput(nextQuery);
    setSubmittedQuery(nextQuery);
    setSelectedBetail(null);
    closeFarmModal();
    setSelectedUser(null);
    setIsSearchVisible(false);
  };

  const handleFilterChange = (key) => {
    setFilters((current) => ({
      ...current,
      [key]: !current[key],
    }));
  };

  const openUserModal = (userRow) => {
    setSelectedUser(userRow);
    setMoneyDraft(String(userRow?.money ?? 0));
    setRoleDraft(normalizeAdminRole(userRow));
    setRoleMenuOpen(false);
    setUserActionFeedback(null);
  };

  const closeUserModal = () => {
    if (deletePhaseRef.current !== 'idle' || banFlow.isOpen) return;
    setSelectedUser(null);
    setRoleMenuOpen(false);
    setUserActionFeedback(null);
  };

  const closeBanFlow = () => {
    if (userActionBusy === 'ban') return;
    setBanFlow({ isOpen: false, target: null, error: '' });
  };

  const stopDeleteSounds = () => {
    [deleteIntroAudioRef, deleteLoopAudioRef, deleteFinalAudioRef].forEach((audioRef) => {
      if (!audioRef.current) return;
      audioRef.current.pause();
      audioRef.current.onended = null;
      try {
        audioRef.current.currentTime = 0;
      } catch {
        // Le navigateur peut refuser le seek avant le chargement des metadonnees.
      }
    });
  };

  const openDeleteConfirmation = () => {
    if (!selectedUser || selectedUser.id === user?.id) {
      setUserActionFeedback({ type: 'error', message: 'Tu ne peux pas supprimer ton propre compte.' });
      return;
    }

    stopDeleteSounds();
    const target = { ...selectedUser };
    deletePhaseRef.current = 'warning';
    setDeleteFlow({ ...EMPTY_DELETE_FLOW, phase: 'warning', target });

    const introAudio = createSafeAudio(deletePromptIntro, { preload: 'auto' });
    const loopAudio = createSafeAudio(deletePromptLoop, { preload: 'auto' });
    loopAudio.loop = true;
    deleteIntroAudioRef.current = introAudio;
    deleteLoopAudioRef.current = loopAudio;
    introAudio.onended = () => {
      if (deletePhaseRef.current === 'warning') void restartAudioSafely(loopAudio);
    };
    void restartAudioSafely(introAudio);
  };

  const closeDeleteFlow = () => {
    if (deletePhaseRef.current === 'deleting' || deletePhaseRef.current === 'finalizing') return;
    stopDeleteSounds();
    if (deleteProgressTimerRef.current) window.clearInterval(deleteProgressTimerRef.current);
    if (deleteSuccessTimerRef.current) window.clearInterval(deleteSuccessTimerRef.current);
    deletePhaseRef.current = 'idle';
    setDeleteFlow(EMPTY_DELETE_FLOW);
  };

  const startFinalDeleteSound = async () => {
    const finalAudio = createSafeAudio(deleteSuccessSound, { preload: 'auto' });
    deleteFinalAudioRef.current = finalAudio;
    await restartAudioSafely(finalAudio);
    return finalAudio;
  };

  const waitForFinalDeleteSoundCue = (audio) => new Promise((resolve) => {
    const fallbackStartedAt = performance.now();
    deleteSuccessTimerRef.current = window.setInterval(() => {
      const audioReachedCue = Number(audio?.currentTime || 0) >= 5.3;
      const fallbackReached = performance.now() - fallbackStartedAt >= 7000;
      if (!audioReachedCue && !fallbackReached) return;
      window.clearInterval(deleteSuccessTimerRef.current);
      deleteSuccessTimerRef.current = null;
      resolve();
    }, 25);
  });

  const handleDeleteAccount = async () => {
    const target = deleteFlow.target;
    const expectedUsername = String(target?.username || '').trim();
    if (!target || deleteFlow.confirmation.trim() !== expectedUsername) return;
    if (target.id === user?.id) {
      setDeleteFlow((current) => ({ ...current, error: 'Ton propre compte ne peut pas être supprimé.' }));
      return;
    }

    deleteIntroAudioRef.current?.pause();
    deleteLoopAudioRef.current?.pause();
    const finalAudio = await startFinalDeleteSound();
    const finalSoundCue = waitForFinalDeleteSoundCue(finalAudio);
    deletePhaseRef.current = 'deleting';
    setDeleteFlow((current) => ({ ...current, phase: 'deleting', progress: 7, error: '' }));

    deleteProgressTimerRef.current = window.setInterval(() => {
      setDeleteFlow((current) => {
        if (current.phase !== 'deleting') return current;
        const increment = current.progress < 55 ? 7 : current.progress < 78 ? 3 : 1;
        return { ...current, progress: Math.min(88, current.progress + increment) };
      });
    }, 420);

    try {
      const { data, error } = await supabase.rpc('admin_delete_user_account_reborn', {
        p_user_id: target.id,
      });
      if (error || !data?.success) {
        throw new Error(data?.reason || error?.message || 'DELETE_FAILED');
      }

      const avatarCleanup = await cleanupDeletedUserAvatarFiles(target.id);
      const completedResult = { ...data, ...avatarCleanup };

      if (deleteProgressTimerRef.current) window.clearInterval(deleteProgressTimerRef.current);
      deletePhaseRef.current = 'finalizing';
      setDeleteFlow((current) => ({
        ...current,
        phase: 'finalizing',
        progress: 92,
        result: completedResult,
      }));

      await finalSoundCue;
      deletePhaseRef.current = 'success';
      setDeleteFlow((current) => ({ ...current, phase: 'success', progress: 100 }));
      setSelectedUser(null);
      void searchQuery.refetch();
    } catch (error) {
      if (deleteProgressTimerRef.current) window.clearInterval(deleteProgressTimerRef.current);
      if (deleteSuccessTimerRef.current) window.clearInterval(deleteSuccessTimerRef.current);
      deleteFinalAudioRef.current?.pause();
      deletePhaseRef.current = 'error';
      const rawMessage = String(error?.message || '');
      const message = rawMessage.includes('SELF_DELETE_FORBIDDEN')
        ? 'Ton propre compte ne peut pas être supprimé.'
        : 'La suppression a échoué. Aucune modification n’a été conservée.';
      setDeleteFlow((current) => ({ ...current, phase: 'error', progress: 0, error: message }));
    }
  };

  const openSelectedUserProfile = () => {
    const username = String(selectedUser?.username || '').trim();
    if (!username) return;
    navigate(`/community/profile/${encodeURIComponent(username)}`);
  };

  const applySelectedUserPatch = (patch) => {
    setSelectedUser((current) => (current ? { ...current, ...patch } : current));
    void searchQuery.refetch();
  };

  const showUserActionToast = (type, message) => {
    window.dispatchEvent(new CustomEvent('farmgestion-toast', { detail: { type, message } }));
  };

  const handleResetUserAvatar = async () => {
    if (!selectedUser?.id || userActionBusy) return;
    setUserActionBusy('avatar');
    setUserActionFeedback(null);
    try {
      const { data, error } = await supabase.rpc('admin_reset_user_avatar_reborn', {
        p_user_id: selectedUser.id,
      });
      if (error || !data?.success) throw error || new Error('Réinitialisation refusée.');

      applySelectedUserPatch({
        avatar_url: null,
        updated_at: data.updated_at || selectedUser.updated_at,
      });
      const message = 'Photo de profil remplacée par la photo standard.';
      setUserActionFeedback({ type: 'success', message });
      showUserActionToast('success', message);
    } catch {
      const message = 'La photo de profil n’a pas pu être réinitialisée.';
      setUserActionFeedback({ type: 'error', message });
      showUserActionToast('error', message);
    } finally {
      setUserActionBusy('');
    }
  };

  const invokeAdminUserAccountAction = async (action, target, extra = {}) => {
    const { data, error } = await supabase.functions.invoke('admin-user-account-action', {
      body: {
        action,
        userId: target.id,
        ...extra,
      },
    });
    if (error || !data?.success) throw error || new Error(data?.error || 'Action refusée.');
    return data;
  };

  const handleSendPasswordReset = async () => {
    if (!selectedUser?.id || userActionBusy) return;
    setUserActionBusy('password');
    setUserActionFeedback(null);
    try {
      const data = await invokeAdminUserAccountAction('reset_password', selectedUser, {
        redirectTo: `${window.location.origin}/reset-password`,
      });
      const email = String(data.email || selectedUser.email || '').trim();
      const message = `Lien de récupération envoyé à ${email}.`;
      setUserActionFeedback({ type: 'success', message });
      showUserActionToast('success', message);
    } catch {
      const message = 'Le lien de récupération n’a pas pu être envoyé.';
      setUserActionFeedback({ type: 'error', message });
      showUserActionToast('error', message);
    } finally {
      setUserActionBusy('');
    }
  };

  const openBanConfirmation = () => {
    if (!selectedUser) return;
    if (selectedUser.id === user?.id) {
      const message = 'Tu ne peux pas bannir ton propre compte.';
      setUserActionFeedback({ type: 'error', message });
      showUserActionToast('error', message);
      return;
    }
    setBanFlow({ isOpen: true, target: { ...selectedUser }, error: '' });
  };

  const handleBanAccount = async () => {
    const target = banFlow.target;
    if (!target || userActionBusy) return;
    setUserActionBusy('ban');
    setBanFlow((current) => ({ ...current, error: '' }));
    try {
      await invokeAdminUserAccountAction('ban', target);
      const message = `Le compte de ${target.username || 'cet utilisateur'} a été banni.`;
      applySelectedUserPatch({ banned_until: true });
      setUserActionFeedback({ type: 'success', message });
      showUserActionToast('success', message);
      setBanFlow({ isOpen: false, target: null, error: '' });
    } catch (error) {
      const selfBanBlocked = String(error?.message || '').includes('SELF_BAN_FORBIDDEN');
      const message = selfBanBlocked
        ? 'Tu ne peux pas bannir ton propre compte.'
        : 'Le compte n’a pas pu être banni.';
      setBanFlow((current) => ({ ...current, error: message }));
      setUserActionFeedback({ type: 'error', message });
      showUserActionToast('error', message);
    } finally {
      setUserActionBusy('');
    }
  };

  const handleSaveMoney = async (event) => {
    event.preventDefault();
    const rawMoney = moneyDraft.trim();
    const nextMoney = Number(rawMoney);
    if (!/^\d+$/.test(rawMoney) || !Number.isSafeInteger(nextMoney) || nextMoney > 2147483647) {
      setUserActionFeedback({ type: 'error', message: 'Saisis un solde entier compris entre 0 et 2 147 483 647.' });
      return;
    }

    setSavingUserField('money');
    setUserActionFeedback(null);
    try {
      const { data, error } = await supabase.rpc('admin_set_user_money_reborn', {
        p_user_id: selectedUser.id,
        p_money: nextMoney,
      });
      if (error || !data?.success) throw error || new Error('Invalid response');

      const savedMoney = Number(data.money ?? nextMoney);
      setMoneyDraft(String(savedMoney));
      applySelectedUserPatch({ money: savedMoney, updated_at: data.updated_at || selectedUser.updated_at });
      setUserActionFeedback({ type: 'success', message: 'Le solde a été mis à jour.' });
    } catch {
      setUserActionFeedback({ type: 'error', message: 'Le solde n’a pas pu être modifié.' });
    } finally {
      setSavingUserField('');
    }
  };

  const handleSaveRole = async (event) => {
    event.preventDefault();
    if (selectedUser.id === user?.id) {
      setUserActionFeedback({ type: 'error', message: 'Tu ne peux pas modifier ton propre rôle.' });
      return;
    }

    setSavingUserField('role');
    setUserActionFeedback(null);
    try {
      const { data, error } = await supabase.rpc('admin_set_user_role_reborn', {
        p_user_id: selectedUser.id,
        p_role: roleDraft,
      });
      if (error || !data?.success) throw error || new Error('Invalid response');

      applySelectedUserPatch({
        role: data.role ?? null,
        role_ingame: null,
        updated_at: data.updated_at || selectedUser.updated_at,
      });
      setRoleDraft(data.role || 'STANDARD');
      setUserActionFeedback({ type: 'success', message: 'Le rôle a été mis à jour.' });
    } catch {
      setUserActionFeedback({ type: 'error', message: 'Le rôle n’a pas pu être modifié.' });
    } finally {
      setSavingUserField('');
    }
  };

  const openDuplicateBetail = async (betailId) => {
    const { data, error } = await supabase
      .from('betails')
      .select('id,matricule,name,avatar_url,farm_id,farm_site,age,premium,comments,author_id,owner_id,created_at,like_count,purchased_at,visible,invisible_reason,invisible_at,equipped_badges,admin_reward_badge_ids')
      .eq('id', betailId)
      .maybeSingle();
    if (!error && data) setSelectedBetail(data);
  };

  const openFarmModal = async (farmRow) => {
    const farmId = Number(farmRow?.id);
    if (!Number.isFinite(farmId)) return;
    const requestId = farmRequestRef.current + 1;
    farmRequestRef.current = requestId;

    setSelectedFarm({ ...farmRow, betails: [], isLoadingDetails: true, detailsError: false });
    try {
      const [farmResponse, betailsResponse] = await Promise.all([
        supabase
          .from('farms_list')
          .select('id,name,creation_date,proprietaire,state,visible,site_colors,center_style,equipped_badges')
          .eq('id', farmId)
          .maybeSingle(),
        supabase
          .from('betails')
          .select('id,matricule,name,avatar_url,farm_id,farm_site,age,premium,comments,author_id,owner_id,created_at,like_count,purchased_at,visible,invisible_reason,invisible_at,equipped_badges,admin_reward_badge_ids')
          .eq('farm_id', farmId)
          .order('name', { ascending: true }),
      ]);
      if (farmResponse.error || !farmResponse.data) throw farmResponse.error || new Error('Ferme introuvable.');
      if (betailsResponse.error) throw betailsResponse.error;
      if (farmRequestRef.current !== requestId) return;

      setSelectedFarm({
        ...farmResponse.data,
        betails: betailsResponse.data || [],
        isLoadingDetails: false,
        detailsError: false,
      });
    } catch {
      if (farmRequestRef.current !== requestId) return;
      setSelectedFarm((current) => (
        current && Number(current.id) === farmId
          ? { ...current, betails: [], isLoadingDetails: false, detailsError: true }
          : current
      ));
    }
  };

  const closeFarmModal = () => {
    farmRequestRef.current += 1;
    setSelectedFarm(null);
  };

  const openFarmBetailDetails = (betail) => {
    closeFarmModal();
    setSelectedBetail(betail);
  };

  const openLinkedFarmModal = (farmId) => {
    const numericFarmId = Number(farmId);
    if (!Number.isFinite(numericFarmId)) return;
    const farm = getFarm(numericFarmId) || { id: numericFarmId, name: `Ferme #${numericFarmId}` };
    setSelectedBetail(null);
    setSelectedUser(null);
    void openFarmModal(farm);
  };

  const refreshSelectedBetail = async (betailId = selectedBetail?.id) => {
    if (!betailId) throw new Error('Bétail introuvable.');
    const { data, error } = await supabase
      .from('betails')
      .select('id,matricule,name,avatar_url,farm_id,farm_site,age,premium,comments,author_id,owner_id,created_at,like_count,purchased_at,visible,invisible_reason,invisible_at,equipped_badges,admin_reward_badge_ids')
      .eq('id', betailId)
      .maybeSingle();
    if (error || !data) throw error || new Error('Bétail introuvable après mise à jour.');
    setSelectedBetail(data);
    return data;
  };

  const showBetailActionToast = (type, message) => {
    window.dispatchEvent(new CustomEvent('farmgestion-toast', { detail: { type, message } }));
  };

  const runBetailAction = async ({ action, work, successMessage, errorMessage, afterSuccess, afterError }) => {
    if (!selectedBetail?.id || betailActionBusy) return;
    setBetailActionBusy(action);
    try {
      const result = await work(selectedBetail.id);
      await refreshSelectedBetail(selectedBetail.id);
      afterSuccess?.(result);
      showBetailActionToast('success', typeof successMessage === 'function' ? successMessage(result) : successMessage);
    } catch (error) {
      afterError?.(error);
      showBetailActionToast('error', errorMessage || error?.message || 'Action impossible.');
    } finally {
      setBetailActionBusy('');
    }
  };

  const handleResetBetailAvatar = () => runBetailAction({
    action: 'avatar',
    successMessage: 'Photo remplacée par la photo standard.',
    errorMessage: 'Impossible de réinitialiser la photo.',
    work: async (betailId) => {
      const avatarUrl = await uploadModerationDefaultBetailAvatar();
      const { error } = await supabase.rpc('moderate_betail_content_reborn', {
        p_betail_id: betailId,
        p_action: 'replace_photo',
        p_avatar_url: avatarUrl,
      });
      if (error) throw error;
    },
  });

  const handleSaveBetailComment = () => runBetailAction({
    action: 'comment',
    successMessage: 'Commentaire mis à jour.',
    errorMessage: 'Impossible de modifier le commentaire.',
    afterSuccess: () => setIsBetailCommentEditorOpen(false),
    work: async (betailId) => {
      const { data, error } = await supabase.rpc('admin_update_betail_comment_reborn', {
        p_betail_id: betailId,
        p_comment: betailCommentDraft,
      });
      if (error || !data?.success) throw error || new Error('Mise à jour refusée.');
    },
  });

  const handleResetBetailComment = () => runBetailAction({
    action: 'comment-reset',
    successMessage: 'Commentaire réinitialisé.',
    errorMessage: 'Impossible de réinitialiser le commentaire.',
    afterSuccess: () => {
      setBetailCommentDraft('');
      setIsBetailCommentEditorOpen(false);
    },
    work: async (betailId) => {
      const { error } = await supabase.rpc('moderate_betail_content_reborn', {
        p_betail_id: betailId,
        p_action: 'remove_comment',
      });
      if (error) throw error;
    },
  });

  const handleReleaseBetail = () => runBetailAction({
    action: 'release',
    successMessage: 'Bétail libéré et remis au registre public.',
    errorMessage: 'Impossible de libérer ce bétail.',
    work: async (betailId) => {
      const { data, error } = await supabase.rpc('admin_release_betail_reborn', { p_betail_id: betailId });
      if (error || !data?.success) throw error || new Error('Libération refusée.');
      return data;
    },
  });

  const handleToggleBetailVisibility = () => runBetailAction({
    action: 'visibility',
    successMessage: (result) => result?.visible ? 'Bétail rendu visible.' : 'Bétail rendu invisible.',
    errorMessage: 'Impossible de modifier la visibilité du bétail.',
    work: async (betailId) => {
      const nextVisible = !selectedBetail.visible;
      const { data, error } = await supabase.rpc('admin_set_betail_visibility_reborn', {
        p_betail_id: betailId,
        p_visible: nextVisible,
        p_invisible_reason: nextVisible ? null : 'Rendu invisible depuis la Centrale',
      });
      const result = Array.isArray(data) ? data[0] : data;
      if (error || !result?.success) throw error || new Error('Modification refusée.');
      return result;
    },
  });

  const finishPremiumTransition = () => {
    if (premiumTransitionTimerRef.current) window.clearTimeout(premiumTransitionTimerRef.current);
    setPremiumTransition('success');
    void restartAudioSafely(createSafeAudio(premiumSuccessSound, { volume: 0.48 }));
    premiumTransitionTimerRef.current = window.setTimeout(() => {
      setPremiumTransition('idle');
      premiumTransitionTimerRef.current = null;
    }, 1850);
  };

  const handleToggleBetailPremium = () => {
    const nextPremium = !selectedBetail?.premium;
    if (nextPremium) setPremiumTransition('running');
    runBetailAction({
      action: 'premium',
      successMessage: nextPremium ? 'Bétail transformé en Premium.' : 'Bétail repassé en Standard.',
      errorMessage: nextPremium ? 'Impossible de transformer ce bétail en Premium.' : 'Impossible de repasser ce bétail en Standard.',
      afterSuccess: () => {
        if (nextPremium) finishPremiumTransition();
      },
      afterError: () => {
        if (nextPremium) setPremiumTransition('idle');
      },
      work: async (betailId) => {
        const { data, error } = await supabase.rpc('admin_set_betail_premium_reborn', {
          p_betail_id: betailId,
          p_premium: nextPremium,
        });
        if (error || !data?.success) throw error || new Error('Modification refusée.');
        return data;
      },
    });
  };

  const selectedBetailBadges = useMemo(() => normalizeBadgeEntries(selectedBetail?.equipped_badges), [selectedBetail]);
  const selectedBetailRewardBadges = useMemo(() => normalizeBadgeEntries(selectedBetail?.admin_reward_badge_ids), [selectedBetail]);
  const selectedBetailFarmName = getFarmName(selectedBetail?.farm_id);
  const selectedBetailQuality = selectedBetail?.premium ? 'Premium' : 'Standard';
  const canOpenSelectedBetailProduct = isPublicRegisterBetail(selectedBetail);

  const mapBadgeDetails = (badge, index, scope) => {
    const id = String(badge?.badgeId || '').trim();
    const filename = String(badge?.filename || '').trim();
    const fallbackImageUrl = String(badge?.imageUrl || '').trim();
    const fallbackName = String(badge?.name || '').trim();
    const fallbackRarity = String(badge?.rarity || '').trim();

    const catalogRow =
      results.badgeCatalogMap.get(id)
      || results.badgeCatalogByFilenameMap.get(filename.toLowerCase())
      || null;

    if (!catalogRow && !fallbackImageUrl && !filename) {
      return {
        key: `${scope}-${id || fallbackName || index}`,
        scope,
        id: id || `badge-${index + 1}`,
        name: fallbackName || id || `Badge ${index + 1}`,
        rarity: '',
        rarityLabel: '',
        imageUrl: '',
      };
    }

    const rarity = String(catalogRow?.rarity || fallbackRarity).trim();
    const resolvedFilename = String(catalogRow?.filename || filename).trim();
    const imageUrl = fallbackImageUrl || getBadgeImageUrl(resolvedFilename, rarity);

    return {
      key: `${scope}-${id || resolvedFilename || fallbackName || index}`,
      scope,
      id: id || String(catalogRow?.id || resolvedFilename || `badge-${index + 1}`),
      name: String(catalogRow?.name || fallbackName || resolvedFilename || id || `Badge ${index + 1}`),
      rarity,
      rarityLabel: BADGE_RARITY_LABELS[rarity] || rarity,
      imageUrl,
    };
  };

  const selectedBetailBadgeDetails = useMemo(
    () => selectedBetailBadges.map((badge, index) => mapBadgeDetails(badge, index, 'equip')),
    [selectedBetailBadges, results.badgeCatalogMap, results.badgeCatalogByFilenameMap],
  );
  const selectedBetailRewardBadgeDetails = useMemo(
    () => selectedBetailRewardBadges.map((badge, index) => mapBadgeDetails(badge, index, 'reward')),
    [selectedBetailRewardBadges, results.badgeCatalogMap, results.badgeCatalogByFilenameMap],
  );
  const selectedBetailAllBadgeDetails = useMemo(
    () => [...selectedBetailBadgeDetails, ...selectedBetailRewardBadgeDetails],
    [selectedBetailBadgeDetails, selectedBetailRewardBadgeDetails],
  );
  const selectedFarmBadges = useMemo(
    () => normalizeBadgeEntries(selectedFarm?.equipped_badges),
    [selectedFarm],
  );
  const selectedFarmBadgeDetails = useMemo(
    () => selectedFarmBadges.map((badge, index) => mapBadgeDetails(badge, index, 'farm')),
    [selectedFarmBadges, results.badgeCatalogMap, results.badgeCatalogByFilenameMap],
  );
  const selectedFarmOwnerName = getProfileName(selectedFarm?.proprietaire);

  return (
    <main className="centrale-page">
      <div className="centrale-shell">
        <header className="centrale-heading">
          <div>
            <h1 className="centrale-title">Centrale  FarmGestion</h1>
            <p className="centrale-heading__copy">Administration générale de l'exploitation et de la gestion du bétail.</p>
          </div>
        </header>

        <section className="centrale-overview" aria-label="Repères de la communauté">
          <section className="centrale-overview__livestock" aria-labelledby="centrale-livestock-title">
            <div className="centrale-overview__head">
              <div>
                <h2 id="centrale-livestock-title">Vue d’ensemble de l'exploitation générale</h2>
                <p>{livestockOverview.description}</p>
              </div>
              <button
                type="button"
                className="centrale-overview__switch"
                onClick={() => setLivestockOverviewMode((mode) => (mode === 'ownership' ? 'quality' : 'ownership'))}
              >
                {livestockOverviewMode === 'ownership' ? 'Voir standard / premium' : 'Voir registre / ferme'}
              </button>
            </div>

            {overviewQuery.isError ? (
              <p className="centrale-overview__state">Les données ne sont pas disponibles pour le moment.</p>
            ) : (
              <div className={`centrale-livestock-figure is-${livestockOverviewMode}`}>
                <svg viewBox="0 0 200 132" role="img" aria-label={`${overview.totalBetails} bétails au total`}>
                  {overviewDots.map((dot) => (
                    <circle key={dot.key} className={`centrale-livestock-dot is-${dot.tone}`} cx={dot.x} cy={dot.y} r={livestockDotRadius} />
                  ))}
                </svg>
                <div className="centrale-livestock-total">
                  <strong>{overviewQuery.isLoading ? '…' : overview.totalBetails}</strong>
                  <span>bétails au total</span>
                </div>
                <div className={`centrale-overview__legend is-${livestockOverviewMode}`}>
                  <span><i /> {livestockOverview.firstLabel} <b>{livestockOverview.first}</b></span>
                  <span><i /> {livestockOverview.secondLabel} <b>{livestockOverview.second}</b></span>
                </div>
              </div>
            )}
          </section>

          <section className="centrale-overview__users" aria-labelledby="centrale-users-title">
            <div>
              <h2 id="centrale-users-title">Utilisateurs inscrits</h2>
              <p>Nombre total de comptes actuellement inscrits sur FarmGestion.</p>
            </div>
            <div className="centrale-users-figure" role="img" aria-label={`${overview.totalUsers} utilisateurs inscrits`}>
              <svg className="centrale-users-figure__rays" viewBox="0 0 200 200" aria-hidden="true">
                {ACTIVITY_RAYS.map((ray) => (
                  <line
                    key={ray.key}
                    className={`is-${ray.tone}`}
                    x1={ray.x1}
                    y1={ray.y1}
                    x2={ray.x2}
                    y2={ray.y2}
                    style={{ '--ray-delay': ray.delay }}
                  />
                ))}
              </svg>
              <div className="centrale-users-figure__total">
                <strong>{overviewQuery.isLoading ? '…' : overview.totalUsers}</strong>
                <span>utilisateurs</span>
              </div>
            </div>
          </section>
        </section>

        {isDuplicateDetectionVisible ? (
        <Settings_AdminDuplicateBetailsPanel
          supabaseUrl={supabaseUrl}
          aiAvailable={aiAvailability === 'available'}
          onSelectBetail={openDuplicateBetail}
          onClose={() => {
            setIsDuplicateDetectionVisible(false);
            setIsSearchVisible(true);
          }}
        />
      ) : isSearchVisible ? (
        <form className="centrale-search-form" onSubmit={handleSubmit}>
          <label className="centrale-search" htmlFor="centrale-search-input">
            <Search size={18} />
            <input
              id="centrale-search-input"
              type="search"
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder="Nom, matricule, email, UUID, ID ferme..."
              autoComplete="off"
            />
          </label>

          {suggestionTerm ? (
            <div className="centrale-suggestions" role="listbox" aria-label="Suggestions de recherche">
              {suggestionsQuery.isFetching ? (
                <p className="centrale-suggestions__state">Recherche de suggestions…</p>
              ) : suggestionsQuery.isError ? (
                <p className="centrale-suggestions__state">Suggestions indisponibles.</p>
              ) : suggestions.length ? (
                suggestions.map((suggestion) => (
                  <button
                    key={suggestion.key}
                    type="button"
                    className="centrale-suggestion"
                    role="option"
                    onClick={() => handleSelectSuggestion(suggestion)}
                  >
                    <span className={`centrale-suggestion__type is-${suggestion.type.toLowerCase().replace('é', 'e')}`}>
                      {suggestion.type}
                    </span>
                    <span className="centrale-suggestion__label">{suggestion.label}</span>
                    <span className="centrale-suggestion__detail">{suggestion.detail}</span>
                  </button>
                ))
              ) : (
                <p className="centrale-suggestions__state">Aucune correspondance directe.</p>
              )}
            </div>
          ) : null}

          <div className="centrale-filters" role="group" aria-label="Filtres de recherche">
            <label>
              <input
                type="checkbox"
                checked={filters.betails}
                onChange={() => handleFilterChange('betails')}
              />
              Bétails
            </label>
            <label>
              <input
                type="checkbox"
                checked={filters.farms}
                onChange={() => handleFilterChange('farms')}
              />
              Fermes
            </label>
            <label>
              <input
                type="checkbox"
                checked={filters.users}
                onChange={() => handleFilterChange('users')}
              />
              Utilisateurs
            </label>
            <label>
              <input
                type="checkbox"
                checked={filters.commentKeywords}
                onChange={() => handleFilterChange('commentKeywords')}
              />
              Mots-clés commentaire
            </label>
          </div>

          <button
            type="submit"
            className="centrale-submit"
            disabled={!hasActiveFilter || !searchInput.trim() || searchQuery.isFetching}
          >
            {searchQuery.isFetching ? 'Recherche...' : 'Chercher'}
          </button>

          {!hasActiveFilter ? <p className="centrale-hint">Active au moins un filtre.</p> : null}

          <div className="centrale-tools">
            <p>Outils d’analyse</p>
            <button
              type="button"
              className="centrale-tool-button"
              onClick={() => setIsDuplicateDetectionVisible(true)}
              disabled={aiAvailability !== 'available'}
              title={aiAvailability === 'unavailable' ? 'Service IA indisponible' : ''}
            >
              <ScanSearch size={19} />
              {aiAvailability === 'checking' ? 'Vérification IA…' : 'Détection doublons'}
            </button>
            {aiAvailability === 'unavailable' ? <small className="centrale-tools__offline">Service IA indisponible</small> : null}
          </div>
        </form>
      ) : (
        <section className="centrale-results">
          <div className="centrale-results-head">
            <p>
              {searchQuery.isFetching
                ? 'Recherche en cours...'
                : `${totalCount} résultat${totalCount > 1 ? 's' : ''} pour "${effectiveQuery}"`}
            </p>
            <button type="button" className="centrale-reset" onClick={handleResetSearch}>
              Nouvelle recherche
            </button>
          </div>

          {searchQuery.isError ? (
            <p className="centrale-state is-error">Erreur pendant la recherche.</p>
          ) : null}

          {!searchQuery.isFetching && !hasResults ? (
            <p className="centrale-state">Aucun résultat trouvé.</p>
          ) : null}

          {!searchQuery.isFetching && hasResults ? (
            <>
              {results.betails.length ? (
                <section className="centrale-result-block">
                  <h2>Bétails</h2>
                  <div className="centrale-cards centrale-cards--betail">
                    {results.betails.map((betail) => (
                      <button
                        key={`b-${betail.id}`}
                        type="button"
                        className="centrale-card centrale-card--betail centrale-card--interactive"
                        onClick={() => setSelectedBetail(betail)}
                        aria-label={`Ouvrir les détails du bétail ${betail.name || 'sans nom'}`}
                      >
                        <div className="centrale-card-head">
                          <div className="centrale-betail-avatar">
                            {normalizeBetailAvatar(betail.avatar_url, supabaseUrl) ? (
                              <img src={normalizeBetailAvatar(betail.avatar_url, supabaseUrl)} alt={betail.name || 'Betail'} loading="lazy" />
                            ) : (
                              <span>{String(betail.name || '?').slice(0, 1).toUpperCase()}</span>
                            )}
                          </div>
                          <div>
                            <p className="centrale-card-title">
                              {betail.name || 'Sans nom'} {betail.premium ? <span className="centrale-premium-star">★</span> : null}
                            </p>
                            <p className="centrale-card-sub">{formatMatricule(betail.matricule)}</p>
                            <p className="centrale-card-sub">{betail.visible ? 'Visible' : 'Invisible'}</p>
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                </section>
              ) : null}

              {results.users.length ? (
                <section className="centrale-result-block">
                  <h2>Utilisateurs</h2>
                  <div className="centrale-cards centrale-cards--user">
                    {results.users.map((row) => (
                      <button
                        key={`u-${row.id}`}
                        type="button"
                        className="centrale-card centrale-card--user centrale-card--interactive"
                        onClick={() => openUserModal(row)}
                        aria-label={`Ouvrir les détails de l'utilisateur ${row.username || 'sans nom'}`}
                      >
                        <div className="centrale-card-head">
                          <div className="centrale-user-avatar" aria-hidden="true">
                            <AvatarMedia avatarUrl={row.avatar_url} alt="Avatar profil" />
                          </div>
                          <div>
                            <p className="centrale-card-title">{row.username || 'Utilisateur sans nom'}</p>
                            <p className="centrale-card-sub">Inscription: {formatDate(row.created_at)}</p>
                            <p className="centrale-card-sub">Dernière connexion: {formatDate(row.updated_at)}</p>
                            <p className="centrale-card-sub">Ferme: {getFarmName(row.farm_id)}</p>
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                </section>
              ) : null}

              {results.farms.length ? (
                <section className="centrale-result-block">
                  <h2>Fermes</h2>
                  <div className="centrale-cards centrale-cards--farm">
                    {results.farms.map((farm) => (
                      <button
                        key={`f-${farm.id}`}
                        type="button"
                        className="centrale-card centrale-card--farm centrale-card--interactive"
                        onClick={() => void openFarmModal(farm)}
                        aria-label={`Ouvrir les détails de la ferme ${farm.name || farm.id}`}
                      >
                        <div className="centrale-farm-preview-wrap">
                          <MiniFarmPreview
                            siteColors={farm.site_colors}
                            centerStyle={farm.center_style}
                            label={farm.name || String(farm.id)}
                          />
                        </div>
                        <div>
                          <p className="centrale-card-title">{farm.name || `Ferme #${farm.id}`}</p>
                          <p className="centrale-card-sub">Créée le: {formatDate(farm.creation_date)}</p>
                          <p className="centrale-card-sub">Propriétaire: {getProfileName(farm.proprietaire)}</p>
                        </div>
                      </button>
                    ))}
                  </div>
                </section>
              ) : null}
            </>
          ) : null}
        </section>
        )}
      </div>

      {selectedBetail ? (
        <div className="centrale-modal-overlay" onClick={() => setSelectedBetail(null)}>
          <article className={`centrale-modal centrale-betail-modal${premiumTransition !== 'idle' ? ` is-premium-${premiumTransition}` : ''}`} onClick={(event) => event.stopPropagation()}>
            {premiumTransition === 'success' ? (
              <div className="centrale-betail-modal__premium-confetti" aria-hidden="true">
                {Array.from({ length: 24 }, (_, index) => (
                  <i
                    key={index}
                    style={{
                      '--confetti-angle': `${index * 15}deg`,
                      '--confetti-distance': `${100 + (index % 6) * 16}px`,
                      '--confetti-delay': `${(index % 8) * 0.025}s`,
                      '--confetti-color': PREMIUM_CONFETTI_COLORS[index % PREMIUM_CONFETTI_COLORS.length],
                    }}
                  />
                ))}
              </div>
            ) : null}
            <header className="centrale-modal-head">
              <h3>Fiche bétail</h3>
              <button
                type="button"
                className="centrale-modal-close"
                onClick={() => setSelectedBetail(null)}
                aria-label="Fermer"
              >
                <X size={16} />
              </button>
            </header>

            <div className="centrale-modal-body">
              <div className="centrale-modal-hero centrale-betail-modal__identity">
                <div className="centrale-modal-avatar">
                  {normalizeBetailAvatar(selectedBetail.avatar_url, supabaseUrl) ? (
                    <img src={normalizeBetailAvatar(selectedBetail.avatar_url, supabaseUrl)} alt={selectedBetail.name || 'Betail'} loading="lazy" />
                  ) : (
                    <span>{String(selectedBetail.name || '?').slice(0, 1).toUpperCase()}</span>
                  )}
                </div>
                <div>
                  <p className="centrale-modal-title">
                    {selectedBetail.name || 'Sans nom'} {selectedBetail.premium ? <span className="centrale-premium-star">★</span> : null}
                  </p>
                  <p className="centrale-modal-sub">{formatMatricule(selectedBetail.matricule)}</p>
                </div>
                <button
                  type="button"
                  className="centrale-betail-modal__profile-link"
                  onClick={() => {
                    if (canOpenSelectedBetailProduct) navigate(`/betail-register/${selectedBetail.id}`);
                  }}
                  disabled={!canOpenSelectedBetailProduct}
                >
                  Voir la fiche publique
                </button>
              </div>

              <section className="centrale-betail-modal__section" aria-labelledby="centrale-betail-details-title">
                <h4 id="centrale-betail-details-title">Informations du bétail</h4>
                <dl className="centrale-betail-modal__details">
                <div><dt>Qualité</dt><dd>{selectedBetailQuality}</dd></div>
                <div><dt>Matricule</dt><dd>{formatMatricule(selectedBetail.matricule)}</dd></div>
                <div><dt>Achat</dt><dd>{selectedBetail.purchased_at ? formatDate(selectedBetail.purchased_at) : 'Non acheté'}</dd></div>
                <div><dt>Visibilité</dt><dd>{selectedBetail.visible ? 'Visible' : 'Invisible'}</dd></div>
                <div>
                  <dt>Ferme</dt>
                  <dd>
                    {selectedBetail.farm_id ? (
                      <button type="button" className="centrale-modal__linked-farm" onClick={() => openLinkedFarmModal(selectedBetail.farm_id)}>
                        {selectedBetailFarmName}
                      </button>
                    ) : 'Aucune ferme'}
                  </dd>
                </div>
                <div><dt>Propriétaire</dt><dd>{selectedBetail.owner_id ? getProfileName(selectedBetail.owner_id) : 'Aucun'}</dd></div>
                <div><dt>Auteur</dt><dd>{getProfileName(selectedBetail.author_id)}</dd></div>
                <div><dt>Likes</dt><dd>{selectedBetail.like_count ?? 0}</dd></div>
                <div><dt>Age</dt><dd>{selectedBetail.age ?? '-'}</dd></div>
                <div><dt>Création</dt><dd>{formatDate(selectedBetail.created_at)}</dd></div>
                <div><dt>Site ferme</dt><dd>{selectedBetail.farm_site || '-'}</dd></div>
                {!selectedBetail.visible ? (
                  <>
                    <div><dt>Raison invisibilité</dt><dd>{selectedBetail.invisible_reason || '-'}</dd></div>
                    <div><dt>Invisible le</dt><dd>{selectedBetail.invisible_at ? formatDate(selectedBetail.invisible_at) : '-'}</dd></div>
                  </>
                ) : null}
                </dl>
              </section>

              <section className="centrale-betail-modal__section">
                <h4>Commentaire</h4>
                <p className="centrale-betail-modal__comment">{selectedBetail.comments || 'Aucun commentaire.'}</p>
                {isBetailCommentEditorOpen ? (
                  <div className="centrale-betail-modal__comment-editor">
                    <label htmlFor="centrale-betail-comment">Modifier le commentaire</label>
                    <textarea
                      id="centrale-betail-comment"
                      value={betailCommentDraft}
                      onChange={(event) => setBetailCommentDraft(event.target.value)}
                      disabled={Boolean(betailActionBusy)}
                      rows={4}
                    />
                    <div>
                      <button type="button" onClick={() => setIsBetailCommentEditorOpen(false)} disabled={Boolean(betailActionBusy)}>Annuler</button>
                      <button type="button" onClick={handleResetBetailComment} disabled={Boolean(betailActionBusy)}>
                        {betailActionBusy === 'comment-reset' ? 'Réinitialisation…' : 'Réinitialiser'}
                      </button>
                      <button type="button" onClick={handleSaveBetailComment} disabled={Boolean(betailActionBusy)}>
                        {betailActionBusy === 'comment' ? 'Enregistrement…' : 'Enregistrer'}
                      </button>
                    </div>
                  </div>
                ) : null}
              </section>

              <section className="centrale-betail-modal__section">
                <h4>Badges</h4>
                {selectedBetailAllBadgeDetails.length ? (
                  <div className="centrale-badge-grid centrale-betail-modal__badges">
                    {selectedBetailAllBadgeDetails.map((badge) => (
                      <article
                        key={badge.key}
                        className={`centrale-badge-card centrale-betail-modal__badge ${badge.rarity ? `is-${badge.rarity}` : ''}`}
                        data-origin={badge.scope === 'reward' ? 'Attribué par l’administration' : 'Badge équipé'}
                        tabIndex={0}
                      >
                        {badge.imageUrl ? (
                          <img src={badge.imageUrl} alt={badge.name} loading="lazy" />
                        ) : (
                          <span className="centrale-badge-card__fallback">?</span>
                        )}
                        <p className="centrale-badge-card__name">{badge.name}</p>
                        <p className="centrale-badge-card__meta">{badge.rarityLabel || badge.id}</p>
                      </article>
                    ))}
                  </div>
                ) : (
                  <p>-</p>
                )}
              </section>

              <section className="centrale-betail-modal__section" aria-labelledby="centrale-betail-actions-title">
                <h4 id="centrale-betail-actions-title">Actions de gestion</h4>
                <div className="centrale-betail-modal__future-actions">
                  <button type="button" onClick={handleResetBetailAvatar} disabled={Boolean(betailActionBusy)}>
                    <span>Réinitialiser la photo de profil</span><small>{betailActionBusy === 'avatar' ? 'Traitement…' : 'Photo standard'}</small>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setBetailCommentDraft(selectedBetail.comments || '');
                      setIsBetailCommentEditorOpen(true);
                    }}
                    disabled={Boolean(betailActionBusy)}
                  >
                    <span>Réinitialiser ou modifier le commentaire</span><small>Modifier</small>
                  </button>
                  <button type="button" className="is-warning" onClick={handleReleaseBetail} disabled={Boolean(betailActionBusy)}>
                    <span>Libérer le bétail</span><small>{betailActionBusy === 'release' ? 'Traitement…' : 'Registre public'}</small>
                  </button>
                  <button type="button" className="is-warning" onClick={handleToggleBetailVisibility} disabled={Boolean(betailActionBusy)}>
                    <span>{selectedBetail.visible ? 'Rendre invisible' : 'Rendre visible'}</span><small>{betailActionBusy === 'visibility' ? 'Traitement…' : 'Modération'}</small>
                  </button>
                  <button type="button" className="is-premium" onClick={handleToggleBetailPremium} disabled={Boolean(betailActionBusy)}>
                    <span>{selectedBetail.premium ? 'Transformer en Standard' : 'Transformer en Premium'}</span>
                    <small>{betailActionBusy === 'premium' ? 'Transformation…' : (selectedBetail.premium ? 'Qualité actuelle : Premium' : 'Qualité actuelle : Standard')}</small>
                  </button>
                  <button type="button" disabled><span>Relocaliser le bétail</span><small>À venir</small></button>
                </div>
              </section>

              <section className="centrale-betail-modal__technical" aria-labelledby="centrale-betail-technical-title">
                <h4 id="centrale-betail-technical-title">Identifiant technique</h4>
                <code>{selectedBetail.id}</code>
              </section>
            </div>

          </article>
        </div>
      ) : null}

      {selectedFarm ? (
        <div className="centrale-modal-overlay" onClick={closeFarmModal}>
          <article className="centrale-modal centrale-farm-modal" onClick={(event) => event.stopPropagation()}>
            <header className="centrale-modal-head">
              <h3>Fiche ferme</h3>
              <button
                type="button"
                className="centrale-modal-close"
                onClick={closeFarmModal}
                aria-label="Fermer"
              >
                <X size={16} />
              </button>
            </header>

            <div className="centrale-modal-body">
              <div className="centrale-farm-modal__showcase">
                <FarmDesignPreview
                  farmLabel={selectedFarm.name || `Ferme #${selectedFarm.id}`}
                  siteColorsRaw={selectedFarm.site_colors}
                  centerStyleRaw={selectedFarm.center_style}
                  rotate
                  className="centrale-farm-modal__design"
                  maxSize={330}
                  minHeight={300}
                />
                <div className="centrale-farm-modal__identity">
                  <p className="centrale-modal-title">{selectedFarm.name || `Ferme #${selectedFarm.id}`}</p>
                  <p className="centrale-modal-sub">Propriétaire : {selectedFarm.proprietaire ? selectedFarmOwnerName : 'Aucun'}</p>
                  <div className="centrale-farm-modal__status" aria-label="Statut de la ferme">
                    <span>{selectedFarm.visible ? 'Publique' : 'Privée'}</span>
                    <span>{selectedFarm.isLoadingDetails ? 'Chargement…' : `${selectedFarm.betails?.length || 0} bétail${(selectedFarm.betails?.length || 0) > 1 ? 'x' : ''}`}</span>
                  </div>
                </div>
              </div>

              {selectedFarm.detailsError ? (
                <p className="centrale-farm-modal__error" role="alert">Les détails de cette ferme n’ont pas pu être chargés.</p>
              ) : null}

              <section className="centrale-farm-modal__section" aria-labelledby="centrale-farm-details-title">
                <h4 id="centrale-farm-details-title">Informations de la ferme</h4>
                <dl className="centrale-farm-modal__details">
                  <div><dt>Propriétaire</dt><dd>{selectedFarm.proprietaire ? selectedFarmOwnerName : 'Aucun'}</dd></div>
                  <div><dt>Visibilité</dt><dd>{selectedFarm.visible ? 'Publique' : 'Privée'}</dd></div>
                  <div><dt>Création</dt><dd>{formatDate(selectedFarm.creation_date)}</dd></div>
                  <div><dt>État interne</dt><dd>{selectedFarm.state || '-'}</dd></div>
                  <div><dt>Bétails présents</dt><dd>{selectedFarm.isLoadingDetails ? '…' : selectedFarm.betails?.length || 0}</dd></div>
                  <div><dt>Identifiant</dt><dd>#{selectedFarm.id}</dd></div>
                </dl>
              </section>

              <section className="centrale-farm-modal__section" aria-labelledby="centrale-farm-badges-title">
                <h4 id="centrale-farm-badges-title">Badges équipés</h4>
                {selectedFarmBadgeDetails.length ? (
                  <div className="centrale-badge-grid centrale-farm-modal__badges">
                    {selectedFarmBadgeDetails.map((badge) => (
                      <article key={badge.key} className={`centrale-badge-card ${badge.rarity ? `is-${badge.rarity}` : ''}`}>
                        {badge.imageUrl ? (
                          <img src={badge.imageUrl} alt={badge.name} loading="lazy" />
                        ) : (
                          <span className="centrale-badge-card__fallback">?</span>
                        )}
                        <p className="centrale-badge-card__name">{badge.name}</p>
                        <p className="centrale-badge-card__meta">{badge.rarityLabel || badge.id}</p>
                      </article>
                    ))}
                  </div>
                ) : (
                  <p className="centrale-farm-modal__empty">Aucun badge équipé.</p>
                )}
              </section>

              <section className="centrale-farm-modal__section" aria-labelledby="centrale-farm-betails-title">
                <h4 id="centrale-farm-betails-title">Bétails de la ferme</h4>
                {selectedFarm.isLoadingDetails ? (
                  <p className="centrale-farm-modal__empty">Chargement du bétail…</p>
                ) : selectedFarm.betails?.length ? (
                  <div className="centrale-farm-modal__betails">
                    {selectedFarm.betails.map((betail) => (
                      <button
                        key={betail.id}
                        type="button"
                        className="centrale-farm-modal__betail"
                        onClick={() => openFarmBetailDetails(betail)}
                        aria-label={`Ouvrir la fiche de ${betail.name || 'ce bétail'}`}
                      >
                        <span className="centrale-farm-modal__betail-avatar">
                          {normalizeBetailAvatar(betail.avatar_url, supabaseUrl) ? (
                            <img src={normalizeBetailAvatar(betail.avatar_url, supabaseUrl)} alt="" loading="lazy" />
                          ) : (
                            <span>{String(betail.name || '?').slice(0, 1).toUpperCase()}</span>
                          )}
                        </span>
                        <span className="centrale-farm-modal__betail-copy">
                          <strong>{betail.name || 'Sans nom'} {betail.premium ? <i aria-label="Premium">★</i> : null}</strong>
                          <small>{formatMatricule(betail.matricule)}</small>
                        </span>
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="centrale-farm-modal__empty">Cette ferme ne contient aucun bétail.</p>
                )}
              </section>

              <section className="centrale-farm-modal__section" aria-labelledby="centrale-farm-actions-title">
                <h4 id="centrale-farm-actions-title">Actions de gestion</h4>
                <div className="centrale-farm-modal__future-actions">
                  <button type="button" disabled><span>Supprimer la photo de la ferme</span><small>À venir</small></button>
                  <button type="button" disabled><span>Renommer la ferme</span><small>À venir</small></button>
                  <button type="button" disabled><span>{selectedFarm.visible ? 'Rendre la ferme privée' : 'Rendre la ferme publique'}</span><small>À venir</small></button>
                </div>
              </section>
            </div>
          </article>
        </div>
      ) : null}

      {selectedUser ? (
        <div className="centrale-modal-overlay" onClick={closeUserModal}>
          <article className="centrale-modal centrale-user-modal" onClick={(event) => event.stopPropagation()}>
            <header className="centrale-modal-head">
              <h3>Fiche utilisateur</h3>
              <button
                type="button"
                className="centrale-modal-close"
                onClick={closeUserModal}
                aria-label="Fermer"
              >
                <X size={16} />
              </button>
            </header>

            <div className="centrale-modal-body">
              <div className="centrale-modal-hero centrale-user-modal__identity">
                <div className="centrale-modal-avatar centrale-modal-avatar--user">
                  <AvatarMedia avatarUrl={selectedUser.avatar_url} alt={selectedUser.username || 'Utilisateur'} />
                </div>
                <div className="centrale-user-modal__identity-copy">
                  <p className="centrale-modal-title">{selectedUser.username || 'Utilisateur sans nom'}</p>
                  <p className="centrale-modal-sub">{selectedUser.email || '-'}</p>
                </div>
                <button
                  type="button"
                  className="centrale-user-modal__profile-link"
                  onClick={openSelectedUserProfile}
                  disabled={!String(selectedUser.username || '').trim()}
                >
                  Voir le profil public
                </button>
              </div>

              <section className="centrale-user-modal__section" aria-labelledby="centrale-user-account-title">
                <h4 id="centrale-user-account-title">Informations du compte</h4>
                <dl className="centrale-user-modal__details">
                  <div><dt>Rôle</dt><dd>{getRoleLabel(selectedUser)}</dd></div>
                  <div><dt>Solde</dt><dd className="centrale-user-modal__number">{Number(selectedUser.money ?? 0).toLocaleString('fr-FR')}</dd></div>
                  <div>
                    <dt>Ferme liée</dt>
                    <dd>
                      {selectedUser.farm_id ? (
                        <button type="button" className="centrale-modal__linked-farm" onClick={() => openLinkedFarmModal(selectedUser.farm_id)}>
                          {getFarmName(selectedUser.farm_id)}
                        </button>
                      ) : 'Aucune ferme'}
                    </dd>
                  </div>
                  <div><dt>Inscription</dt><dd>{formatDate(selectedUser.created_at)}</dd></div>
                  <div><dt>Profil mis à jour</dt><dd>{formatDate(selectedUser.updated_at)}</dd></div>
                </dl>
              </section>

              <section className="centrale-user-modal__section" aria-labelledby="centrale-user-actions-title">
                <h4 id="centrale-user-actions-title">Gestion du compte</h4>

                <form className="centrale-user-modal__setting" onSubmit={handleSaveMoney}>
                  <div className="centrale-user-modal__setting-copy">
                    <label htmlFor="centrale-user-money">Solde</label>
                    <span>Remplace le solde actuel du joueur.</span>
                  </div>
                  <div className="centrale-user-modal__setting-control">
                    <input
                      id="centrale-user-money"
                      type="number"
                      min="0"
                      max="2147483647"
                      step="1"
                      inputMode="numeric"
                      value={moneyDraft}
                      onChange={(event) => setMoneyDraft(event.target.value)}
                      disabled={Boolean(savingUserField)}
                    />
                    <button type="submit" disabled={Boolean(savingUserField)}>
                      {savingUserField === 'money' ? 'Enregistrement…' : 'Enregistrer'}
                    </button>
                  </div>
                </form>

                <form className="centrale-user-modal__setting" onSubmit={handleSaveRole}>
                  <div className="centrale-user-modal__setting-copy">
                    <span className="centrale-user-modal__setting-label">Rôle</span>
                    <span>Standard ne stocke aucun rôle en base.</span>
                  </div>
                  <div className="centrale-user-modal__setting-control">
                    <div className="centrale-user-modal__combobox" ref={roleMenuRef}>
                      <button
                        type="button"
                        className="centrale-user-modal__combobox-trigger"
                        aria-haspopup="listbox"
                        aria-expanded={roleMenuOpen}
                        onClick={() => setRoleMenuOpen((open) => !open)}
                        disabled={Boolean(savingUserField) || selectedUser.id === user?.id}
                      >
                        <span>{ADMIN_ROLE_OPTIONS.find((option) => option.value === roleDraft)?.label || 'Standard'}</span>
                        <ChevronDown size={16} aria-hidden="true" />
                      </button>
                      {roleMenuOpen ? (
                        <div className="centrale-user-modal__combobox-menu" role="listbox" aria-label="Rôle du joueur">
                          {ADMIN_ROLE_OPTIONS.map((option) => (
                            <button
                              key={option.value}
                              type="button"
                              role="option"
                              aria-selected={roleDraft === option.value}
                              className={roleDraft === option.value ? 'is-selected' : ''}
                              onClick={() => {
                                setRoleDraft(option.value);
                                setRoleMenuOpen(false);
                              }}
                            >
                              <span>{option.label}</span>
                              {roleDraft === option.value ? <Check size={15} aria-hidden="true" /> : null}
                            </button>
                          ))}
                        </div>
                      ) : null}
                    </div>
                    <button type="submit" disabled={Boolean(savingUserField) || selectedUser.id === user?.id}>
                      {savingUserField === 'role' ? 'Enregistrement…' : 'Enregistrer'}
                    </button>
                  </div>
                  {selectedUser.id === user?.id ? (
                    <span className="centrale-user-modal__self-note">Ton propre rôle ne peut pas être modifié ici.</span>
                  ) : null}
                </form>

                {userActionFeedback ? (
                  <div className={`centrale-user-modal__feedback is-${userActionFeedback.type}`} role="status">
                    {userActionFeedback.message}
                  </div>
                ) : null}
              </section>

              <section className="centrale-user-modal__section" aria-labelledby="centrale-user-future-actions-title">
                <h4 id="centrale-user-future-actions-title">Autres actions</h4>
                <div className="centrale-user-modal__future-actions">
                  <button type="button" onClick={handleResetUserAvatar} disabled={Boolean(userActionBusy)}>
                    <span>Réinitialiser la photo de profil</span><small>{userActionBusy === 'avatar' ? 'Réinitialisation…' : 'Photo standard'}</small>
                  </button>
                  <button type="button" onClick={handleSendPasswordReset} disabled={Boolean(userActionBusy)}>
                    <span>Envoyer un lien de récupération du mot de passe</span><small>{userActionBusy === 'password' ? 'Envoi…' : 'Par email'}</small>
                  </button>
                  <button type="button" className="is-danger" onClick={openBanConfirmation} disabled={Boolean(userActionBusy) || selectedUser.id === user?.id}>
                    <span>Bannir le compte</span><small>{selectedUser.id === user?.id ? 'Indisponible sur votre compte' : 'Bloquer la connexion'}</small>
                  </button>
                  <button
                    type="button"
                    className="is-danger"
                    onClick={openDeleteConfirmation}
                    disabled={selectedUser.id === user?.id}
                  >
                    <span>Supprimer définitivement le compte</span>
                    <small>{selectedUser.id === user?.id ? 'Indisponible sur votre compte' : 'Irréversible'}</small>
                  </button>
                </div>
              </section>

              <section className="centrale-user-modal__technical" aria-labelledby="centrale-user-technical-title">
                <h4 id="centrale-user-technical-title">Identifiant technique</h4>
                <code>{selectedUser.id}</code>
              </section>
            </div>
          </article>
        </div>
      ) : null}

      {banFlow.isOpen ? (
        <div className="centrale-modal-overlay centrale-delete-overlay" onClick={closeBanFlow}>
          <article
            className="centrale-delete-modal centrale-ban-modal"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="centrale-ban-title"
            onClick={(event) => event.stopPropagation()}
          >
            <header className="centrale-delete-modal__head">
              <span className="centrale-delete-modal__icon" aria-hidden="true"><AlertTriangle size={20} /></span>
              <div>
                <h3 id="centrale-ban-title">Bannir ce compte ?</h3>
                <p>La personne ne pourra plus se connecter à FarmGestion. Cette action pourra être annulée plus tard depuis les outils d’administration.</p>
              </div>
              <button type="button" className="centrale-modal-close" onClick={closeBanFlow} aria-label="Fermer">
                <X size={16} />
              </button>
            </header>

            <div className="centrale-delete-modal__target">
              <AvatarMedia avatarUrl={banFlow.target?.avatar_url} alt="" />
              <div>
                <strong>{banFlow.target?.username || 'Utilisateur sans nom'}</strong>
                <span>{banFlow.target?.email || banFlow.target?.id}</span>
              </div>
            </div>

            {banFlow.error ? <p className="centrale-delete-modal__error" role="alert">{banFlow.error}</p> : null}

            <footer className="centrale-delete-modal__actions">
              <button type="button" className="is-secondary" onClick={closeBanFlow} disabled={userActionBusy === 'ban'}>Annuler</button>
              <button type="button" className="is-danger" onClick={handleBanAccount} disabled={userActionBusy === 'ban'}>
                <AlertTriangle size={16} aria-hidden="true" />
                {userActionBusy === 'ban' ? 'Bannissement…' : 'Bannir le compte'}
              </button>
            </footer>
          </article>
        </div>
      ) : null}

      {deleteFlow.phase !== 'idle' ? (
        <div
          className="centrale-modal-overlay centrale-delete-overlay"
          onClick={deleteFlow.phase === 'warning' || deleteFlow.phase === 'error' || deleteFlow.phase === 'success' ? closeDeleteFlow : undefined}
        >
          <article
            className="centrale-delete-modal"
            role={deleteFlow.phase === 'warning' ? 'alertdialog' : 'dialog'}
            aria-modal="true"
            aria-labelledby="centrale-delete-title"
            onClick={(event) => event.stopPropagation()}
          >
            {deleteFlow.phase === 'warning' ? (
              <>
                <header className="centrale-delete-modal__head">
                  <span className="centrale-delete-modal__icon" aria-hidden="true"><AlertTriangle size={20} /></span>
                  <div>
                    <h3 id="centrale-delete-title">Supprimer définitivement ce compte ?</h3>
                    <p>Cette action est immédiate et ne pourra pas être annulée.</p>
                  </div>
                  <button type="button" className="centrale-modal-close" onClick={closeDeleteFlow} aria-label="Fermer">
                    <X size={16} />
                  </button>
                </header>

                <div className="centrale-delete-modal__target">
                  <AvatarMedia avatarUrl={deleteFlow.target?.avatar_url} alt="" />
                  <div>
                    <strong>{deleteFlow.target?.username || 'Utilisateur sans nom'}</strong>
                    <span>{deleteFlow.target?.email || deleteFlow.target?.id}</span>
                  </div>
                </div>

                <div className="centrale-delete-modal__consequences">
                  <h4>Conséquences de la suppression</h4>
                  <ul>
                    {ACCOUNT_DELETE_CONSEQUENCES.map((item) => <li key={item}>{item}</li>)}
                  </ul>
                </div>

                <label className="centrale-delete-modal__confirmation" htmlFor="centrale-delete-confirmation">
                  <span>Écris <strong>{deleteFlow.target?.username}</strong> pour confirmer</span>
                  <input
                    id="centrale-delete-confirmation"
                    type="text"
                    value={deleteFlow.confirmation}
                    onChange={(event) => setDeleteFlow((current) => ({ ...current, confirmation: event.target.value }))}
                    autoComplete="off"
                    spellCheck="false"
                    autoFocus
                  />
                </label>

                {deleteFlow.error ? <p className="centrale-delete-modal__error" role="alert">{deleteFlow.error}</p> : null}

                <footer className="centrale-delete-modal__actions">
                  <button type="button" className="is-secondary" onClick={closeDeleteFlow}>Annuler</button>
                  <button
                    type="button"
                    className="is-danger"
                    onClick={handleDeleteAccount}
                    disabled={deleteFlow.confirmation.trim() !== String(deleteFlow.target?.username || '').trim()}
                  >
                    <Trash2 size={16} aria-hidden="true" />
                    Supprimer le compte
                  </button>
                </footer>
              </>
            ) : null}

            {deleteFlow.phase === 'deleting' || deleteFlow.phase === 'finalizing' ? (
              <div className="centrale-delete-modal__progress-view">
                <div className="centrale-delete-modal__progress-icon" aria-hidden="true"><Trash2 size={22} /></div>
                <h3 id="centrale-delete-title">
                  {deleteFlow.phase === 'deleting' ? 'Suppression du compte…' : 'Finalisation…'}
                </h3>
                <p>Ne ferme pas cette page pendant l’opération.</p>
                <div
                  className="centrale-delete-modal__progress"
                  role="progressbar"
                  aria-label="Progression de la suppression"
                  aria-valuemin="0"
                  aria-valuemax="100"
                  aria-valuenow={deleteFlow.progress}
                >
                  <span style={{ width: `${deleteFlow.progress}%` }} />
                </div>
                <strong className="centrale-delete-modal__progress-value">{deleteFlow.progress} %</strong>
              </div>
            ) : null}

            {deleteFlow.phase === 'error' ? (
              <div className="centrale-delete-modal__result is-error">
                <span className="centrale-delete-modal__icon" aria-hidden="true"><AlertTriangle size={20} /></span>
                <h3 id="centrale-delete-title">Suppression interrompue</h3>
                <p>{deleteFlow.error}</p>
                <button type="button" onClick={closeDeleteFlow}>Fermer</button>
              </div>
            ) : null}

            {deleteFlow.phase === 'success' ? (
              <div className="centrale-delete-modal__result is-success">
                <span className="centrale-delete-modal__success-icon" aria-hidden="true"><Check size={22} /></span>
                <h3 id="centrale-delete-title">Compte supprimé</h3>
                <p>Le compte de <strong>{deleteFlow.target?.username}</strong> a été supprimé définitivement.</p>
                <dl>
                  <div><dt>Bétails libérés</dt><dd>{deleteFlow.result?.betails_released ?? 0}</dd></div>
                  <div><dt>Expéditions retirées</dt><dd>{deleteFlow.result?.shipping_deleted ?? 0}</dd></div>
                  <div><dt>Badges conservés sur les bétails</dt><dd>{deleteFlow.result?.badges_kept_on_betails ?? 0}</dd></div>
                </dl>
                {deleteFlow.result?.avatar_cleanup_warning ? (
                  <p className="centrale-delete-modal__cleanup-warning">
                    Le compte est supprimé, mais certains anciens fichiers d’avatar devront être nettoyés manuellement.
                  </p>
                ) : null}
                <button type="button" onClick={closeDeleteFlow}>Fermer</button>
              </div>
            ) : null}
          </article>
        </div>
      ) : null}
    </main>
  );
}

export default Settings_CentralePage;
