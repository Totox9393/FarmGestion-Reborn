import { useMemo, useState } from 'react';
import { createHexagonPoints, createTrianglePoints, normalizeCenterStyle, normalizeSiteColors } from './farmDesignUtils';
import './FarmDesignPreview.css';

const COLOR_PARSER_SENTINEL = '#010203';
let colorParserCanvasContext = null;

const clampChannel = (value) => Math.max(0, Math.min(255, Math.round(value)));

const toRgb = (r, g, b) => ({
  r: clampChannel(r),
  g: clampChannel(g),
  b: clampChannel(b),
});

const parseHexColor = (value) => {
  const hexMatch = value.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!hexMatch) return null;
  const hex = hexMatch[1];
  if (hex.length === 3) {
    return toRgb(
      Number.parseInt(`${hex[0]}${hex[0]}`, 16),
      Number.parseInt(`${hex[1]}${hex[1]}`, 16),
      Number.parseInt(`${hex[2]}${hex[2]}`, 16),
    );
  }
  return toRgb(
    Number.parseInt(hex.slice(0, 2), 16),
    Number.parseInt(hex.slice(2, 4), 16),
    Number.parseInt(hex.slice(4, 6), 16),
  );
};

const parseRgbPart = (value) => {
  const trimmed = value.trim();
  if (trimmed.endsWith('%')) {
    const percentage = Number.parseFloat(trimmed.slice(0, -1));
    if (Number.isNaN(percentage)) return Number.NaN;
    return (percentage / 100) * 255;
  }
  return Number.parseFloat(trimmed);
};

const parseRgbColor = (value) => {
  const rgbMatch = value.match(/^rgba?\((.+)\)$/i);
  if (!rgbMatch) return null;
  const parts = rgbMatch[1].split(',').map((part) => part.trim());
  if (parts.length < 3) return null;
  const r = parseRgbPart(parts[0]);
  const g = parseRgbPart(parts[1]);
  const b = parseRgbPart(parts[2]);
  if ([r, g, b].some((channel) => Number.isNaN(channel))) return null;
  return toRgb(r, g, b);
};

const hueToRgb = (p, q, t) => {
  let next = t;
  if (next < 0) next += 1;
  if (next > 1) next -= 1;
  if (next < 1 / 6) return p + (q - p) * 6 * next;
  if (next < 1 / 2) return q;
  if (next < 2 / 3) return p + (q - p) * (2 / 3 - next) * 6;
  return p;
};

