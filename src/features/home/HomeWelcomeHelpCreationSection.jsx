import { ArrowRight, Camera, CheckCircle2, Fingerprint, Pause, Play, Sparkles, Type } from 'lucide-react';
import miloClassique from '../../assets/milo_CLASSIQUE.png';
import templateBetail1 from '../../assets/template_betail1.png';

function HomeWelcomeHelpCreationSection({
  schema,
  activeCreationStep,
  setActiveCreationStep,
  activePhase,
  demoMatricule,
  isAnimationPaused,
  onAnimationHoverStart,
  onAnimationHoverEnd,
  onNextStep,
}) {
  const renderCreationStage = () => {
    if (!activePhase) return null;

    const renderStageFrame = ({ stageClass, kicker, visual, note = null, noteClassName = '' }) => (
      <div className={`home-help-stage ${stageClass}`} aria-live="polite">
        <div className="home-help-stage-card">
          <header className="home-help-stage-header">
            <p className="home-help-stage-kicker">{kicker}</p>
          </header>

          <div className="home-help-stage-visual" aria-hidden="true">
            {visual}
            {note ? <p className={`home-help-stage-note ${noteClassName}`.trim()}>{note}</p> : null}
          </div>
        </div>
      </div>
    );

    if (activePhase.id === 'start') {
      return renderStageFrame({
        stageClass: 'home-help-stage--start',
        kicker: 'Lancer Betail Maker',
        visual: (
          <div className="home-help-start-card">
            <img src={miloClassique} alt="" className="home-help-start-milo" loading="lazy" decoding="async" />
            <div className="home-help-start-copy">
              <p>Créons un nouveau bétail.</p>
              <span className="home-help-start-pill">Créer</span>
            </div>
          </div>
        ),
      });
    }

    if (activePhase.id === 'name') {
      return renderStageFrame({
        stageClass: 'home-help-stage--name',
        kicker: 'Renseigner le prénom',
        visual: (
          <>
            <span className="home-help-stage-label">Prénom</span>
            <div className="home-help-stage-input-wrap" role="presentation">
              <Type size={15} aria-hidden="true" />
              <span className="home-help-stage-input-value">Marguerite</span>
              <span className="home-help-stage-input-caret" aria-hidden="true" />
            </div>
          </>
        ),
      });
    }

    if (activePhase.id === 'age') {
      return renderStageFrame({
        stageClass: 'home-help-stage--age',
        kicker: 'Choisir l’âge',
        visual: (
          <>
            <div className="home-help-age-display">
              <strong>2</strong>
              <span>ans</span>
            </div>
            <div className="home-help-age-slider">
              <span className="home-help-age-progress" />
              <span className="home-help-age-thumb" />
            </div>
          </>
        ),
      });
    }

    if (activePhase.id === 'photo') {
      return renderStageFrame({
        stageClass: 'home-help-stage--photo',
        kicker: 'Choisir une photo',
        visual: (
          <div className="home-help-photo-preview">
            <div className="home-help-photo-ring" />
            <span className="home-help-photo-icon">
              <Camera size={18} />
            </span>
          </div>
        ),
        note: 'Cliquer ou glisser une photo ici',
      });
    }

    if (activePhase.id === 'matricule') {
      return renderStageFrame({
        stageClass: 'home-help-stage--matricule',
        kicker: 'Attribution automatique',
        visual: (
          <div className="home-help-matricule">
            <Fingerprint size={16} />
            <span>{demoMatricule}</span>
          </div>
        ),
        note: 'Tiré aléatoirement puis vérifié unique automatiquement.',
      });
    }

    if (activePhase.id === 'quality') {
      return renderStageFrame({
        stageClass: 'home-help-stage--quality',
        kicker: 'Mini-jeux de qualité',
        visual: (
          <div className="home-help-quality-games">
            <article className="home-help-quality-game">
              <span className="home-help-quality-game-label">Roue</span>
              <span className="home-help-quality-wheel" />
            </article>
            <article className="home-help-quality-game">
              <span className="home-help-quality-game-label">Dés</span>
              <span className="home-help-quality-dice">
                <span />
                <span />
                <span />
              </span>
            </article>
            <article className="home-help-quality-game">
              <span className="home-help-quality-game-label">Carte</span>
              <span className="home-help-quality-card">
                <span className="home-help-quality-card-face-front">?</span>
                <span className="home-help-quality-card-face-back">★</span>
              </span>
            </article>
          </div>
        ),
      });
    }

    if (activePhase.id === 'comment') {
      return renderStageFrame({
        stageClass: 'home-help-stage--comment',
        kicker: 'Commentaire optionnel',
        visual: (
          <div className="home-help-comment">
            Bétail calme, très sociable avec le troupeau.
          </div>
        ),
      });
    }

    if (activePhase.id === 'recap') {
      return renderStageFrame({
        stageClass: 'home-help-stage--recap',
        kicker: 'Vérifier puis valider',
        visual: (
          <div className="home-help-recap-list">
            <div className="home-help-recap-head">
              <img src={templateBetail1} alt="" className="home-help-recap-avatar" loading="lazy" decoding="async" />
              <p><strong>Prénom:</strong> Marguerite</p>
            </div>
            <p><strong>Âge:</strong> 2 ans</p>
            <p><strong>Qualité:</strong> Standard</p>
            <p><strong>Commentaire:</strong> Bétail calme, très sociable avec le troupeau.</p>
          </div>
        ),
      });
    }

    return renderStageFrame({
      stageClass: 'home-help-stage--save',
      kicker: 'Bétail enregistré',
      visual: (
        <div className="home-help-save-badge">
          <CheckCircle2 size={18} />
          <span>Création terminée</span>
        </div>
      ),
      note: (
        <>
          <Sparkles size={14} aria-hidden="true" />
          Tu pourras ensuite le retrouver dans Mes bétails.
        </>
      ),
      noteClassName: 'home-help-stage-note--accent',
    });
  };

  return (
    <>
      <div className="home-help-creation-stepper" role="tablist" aria-label="Étapes création de bétail">
        {schema.map((step, index) => (
          <button
            key={step.title}
            type="button"
            role="tab"
            aria-selected={activeCreationStep === index}
            className={`home-help-creation-step ${activeCreationStep === index ? 'is-active' : ''}`}
            onClick={() => setActiveCreationStep(index)}
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
        {renderCreationStage()}
        <p className="home-help-creation-description">
          {activePhase?.description || schema[activeCreationStep]?.text}
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

export default HomeWelcomeHelpCreationSection;
