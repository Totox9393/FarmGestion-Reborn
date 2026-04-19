import {
  ArrowRight,
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock3,
  ListChecks,
  Package,
  Pause,
  Play,
} from 'lucide-react';
import bg2 from '../../assets/bg2.png';
import bg3 from '../../assets/bg3.png';
import templateBetail2 from '../../assets/template_betail2.png';

const OWN_BETAILS = [
  { id: 'b1', name: 'Melanie', matricule: '73584', avatar: bg3, selected: true },
  { id: 'b2', name: 'Gul', matricule: '18689', avatar: bg2, selected: false },
  { id: 'b3', name: 'Azra', matricule: '74594', avatar: templateBetail2, selected: false },
];

const CALENDAR_DAYS = [
  { day: 21, hasShipping: false },
  { day: 22, hasShipping: true, avatar: bg3 },
  { day: 23, hasShipping: false },
  { day: 24, hasShipping: true, avatar: bg2 },
  { day: 25, hasShipping: false },
  { day: 26, hasShipping: true, avatar: templateBetail2 },
  { day: 27, hasShipping: false },
  { day: 28, hasShipping: true, avatar: bg3 },
  { day: 29, hasShipping: false },
  { day: 30, hasShipping: true, avatar: bg2 },
  { day: 1, hasShipping: false },
  { day: 2, hasShipping: true, avatar: templateBetail2 },
  { day: 3, hasShipping: false },
  { day: 4, hasShipping: false },
];

const TRACKING_ROWS = [
  {
    id: 't1',
    name: 'Melanie',
    avatar: bg3,
    status: 'En attente',
    progress: 62,
    note: 'Prévu le 26 avril · 14:30',
  },
  {
    id: 't2',
    name: 'Azra',
    avatar: templateBetail2,
    status: 'Expédié',
    progress: 100,
    note: 'Expédié le 22 avril · 09:40',
  },
];

function HomeWelcomeHelpExpeditionSection({
  schema,
  activeExpeditionStep,
  setActiveExpeditionStep,
  activePhase,
  isAnimationPaused,
  onAnimationHoverStart,
  onAnimationHoverEnd,
  onNextStep,
}) {
  const renderExpeditionStage = () => {
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

    if (activePhase.id === 'schedule') {
      return renderStageFrame({
        stageClass: 'home-help-stage--expedition-schedule',
        kicker: 'Expédition de l\'un de tes bétails',
        visual: (
          <div className="home-help-expedition-schedule">
            <article className="home-help-expedition-owned">
              <p className="home-help-expedition-eyebrow">Mes bétails</p>
              <div className="home-help-expedition-owned-list">
                {OWN_BETAILS.map((betail) => (
                  <div
                    key={betail.id}
                    className={`home-help-expedition-owned-row ${betail.selected ? 'is-selected' : ''}`}
                  >
                    <img
                      src={betail.avatar}
                      alt={`Profil de ${betail.name}`}
                      className="home-help-expedition-avatar"
                      loading="lazy"
                      decoding="async"
                    />
                    <div>
                      <p>{betail.name}</p>
                      <span>{betail.matricule}</span>
                    </div>
                  </div>
                ))}
              </div>
            </article>

            <article className="home-help-expedition-modal-preview">
              <header className="home-help-expedition-modal-head">
                <Package size={14} />
                <p>Expédition</p>
              </header>
              <div className="home-help-expedition-modal-line">
                <strong>Bétail:</strong>
                <span>Melanie · 73584</span>
              </div>
              <div className="home-help-expedition-modal-line">
                <Clock3 size={13} />
                <span>Date: 26 avril 2026</span>
              </div>
                <div className="home-help-expedition-modal-line">
                <span>Gain : 500 💸</span>
              </div>
              <button type="button" className="home-help-expedition-program-btn">
                Programmer l’expédition
              </button>           
            </article>
          </div>
        ),
      });
    }

    if (activePhase.id === 'calendar') {
      return renderStageFrame({
        stageClass: 'home-help-stage--expedition-calendar',
        kicker: 'Ouvrir le GCE pour la vue mensuelle',
        visual: (
          <div className="home-help-expedition-gce">
            <header className="home-help-expedition-gce-head">
              <span className="home-help-expedition-gce-chip is-active">
                <CalendarDays size={12} />
                Calendrier
              </span>
              <span className="home-help-expedition-gce-chip">Expéditions</span>
            </header>

            <div className="home-help-expedition-month-nav">
              <button type="button" aria-label="Mois précédent">
                <ChevronLeft size={13} />
              </button>
              <p>Avril 2026</p>
              <button type="button" aria-label="Mois suivant">
                <ChevronRight size={13} />
              </button>
            </div>

            <div className="home-help-expedition-weekdays" role="presentation">
              <span>Lun</span>
              <span>Mar</span>
              <span>Mer</span>
              <span>Jeu</span>
              <span>Ven</span>
              <span>Sam</span>
              <span>Dim</span>
            </div>

            <div className="home-help-expedition-calendar-grid" role="presentation">
              {CALENDAR_DAYS.map((cell, index) => (
                <div
                  key={`calendar-cell-${index}`}
                  className={`home-help-expedition-day ${cell.hasShipping ? 'has-shipping' : ''}`}
                >
                  <strong>{cell.day}</strong>
                  {cell.hasShipping && cell.avatar ? (
                    <img
                      src={cell.avatar}
                      alt="Bétail planifié"
                      className="home-help-expedition-day-avatar"
                      loading="lazy"
                      decoding="async"
                    />
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        ),
      });
    }

    return renderStageFrame({
      stageClass: 'home-help-stage--expedition-tracking',
      kicker: 'Suivre les statuts depuis l’onglet GCE dédié',
      visual: (
        <div className="home-help-expedition-tracking">
          <header className="home-help-expedition-tracking-tabs">
            <span className="home-help-expedition-gce-chip">Calendrier</span>
            <span className="home-help-expedition-gce-chip is-active">
              <ListChecks size={12} />
              Suivi
            </span>
          </header>

          <div className="home-help-expedition-tracking-list">
            {TRACKING_ROWS.map((row) => (
              <article key={row.id} className="home-help-expedition-track-row">
                <img
                  src={row.avatar}
                  alt={`Profil de ${row.name}`}
                  className="home-help-expedition-avatar"
                  loading="lazy"
                  decoding="async"
                />
                <div className="home-help-expedition-track-main">
                  <div className="home-help-expedition-track-head">
                    <p>{row.name}</p>
                    <span className={`home-help-expedition-status ${row.progress >= 100 ? 'is-done' : ''}`}>
                      {row.status}
                    </span>
                  </div>
                  <small>{row.note}</small>
                  <span className="home-help-expedition-progress-track">
                    <span style={{ width: `${row.progress}%` }} />
                  </span>
                </div>
              </article>
            ))}
          </div>
        </div>
      ),
    });
  };

  return (
    <>
      <div className="home-help-creation-stepper" role="tablist" aria-label="Étapes expédition">
        {schema.map((step, index) => (
          <button
            key={step.title}
            type="button"
            role="tab"
            aria-selected={activeExpeditionStep === index}
            className={`home-help-creation-step ${activeExpeditionStep === index ? 'is-active' : ''}`}
            onClick={() => setActiveExpeditionStep(index)}
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
        {renderExpeditionStage()}
        <p className="home-help-creation-description">
          {activePhase?.description || schema[activeExpeditionStep]?.text}
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

export default HomeWelcomeHelpExpeditionSection;