const hslToRgb = (h, s, l) => {
  const hue = ((h % 360) + 360) % 360 / 360;
  if (s === 0) {
    const gray = l * 255;
    return toRgb(gray, gray, gray);
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return toRgb(
    hueToRgb(p, q, hue + 1 / 3) * 255,
    hueToRgb(p, q, hue) * 255,
    hueToRgb(p, q, hue - 1 / 3) * 255,
  );
};

const parseHslChannel = (value) => {
  const trimmed = value.trim();
  const raw = Number.parseFloat(trimmed);
  if (Number.isNaN(raw)) return Number.NaN;
  if (trimmed.endsWith('%') || raw > 1) return raw / 100;
  return raw;
};

const parseHslColor = (value) => {
  const hslMatch = value.match(/^hsla?\((.+)\)$/i);
  if (!hslMatch) return null;
  const parts = hslMatch[1].split(',').map((part) => part.trim());
  if (parts.length < 3) return null;
  const h = Number.parseFloat(parts[0]);
  const s = parseHslChannel(parts[1]);
  const l = parseHslChannel(parts[2]);
  if ([h, s, l].some((channel) => Number.isNaN(channel))) return null;
  return hslToRgb(h, Math.max(0, Math.min(1, s)), Math.max(0, Math.min(1, l)));
};

const parseRgbFromKnownFormats = (value) => parseHexColor(value) || parseRgbColor(value) || parseHslColor(value);

const getColorParserContext = () => {
  if (typeof document === 'undefined') return null;
  if (!colorParserCanvasContext) {
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    colorParserCanvasContext = canvas.getContext('2d');
  }
  return colorParserCanvasContext;
};

const parseCssColorToRgb = (colorValue) => {
  if (typeof colorValue !== 'string') return null;
  const normalizedValue = colorValue.trim().toLowerCase();
  if (!normalizedValue) return null;

  const knownFormat = parseRgbFromKnownFormats(normalizedValue);
  if (knownFormat) return knownFormat;

  const context = getColorParserContext();
  if (!context) return null;

  context.fillStyle = COLOR_PARSER_SENTINEL;
  context.fillStyle = normalizedValue;
  const parsedValue = (context.fillStyle || '').toLowerCase();
  if (!parsedValue) return null;
  if (parsedValue === COLOR_PARSER_SENTINEL && normalizedValue !== COLOR_PARSER_SENTINEL) return null;
  if (parsedValue === normalizedValue) return null;

  return parseRgbFromKnownFormats(parsedValue);
};

const channelToLinear = (value) => {
  const channel = value / 255;
  return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
};

const getRelativeLuminance = ({ r, g, b }) =>
  (0.2126 * channelToLinear(r)) + (0.7152 * channelToLinear(g)) + (0.0722 * channelToLinear(b));

const mixRgb = (source, target, factor) =>
  toRgb(
    source.r + (target.r - source.r) * factor,
    source.g + (target.g - source.g) * factor,
    source.b + (target.b - source.b) * factor,
  );

const rgbToCssString = ({ r, g, b }) => `rgb(${r}, ${g}, ${b})`;

const getInteractiveSiteColor = (colorValue) => {
  const rgb = parseCssColorToRgb(colorValue);
  if (!rgb) return colorValue;
  const luminance = getRelativeLuminance(rgb);
  const isDark = luminance < 0.45;
  const mixTarget = isDark ? { r: 255, g: 255, b: 255 } : { r: 0, g: 0, b: 0 };
  const mixFactor = isDark ? 0.24 : 0.2;
  return rgbToCssString(mixRgb(rgb, mixTarget, mixFactor));
};

const getReadableHintColor = (colorValue) => {
  const rgb = parseCssColorToRgb(colorValue);
  if (!rgb) return '#ffffff';
  return getRelativeLuminance(rgb) > 0.48 ? '#201a37' : '#ffffff';
};

const getSiteHintPosition = (cx, cy, radius, siteIndex, distanceRatio = 0.58) => {
  const angle = (Math.PI / 3) * (siteIndex + 0.5) - Math.PI / 2;
  return {
    x: cx + radius * distanceRatio * Math.cos(angle),
    y: cy + radius * distanceRatio * Math.sin(angle),
  };
};

function FarmDesignPreview({
  farmLabel = 'Farm',
  siteColorsRaw,
  centerStyleRaw,
  rotate = false,
  className = '',
  maxSize = 640,
  minHeight = 620,
  onSiteClick,
  onCenterClick,
  getSiteAriaLabel,
  centerAriaLabel,
  selectedSiteIndex = null,
  hoveredSiteIndex = null,
  onSiteHoverChange,
  siteHoverHint = 'Cliquer pour voir',
  onPointerDown,
}) {
  const [failedImageUrl, setFailedImageUrl] = useState('');

  const siteColors = useMemo(() => normalizeSiteColors(siteColorsRaw), [siteColorsRaw]);
  const centerStyle = useMemo(() => normalizeCenterStyle(centerStyleRaw), [centerStyleRaw]);
  const hasSiteInteraction = typeof onSiteClick === 'function';
  const hasCenterInteraction = typeof onCenterClick === 'function';
  const hasSiteHoverTracking = typeof onSiteHoverChange === 'function';
  const hasCenterImageFailed = Boolean(centerStyle.imageUrl) && failedImageUrl === centerStyle.imageUrl;

  const hoverHint = useMemo(() => {
    if (hoveredSiteIndex == null || hoveredSiteIndex < 0 || hoveredSiteIndex >= siteColors.length) return null;
    const baseColor = siteColors[hoveredSiteIndex];
    const highlightedColor = getInteractiveSiteColor(baseColor);
    return {
      ...getSiteHintPosition(100, 100, 88, hoveredSiteIndex),
      textColor: getReadableHintColor(highlightedColor),
    };
  }, [hoveredSiteIndex, siteColors]);

  return (
    <div
      className={`farm-design-preview ${rotate ? 'is-rotating' : ''} ${className}`.trim()}
      style={{ '--farm-design-size': `min(100%, ${maxSize}px)`, minHeight: `${minHeight}px` }}
      onPointerDown={onPointerDown}
    >
      <svg className="farm-design-preview__hexagon" viewBox="0 0 200 200" aria-label={`Hexagon of ${farmLabel}`}>
        <polygon className="farm-design-preview__outline" points={createHexagonPoints(100, 100, 88)} />
        {siteColors.map((color, siteIndex) => {
          const isSelected = siteIndex === selectedSiteIndex;
          const isHovered = siteIndex === hoveredSiteIndex;
          const displayColor = isSelected || isHovered ? getInteractiveSiteColor(color) : color;

          return (
            <polygon
              key={siteIndex}
              className={`farm-design-preview__site ${hasSiteInteraction ? 'is-clickable' : ''} ${isSelected ? 'is-selected' : ''} ${isHovered ? 'is-hovered' : ''}`.trim()}
              style={{ fill: displayColor, outline: 'none' }}
              points={createTrianglePoints(100, 100, 88, siteIndex)}
              role={hasSiteInteraction ? 'button' : undefined}
              tabIndex={hasSiteInteraction ? -1 : undefined}
              aria-label={hasSiteInteraction ? (getSiteAriaLabel?.(siteIndex) || `Site ${siteIndex + 1}`) : undefined}
              onClick={hasSiteInteraction ? (event) => onSiteClick(siteIndex, color, event) : undefined}
              onMouseDown={hasSiteInteraction ? (event) => event.preventDefault() : undefined}
              onMouseEnter={hasSiteHoverTracking ? () => onSiteHoverChange(siteIndex) : undefined}
              onMouseLeave={hasSiteHoverTracking ? () => onSiteHoverChange(null) : undefined}
              onFocus={hasSiteHoverTracking ? () => onSiteHoverChange(siteIndex) : undefined}
              onBlur={hasSiteHoverTracking ? () => onSiteHoverChange(null) : undefined}
              onKeyDown={
                hasSiteInteraction
                  ? (event) => {
                      if (event.key !== 'Enter' && event.key !== ' ') return;
                      event.preventDefault();
                      onSiteClick(siteIndex, color, event);
                    }
                  : undefined
              }
            />
          );
        })}
        {hoverHint && siteHoverHint ? (
          <text
            className="farm-design-preview__site-hint"
            x={hoverHint.x}
            y={hoverHint.y}
            style={{ fill: hoverHint.textColor }}
          >
            {siteHoverHint}
          </text>
        ) : null}
        <circle className="farm-design-preview__core" cx="100" cy="100" r="30" />
      </svg>

      <div
        className={`farm-design-preview__media ${centerStyle.type === 'image' && centerStyle.imageUrl && !hasCenterImageFailed ? 'has-image' : ''} ${hasCenterInteraction ? 'is-clickable' : ''}`}
        style={centerStyle.backgroundColor ? { background: centerStyle.backgroundColor } : undefined}
        role={hasCenterInteraction ? 'button' : undefined}
        tabIndex={hasCenterInteraction ? 0 : undefined}
        aria-label={hasCenterInteraction ? (centerAriaLabel || 'Farm center') : undefined}
        onClick={hasCenterInteraction ? onCenterClick : undefined}
        onKeyDown={
          hasCenterInteraction
            ? (event) => {
                if (event.key !== 'Enter' && event.key !== ' ') return;
                event.preventDefault();
                onCenterClick(event);
              }
            : undefined
        }
      >
        {centerStyle.type === 'image' && centerStyle.imageUrl && !hasCenterImageFailed ? (
          <div className="farm-design-preview__image-wrap" style={{ backgroundImage: `url(${centerStyle.imageUrl})` }}>
            <img
              src={centerStyle.imageUrl}
              alt={`Center of ${farmLabel}`}
              className="farm-design-preview__image"
              loading="lazy"
              decoding="async"
              style={{
                transform: `translate(-50%, -50%) translate(${centerStyle.position.x}px, ${centerStyle.position.y}px) scale(${centerStyle.zoom})`,
              }}
              onError={() => setFailedImageUrl(centerStyle.imageUrl || '__missing__')}
            />
          </div>
        ) : (
          <span className="farm-design-preview__emoji" style={centerStyle.textColor ? { color: centerStyle.textColor } : undefined}>
            {centerStyle.emoji || 'H'}
          </span>
        )}
      </div>
    </div>
  );
}

export default FarmDesignPreview;
