const DEFAULT_SITE_COLORS = ['#FFB3BA', '#BAFFC9', '#BAE1FF', '#FFFFBA', '#E0BBE4', '#FFDFBA'];

export const createHexagonPoints = (cx, cy, radius) => {
  const points = [];
  for (let i = 0; i < 6; i += 1) {
    const angle = (Math.PI / 3) * i - Math.PI / 2;
    points.push(`${cx + radius * Math.cos(angle)},${cy + radius * Math.sin(angle)}`);
  }
  return points.join(' ');
};

export const createTrianglePoints = (cx, cy, radius, siteIndex) => {
  const angle1 = (Math.PI / 3) * siteIndex - Math.PI / 2;
  const angle2 = (Math.PI / 3) * (siteIndex + 1) - Math.PI / 2;
  const x1 = cx + radius * Math.cos(angle1);
  const y1 = cy + radius * Math.sin(angle1);
  const x2 = cx + radius * Math.cos(angle2);
  const y2 = cy + radius * Math.sin(angle2);
  return `${cx},${cy} ${x1},${y1} ${x2},${y2}`;
};

export const parseMaybeJson = (value) => {
  if (value == null) return null;
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
};

const readNumber = (value, fallback = 0) => {
  const next = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(next) ? next : fallback;
};

export const normalizeSiteColors = (raw) => {
  const parsed = parseMaybeJson(raw);
  if (Array.isArray(parsed) && parsed.length) {
    return Array.from({ length: 6 }, (_, index) =>
      typeof parsed[index] === 'string' && parsed[index].trim().length ? parsed[index] : DEFAULT_SITE_COLORS[index],
    );
  }

  if (parsed && typeof parsed === 'object') {
    const source = Array.isArray(parsed.colors) ? parsed.colors : parsed;
    return Array.from({ length: 6 }, (_, index) => {
      const oneBased = index + 1;
      const value =
        source[index] ??
        source[String(index)] ??
        source[oneBased] ??
        source[String(oneBased)] ??
        source[`site_${oneBased}`] ??
        source[`site${oneBased}`] ??
        source[`color_${oneBased}`] ??
        source[`color${oneBased}`];
      return typeof value === 'string' && value.trim().length ? value : DEFAULT_SITE_COLORS[index];
    });
  }

  return DEFAULT_SITE_COLORS;
};

export const normalizeCenterStyle = (raw) => {
  const parsed = parseMaybeJson(raw);
  const fallback = {
    type: 'emoji',
    emoji: 'H',
    imageUrl: '',
    zoom: 1,
    position: { x: 0, y: 0 },
    textColor: '',
    backgroundColor: '',
  };
  if (!parsed || typeof parsed !== 'object') return fallback;

  const nestedValue = parseMaybeJson(parsed.value);
  const nestedPos = parseMaybeJson(parsed.position) || parseMaybeJson(parsed.imagePosition);

  const imageUrl =
    (parsed.type === 'image' && typeof parsed.value === 'string' && parsed.value.trim()) ||
    (typeof parsed.customImage === 'string' && parsed.customImage.trim()) ||
    (typeof parsed.image === 'string' && parsed.image.trim()) ||
    (typeof parsed.imageUrl === 'string' && parsed.imageUrl.trim()) ||
    (typeof parsed.url === 'string' && parsed.url.trim()) ||
    (nestedValue && typeof nestedValue === 'object' && typeof nestedValue.url === 'string' && nestedValue.url.trim()) ||
    '';

  const emoji =
    (typeof parsed.emoji === 'string' && parsed.emoji.trim()) ||
    (parsed.type === 'emoji' && typeof parsed.value === 'string' && parsed.value.trim()) ||
    fallback.emoji;

  const zoom = Math.min(
    3,
    Math.max(
      0.65,
      readNumber(
        parsed.zoom ??
          parsed.scale ??
          parsed.imageZoom ??
          parsed.centerZoom ??
          (nestedValue && typeof nestedValue === 'object' ? nestedValue.zoom : undefined),
        1,
      ),
    ),
  );

  const x = readNumber(
    parsed.x ??
      parsed.offsetX ??
      (nestedPos && typeof nestedPos === 'object' ? nestedPos.x : undefined),
    0,
  );
  const y = readNumber(
    parsed.y ??
      parsed.offsetY ??
      (nestedPos && typeof nestedPos === 'object' ? nestedPos.y : undefined),
    0,
  );

  return {
    type: imageUrl ? 'image' : 'emoji',
    emoji,
    imageUrl,
    zoom,
    position: { x, y },
    textColor: typeof parsed.textColor === 'string' ? parsed.textColor : '',
    backgroundColor: typeof parsed.backgroundColor === 'string' ? parsed.backgroundColor : '',
  };
};

