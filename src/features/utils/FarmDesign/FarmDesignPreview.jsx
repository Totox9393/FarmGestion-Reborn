import { useEffect, useMemo, useState } from 'react';
import { createHexagonPoints, createTrianglePoints, normalizeCenterStyle, normalizeSiteColors } from './farmDesignUtils';
import './FarmDesignPreview.css';

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
}) {
  const [centerImageFailed, setCenterImageFailed] = useState(false);

  const siteColors = useMemo(() => normalizeSiteColors(siteColorsRaw), [siteColorsRaw]);
  const centerStyle = useMemo(() => normalizeCenterStyle(centerStyleRaw), [centerStyleRaw]);
  const hasSiteInteraction = typeof onSiteClick === 'function';
  const hasCenterInteraction = typeof onCenterClick === 'function';

  useEffect(() => {
    setCenterImageFailed(false);
  }, [centerStyle.imageUrl]);

  return (
    <div
      className={`farm-design-preview ${rotate ? 'is-rotating' : ''} ${className}`.trim()}
      style={{ '--farm-design-size': `min(100%, ${maxSize}px)`, minHeight: `${minHeight}px` }}
    >
      <svg className="farm-design-preview__hexagon" viewBox="0 0 200 200" aria-label={`Hexagon of ${farmLabel}`}>
        <polygon className="farm-design-preview__outline" points={createHexagonPoints(100, 100, 88)} />
        {siteColors.map((color, siteIndex) => (
          <polygon
            key={siteIndex}
            className={`farm-design-preview__site ${hasSiteInteraction ? 'is-clickable' : ''}`}
            style={{ fill: color }}
            points={createTrianglePoints(100, 100, 88, siteIndex)}
            role={hasSiteInteraction ? 'button' : undefined}
            tabIndex={hasSiteInteraction ? 0 : undefined}
            aria-label={hasSiteInteraction ? (getSiteAriaLabel?.(siteIndex) || `Site ${siteIndex + 1}`) : undefined}
            onClick={hasSiteInteraction ? (event) => onSiteClick(siteIndex, color, event) : undefined}
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
        ))}
        <circle className="farm-design-preview__core" cx="100" cy="100" r="30" />
      </svg>

      <div
        className={`farm-design-preview__media ${centerStyle.type === 'image' && centerStyle.imageUrl && !centerImageFailed ? 'has-image' : ''} ${hasCenterInteraction ? 'is-clickable' : ''}`}
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
        {centerStyle.type === 'image' && centerStyle.imageUrl && !centerImageFailed ? (
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
              onError={() => setCenterImageFailed(true)}
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
