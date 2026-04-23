import { ArrowRight, CheckCircle2, Pause, Play, ShoppingCart } from 'lucide-react';
import bg2 from '../../assets/bg2.png';
import bg3 from '../../assets/bg3.png';
import templateBetail2 from '../../assets/template_betail2.png';

const SELECTED_BETAIL_EXAMPLE = {
  name: 'Melanie',
  matricule: '73584',
  age: '2 ans',
  avatar: bg3,
  alt: 'Profil de Melanie',
};

function HomeWelcomeHelpPurchaseSection({
  schema,
  activePurchaseStep,
  setActivePurchaseStep,
  activePhase,
  isAnimationPaused,
  onAnimationHoverStart,
  onAnimationHoverEnd,
  onNextStep,
}) {
  const renderPurchaseStage = () => {
    if (!activePhase) return null;

    const stageSubtitle = activePhase?.description || schema[activePurchaseStep]?.text;

    const renderStageFrame = ({ stageClass, kicker, visual, note = null }) => (
      <div className={`home-help-stage ${stageClass}`} aria-live="polite">
        <div className="home-help-stage-card">
          <header className="home-help-stage-header">
            <p className="home-help-stage-kicker">{kicker}</p>
            {stageSubtitle ? <p className="home-help-stage-subtitle">{stageSubtitle}</p> : null}
          </header>

          <div className="home-help-stage-visual" aria-hidden="true">
            {visual}
            {note ? <p className="home-help-stage-note">{note}</p> : null}
          </div>
        </div>
      </div>
    );

    if (activePhase.id === 'registry') {
      return renderStageFrame({
        stageClass: 'home-help-stage--purchase-registry',
        kicker: 'Choisir un bétail dans le registre',
        visual: (
          <div className="home-help-purchase-grid">
            <article className="home-help-purchase-card">
              <img
                src={bg2}
                alt="Profil de Gul"
                className="home-help-purchase-card-avatar"
                loading="lazy"
                decoding="async"
              />
              <p className="home-help-purchase-card-name">Gul</p>
              <p className="home-help-purchase-card-matricule">18689</p>
            </article>
            <article className="home-help-purchase-card is-selected">
              <img
                src={bg3}
                alt="Profil de Melanie"
                className="home-help-purchase-card-avatar"
                loading="lazy"
                decoding="async"
              />
              <p className="home-help-purchase-card-name">Melanie</p>
              <p className="home-help-purchase-card-matricule">73584</p>
              <span className="home-help-purchase-card-tag">Sélectionné</span>
            </article>
            <article className="home-help-purchase-card">
              <img
                src={templateBetail2}
                alt="Profil de Azra"
                className="home-help-purchase-card-avatar"
                loading="lazy"
                decoding="async"
              />
              <p className="home-help-purchase-card-name">Azra</p>
              <p className="home-help-purchase-card-matricule">74594</p>
            </article>
          </div>
        ),
        note: 'Clique sur un bétail pour afficher son volet de détails.',
      });
    }

    if (activePhase.id === 'drawer') {
      return renderStageFrame({
        stageClass: 'home-help-stage--purchase-drawer',
        kicker: 'Le volet s’ouvre à droite',
        visual: (
          <div className="home-help-purchase-shell">
            <div className="home-help-purchase-list-ghost">
              <span className="home-help-purchase-list-row" />
              <span className="home-help-purchase-list-row is-selected" />
              <span className="home-help-purchase-list-row" />
            </div>
            <article className="home-help-purchase-drawer">
              <header className="home-help-purchase-drawer-head">
                <p>Détails du bétail</p>
                <span>✕</span>
              </header>
              <img
                src={SELECTED_BETAIL_EXAMPLE.avatar}
                alt={SELECTED_BETAIL_EXAMPLE.alt}
                className="home-help-purchase-drawer-avatar"
                loading="lazy"
                decoding="async"
              />
              <div className="home-help-purchase-drawer-meta">
                <p><strong>Nom:</strong> {SELECTED_BETAIL_EXAMPLE.name}</p>
                <p><strong>Matricule:</strong> {SELECTED_BETAIL_EXAMPLE.matricule}</p>
                <p><strong>Âge:</strong> {SELECTED_BETAIL_EXAMPLE.age}</p>
              </div>
            </article>
          </div>
        ),
        note: 'Vérifie la fiche avant de confirmer ton achat.',
      });
    }

    return renderStageFrame({
      stageClass: 'home-help-stage--purchase-buy',
      kicker: 'Cliquer sur le bouton Acheter',
      visual: (
        <div className="home-help-purchase-shell">
          <div className="home-help-purchase-list-ghost">
            <span className="home-help-purchase-list-row" />
            <span className="home-help-purchase-list-row is-selected" />
            <span className="home-help-purchase-list-row" />
          </div>
          <article className="home-help-purchase-drawer is-ready">
            <header className="home-help-purchase-drawer-head">
              <p>Détails du bétail</p>
              <span>✕</span>
            </header>
            <img
              src={SELECTED_BETAIL_EXAMPLE.avatar}
              alt={SELECTED_BETAIL_EXAMPLE.alt}
              className="home-help-purchase-drawer-avatar"
              loading="lazy"
              decoding="async"
            />
            <div className="home-help-purchase-drawer-meta">
              <p><strong>Nom :</strong> {SELECTED_BETAIL_EXAMPLE.name}</p>
              <p><strong>Matricule :</strong> {SELECTED_BETAIL_EXAMPLE.matricule}</p>
              <p><strong>Âge:</strong> {SELECTED_BETAIL_EXAMPLE.age}</p>
            </div>
            <button type="button" className="home-help-purchase-buy is-pressing">
              <ShoppingCart size={14} />
              Acheter
            </button>
          </article>
        </div>
      ),
      note: 'Le bétail rejoint ensuite automatiquement ta ferme.',
    });
  };

  return (
    <>
      <div className="home-help-creation-stepper" role="tablist" aria-label="Étapes achat de bétails">
        {schema.map((step, index) => (
          <button
            key={step.title}
            type="button"
            role="tab"
            aria-selected={activePurchaseStep === index}
            className={`home-help-creation-step ${activePurchaseStep === index ? 'is-active' : ''}`}
            onClick={() => setActivePurchaseStep(index)}
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
        {renderPurchaseStage()}
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

export default HomeWelcomeHelpPurchaseSection;
