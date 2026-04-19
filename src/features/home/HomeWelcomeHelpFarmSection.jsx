import { ArrowRight, Award, BarChart3, Camera, Palette, Pause, Play } from 'lucide-react';
import { FarmDesignPreview } from '../utils/FarmDesign';
import farmCenterExample3 from '../../assets/img/farmcenterexample3.png';
import farmCenterExample5 from '../../assets/img/farmcenterexample5.png';
import farmCenterExample7 from '../../assets/img/farmcenterexample7.png';

const SITE_COLORS_BEFORE = ['#f2b37f', '#f6cc89', '#9fcf8b', '#7fc9ba', '#8ab3f6', '#c39be8'];
const SITE_COLORS_AFTER = ['#ff9f6e', '#ffd37c', '#90d16d', '#53bfbf', '#6f95ff', '#9c79ff'];

function HomeWelcomeHelpFarmSection({
  schema,
  activeFarmStep,
  setActiveFarmStep,
  activePhase,
  isAnimationPaused,
  onAnimationHoverStart,
  onAnimationHoverEnd,
  onNextStep,
}) {
  const renderFarmStage = () => {
    if (!activePhase) return null;

    const renderStageFrame = ({ stageClass, kicker, visual, note = null }) => (
      <div className={`home-help-stage ${stageClass}`} aria-live="polite">
        <div className="home-help-stage-card">
          <header className="home-help-stage-header">
            <p className="home-help-stage-kicker">{kicker}</p>
          </header>

          <div className="home-help-stage-visual" aria-hidden="true">
            {visual}
            {note ? <p className="home-help-stage-note">{note}</p> : null}
          </div>
        </div>
      </div>
    );

    if (activePhase.id === 'sites') {
      return renderStageFrame({
        stageClass: 'home-help-stage--farm-sites',
        kicker: 'Modifier les couleurs des sites',
        visual: (
          <div className="home-help-farm-shell">
            <FarmDesignPreview
              className="home-help-farm-preview"
              farmLabel="Ferme démo"
              siteColorsRaw={SITE_COLORS_AFTER}
              centerStyleRaw={{
                type: 'image',
                imageUrl: farmCenterExample3,
                zoom: 1.18,
                position: { x: 0, y: -4 },
              }}
              rotate
              maxSize={230}
              minHeight={220}
            />
            <div className="home-help-farm-swatches">
              {SITE_COLORS_BEFORE.map((color, index) => (
                <span
                  key={`before-${index}`}
                  className="home-help-farm-swatch"
                  style={{ '--home-help-farm-color': color }}
                />
              ))}
              <Palette size={13} />
              {SITE_COLORS_AFTER.map((color, index) => (
                <span
                  key={`after-${index}`}
                  className="home-help-farm-swatch is-after"
                  style={{ '--home-help-farm-color': color }}
                />
              ))}
            </div>
          </div>
        ),
      });
    }

    if (activePhase.id === 'center') {
      return renderStageFrame({
        stageClass: 'home-help-stage--farm-center',
        kicker: 'Changer la photo du centre',
        visual: (
          <div className="home-help-farm-shell">
            <FarmDesignPreview
              className="home-help-farm-preview"
              farmLabel="Ferme démo"
              siteColorsRaw={SITE_COLORS_AFTER}
              centerStyleRaw={{
                type: 'image',
                imageUrl: farmCenterExample3,
                zoom: 1.18,
                position: { x: 0, y: -4 },
              }}
              maxSize={230}
              minHeight={220}
            />
            <span className="home-help-farm-chip">
              <Camera size={13} />
              Photo du centre mise à jour
            </span>
          </div>
        ),
      });
    }

    if (activePhase.id === 'badges') {
      return renderStageFrame({
        stageClass: 'home-help-stage--farm-badges',
        kicker: 'Attribuer les badges',
        visual: (
          <div className="home-help-farm-badges-shell">
            <FarmDesignPreview
              className="home-help-farm-preview is-static"
              farmLabel="Ferme démo"
              siteColorsRaw={SITE_COLORS_AFTER}
              centerStyleRaw={{
                type: 'image',
                imageUrl: farmCenterExample3,
                zoom: 1.18,
                position: { x: 0, y: -4 },
              }}
              maxSize={210}
              minHeight={190}
            />

            <div className="home-help-farm-badges-grid">
              <span className="home-help-farm-badge-slot is-filled">
                <img src={farmCenterExample5} alt="Badge Chomp" className="home-help-farm-badge-image" loading="lazy" decoding="async" />
              </span>
              <span className="home-help-farm-badge-slot is-filled">
                <img src={farmCenterExample7} alt="Badge Rizolac" className="home-help-farm-badge-image" loading="lazy" decoding="async" />
              </span>
              <span className="home-help-farm-badge-slot">Slot libre</span>
            </div>

          </div>
        ),

      });
    }

    return renderStageFrame({
      stageClass: 'home-help-stage--farm-stats',
      kicker: 'Suivre les indicateurs',
      visual: (
        <div className="home-help-farm-stats-shell">
          <article className="home-help-farm-stat-card">
            <p>Population</p>
            <strong>48 / 60</strong>
            <span className="home-help-farm-track">
              <span className="home-help-farm-track-fill" style={{ width: '80%' }} />
            </span>
          </article>

          <article className="home-help-farm-stat-card">
            <p>Sites actifs</p>
            <strong>6 / 6</strong>
            <span className="home-help-farm-track">
              <span className="home-help-farm-track-fill is-alt" style={{ width: '100%' }} />
            </span>
          </article>

          <article className="home-help-farm-stat-card">
            <p>Badges équipés</p>
            <strong>2 / 3</strong>
            <span className="home-help-farm-track">
              <span className="home-help-farm-track-fill is-soft" style={{ width: '67%' }} />
            </span>
          </article>

          <p className="home-help-farm-stats-pill">
            <BarChart3 size={13} />
            Statistiques en temps réel
          </p>
        </div>
      ),
    });
  };

  return (
    <>
      <div className="home-help-creation-stepper" role="tablist" aria-label="Étapes gestion de la ferme">
        {schema.map((step, index) => (
          <button
            key={step.title}
            type="button"
            role="tab"
            aria-selected={activeFarmStep === index}
            className={`home-help-creation-step ${activeFarmStep === index ? 'is-active' : ''}`}
            onClick={() => setActiveFarmStep(index)}
            title={step.title}
          >
            <span className="home-help-creation-step-index">{index + 1}</span>
            <span className="home-help-creation-step-title">{step.title}</span>
          </button>
        ))}
      </div>

      <div
        className={`home-help-creation-stage-wrap ${isAnimationPaused ? 'is-paused' : ''}`}
        onMouseEnter={onAnimationHoverStart}
        onMouseLeave={onAnimationHoverEnd}
      >
        <span
          className="home-help-animation-state"
          role="status"
          aria-live="polite"
          aria-label={isAnimationPaused ? 'Animation en pause' : 'Animation en lecture'}
        >
          {isAnimationPaused ? <Pause size={14} aria-hidden="true" /> : <Play size={14} aria-hidden="true" />}
        </span>
        {renderFarmStage()}
        <p className="home-help-creation-description">
          {activePhase?.description || schema[activeFarmStep]?.text}
        </p>
      </div>

      <div className="home-help-creation-controls">
        <button type="button" className="home-help-next-btn" onClick={onNextStep}>
          Suivant
          <ArrowRight size={15} aria-hidden="true" />
        </button>
      </div>
    </>
  );
}

export default HomeWelcomeHelpFarmSection;