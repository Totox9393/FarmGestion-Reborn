import { useEffect, useMemo, useRef, useState } from 'react';
import HomeWelcomeHelpCreationSection from './HomeWelcomeHelpCreationSection';
import HomeWelcomeHelpExpeditionSection from './HomeWelcomeHelpExpeditionSection';
import HomeWelcomeHelpFarmSection from './HomeWelcomeHelpFarmSection';
import HomeWelcomeHelpPurchaseSection from './HomeWelcomeHelpPurchaseSection';
import HomeWelcomeHelpSectionsOverview from './HomeWelcomeHelpSectionsOverview';
import './HomeWelcomeHelpModal.css';

const createDemoMatricule = () => String(10000 + Math.floor(Math.random() * 70001));
const CREATION_PHASE_DURATION_MS = 2200;
const PURCHASE_PHASE_DURATION_MS = 2200;
const FARM_PHASE_DURATION_MS = 2400;
const EXPEDITION_PHASE_DURATION_MS = 2400;

function HomeWelcomeGuidesModal({ isOpen, onClose, onNavigate, hasFarm = false, farmPath = null }) {
  const sections = useMemo(() => {
    return [
      {
        id: 'creation-betail',
        label: 'Création de bétail',
        title: 'Création de bétail',
        kicker: 'Démarrer ton élevage',
        summary: 'Le plus simple pour commencer: crée ton premier bétail, puis ajoute-le à ta ferme.',
        schema: [
          {
            title: 'Prénom & âge',
            text: 'Cette étape regroupe le lancement BetailMaker, le prénom et le choix de l’âge.',
          },
          {
            title: 'Photo & matricule',
            text: 'Cette étape couvre l’import photo, l’aperçu rond et la génération du matricule.',
          },
          {
            title: 'Qualité, détails & validation',
            text: 'Cette étape enchaîne qualité, commentaire, récapitulatif puis validation finale.',
          },
        ],
        links: [
          {
            label: 'Aller à la création',
            to: '/betail-maker',
          },
          {
            label: 'Voir mes bétails',
            to: '/mes-betails',
          },
        ],
      },
      {
        id: 'achat-betail',
        label: 'Achat de bétails',
        title: 'Achat de bétails',
        kicker: 'Trouver et acheter rapidement',
        summary: 'Utilise le registre pour trouver des bétails disponibles, puis complète ton achat.',
        schema: [
          {
            title: 'Ouvrir le registre',
            text: 'Parcours les bétails disponibles à l’achat.',
          },
          {
            title: 'Vérifier la fiche',
            text: 'Contrôle le nom, le matricule et l’état avant validation.',
          },
          {
            title: 'Confirmer l’achat',
            text: 'Ton nouveau bétail apparaîtra dans Mes bétails.',
          },
        ],
        links: [
          {
            label: 'Ouvrir le registre',
            to: '/betail-register',
          },
          {
            label: 'Voir la boutique',
            to: '/boutique',
          },
        ],
      },
      {
        id: 'gestion-ferme',
        label: 'Gestion de la ferme',
        title: 'Gestion de la ferme',
        kicker: 'Organiser ton espace',
        summary: hasFarm
          ? 'Ta ferme est prête: gère les visibilités, les bétails et l’organisation en quelques clics.'
          : 'Tu n’as pas encore de ferme active. Crée ou active ta ferme pour débloquer la gestion complète.',
        schema: [
          {
            title: 'Couleurs des sites et centre',
            text: hasFarm
              ? 'Personnalise les couleurs des 6 sites puis la photo du centre.'
              : 'Active d’abord une ferme pour personnaliser les sites et le centre.',
          },
          {
            title: 'Attribution des badges',
            text: 'Équipe les slots de badges pour afficher le niveau de ta ferme.',
          },
          {
            title: 'Statistiques',
            text: 'Suis population, occupation des sites et progression globale.',
          },
        ],
        links: [
          {
            label: hasFarm ? 'Ouvrir ma ferme' : 'Ferme non disponible',
            to: hasFarm ? farmPath : null,
            disabled: !hasFarm,
          },
          {
            label: 'Voir la communauté',
            to: '/community',
          },
        ],
      },
      {
        id: 'expedition',
        label: 'Expédition',
        title: 'Expédition',
        kicker: 'Piloter les départs avec le GCE',
        summary: 'Prépare une expédition depuis Mes bétails, puis utilise le GCE pour la vue mensuelle et le suivi des statuts.',
        schema: [
          {
            title: 'Fixer une expédition',
            text: 'Depuis Mes bétails, choisis ton bétail puis programme son expédition.',
          },
          {
            title: 'Calendrier GCE',
            text: 'Ouvre le GCE pour voir les expéditions du mois courant et naviguer sur les autres mois.',
          },
          {
            title: 'Suivi des statuts GCE',
            text: 'Dans l’onglet de suivi du GCE, observe les expéditions en attente, en cours ou expédiées.',
          },
        ],
        links: [
          {
            label: 'Voir mes bétails',
            to: '/mes-betails',
          },
          {
            label: 'Ouvrir le GCE',
            to: '/gce',
          },
        ],
      },
    ];
  }, [farmPath, hasFarm]);

  const [activeSectionId, setActiveSectionId] = useState('creation-betail');
  const [activeCreationStep, setActiveCreationStep] = useState(0);
  const [activeCreationPhase, setActiveCreationPhase] = useState(0);
  const [activePurchaseStep, setActivePurchaseStep] = useState(0);
  const [activePurchasePhase, setActivePurchasePhase] = useState(0);
  const [activeFarmStep, setActiveFarmStep] = useState(0);
  const [activeFarmPhase, setActiveFarmPhase] = useState(0);
  const [activeExpeditionStep, setActiveExpeditionStep] = useState(0);
  const [activeExpeditionPhase, setActiveExpeditionPhase] = useState(0);
  const [demoMatricule, setDemoMatricule] = useState(() => createDemoMatricule());
  const [isAnimationPaused, setIsAnimationPaused] = useState(false);

  const creationTimerKeyRef = useRef('');
  const purchaseTimerKeyRef = useRef('');
  const farmTimerKeyRef = useRef('');
  const expeditionTimerKeyRef = useRef('');
  const creationRemainingMsRef = useRef(CREATION_PHASE_DURATION_MS);
  const purchaseRemainingMsRef = useRef(PURCHASE_PHASE_DURATION_MS);
  const farmRemainingMsRef = useRef(FARM_PHASE_DURATION_MS);
  const expeditionRemainingMsRef = useRef(EXPEDITION_PHASE_DURATION_MS);

  const creationPhasesByStep = useMemo(
    () => [
      [
        {
          id: 'start',
          label: 'Démarrage',
          title: 'Lancer Betail Maker',
          description: 'Ouverture de l’assistant de création.',
        },
        {
          id: 'name',
          label: 'Prénom',
          title: 'Renseigner le prénom',
          description: 'Saisie rapide du prénom du bétail.',
        },
        {
          id: 'age',
          label: 'Âge',
          title: 'Choisir l’âge',
          description: 'Sélection de l’âge via slider.',
        },
      ],
      [
        {
          id: 'photo',
          label: 'Photo',
          title: 'Choisir une photo',
          description: 'Import ou glisser-déposer une photo.',
        },
        {
          id: 'matricule',
          label: 'Matricule',
          title: 'Générer le matricule',
          description: 'Attribution aléatoire avec vérification d’unicité automatique.',
        },
      ],
      [
        {
          id: 'quality',
          label: 'Qualité',
          title: 'Évaluer la qualité',
          description: 'Choix d’un mini-jeu puis reveal du résultat.',
        },
        {
          id: 'comment',
          label: 'Commentaire',
          title: 'Ajouter un commentaire',
          description: 'Optionnel avant la validation finale.',
        },
        {
          id: 'recap',
          label: 'Récap',
          title: 'Vérifier le récapitulatif',
          description: 'Contrôle des informations clefs du bétail.',
        },
        {
          id: 'save',
          label: 'Validation',
          title: 'Enregistrer le bétail',
          description: 'Création terminée, le bétail est disponible.',
        },
      ],
    ],
    [],
  );

  const purchasePhasesByStep = useMemo(
    () => [
      [
        {
          id: 'registry',
          label: 'Registre',
          title: 'Ouvrir le registre',
          description: 'Parcours la grille puis sélectionne un bétail.',
        },
      ],
      [
        {
          id: 'drawer',
          label: 'Volet',
          title: 'Vérifier la fiche',
          description: 'Le volet latéral affiche les informations détaillées du bétail.',
        },
      ],
      [
        {
          id: 'buy',
          label: 'Achat',
          title: 'Confirmer l’achat',
          description: 'Clique sur Acheter pour l’ajouter à ta ferme.',
        },
      ],
    ],
    [],
  );

  const farmPhasesByStep = useMemo(
    () => [
      [
        {
          id: 'sites',
          label: 'Sites',
          title: 'Modifier les couleurs',
          description: 'L’identité visuelle de chaque site peut être personnalisée.',
        },
        {
          id: 'center',
          label: 'Centre',
          title: 'Photo centrale',
          description: 'Mets à jour la photo du centre pour personnaliser la ferme.',
        },
      ],
      [
        {
          id: 'badges',
          label: 'Badges',
          title: 'Équiper les badges',
          description: 'Chaque ferme peut équiper jusqu’à 3 badges maximum.',
        },
      ],
      [
        {
          id: 'stats',
          label: 'Stats',
          title: 'Suivi des indicateurs',
          description: 'Observe en un coup d’œil population, sites et badges équipés.',
        },
      ],
    ],
    [],
  );

  const expeditionPhasesByStep = useMemo(
    () => [
      [
        {
          id: 'schedule',
          label: 'Expédition',
          title: 'Fixer une expédition',
          description: 'Démarre depuis Mes bétails: sélectionne un bétail puis confirme l’expédition.',
        },
      ],
      [
        {
          id: 'calendar',
          label: 'Calendrier',
          title: 'Vue mensuelle GCE',
          description: 'Le GCE centralise les expéditions du mois et permet la navigation vers les autres mois.',
        },
      ],
      [
        {
          id: 'tracking',
          label: 'Suivi',
          title: 'Statuts dans le GCE',
          description: 'Depuis l’onglet de suivi, vérifie les statuts et la progression de chaque expédition.',
        },
      ],
    ],
    [],
  );

  useEffect(() => {
    if (!isOpen) return;
    setActiveSectionId('creation-betail');
    setActiveCreationStep(0);
    setActiveCreationPhase(0);
    setActivePurchaseStep(0);
    setActivePurchasePhase(0);
    setActiveFarmStep(0);
    setActiveFarmPhase(0);
    setActiveExpeditionStep(0);
    setActiveExpeditionPhase(0);
    setIsAnimationPaused(false);
    creationTimerKeyRef.current = '0:0';
    purchaseTimerKeyRef.current = '0:0';
    farmTimerKeyRef.current = '0:0';
    expeditionTimerKeyRef.current = '0:0';
    creationRemainingMsRef.current = CREATION_PHASE_DURATION_MS;
    purchaseRemainingMsRef.current = PURCHASE_PHASE_DURATION_MS;
    farmRemainingMsRef.current = FARM_PHASE_DURATION_MS;
    expeditionRemainingMsRef.current = EXPEDITION_PHASE_DURATION_MS;
    setDemoMatricule(createDemoMatricule());
  }, [isOpen]);

  useEffect(() => {
    setIsAnimationPaused(false);

    if (activeSectionId === 'creation-betail') {
      setActiveCreationStep(0);
      setActiveCreationPhase(0);
    }
  }, [activeSectionId]);

  useEffect(() => {
    if (activeSectionId !== 'creation-betail') return;
    setActiveCreationPhase(0);
  }, [activeCreationStep, activeSectionId]);

  useEffect(() => {
    if (activeSectionId === 'achat-betail') {
      setActivePurchaseStep(0);
      setActivePurchasePhase(0);
    }
  }, [activeSectionId]);

  useEffect(() => {
    if (activeSectionId !== 'achat-betail') return;
    setActivePurchasePhase(0);
  }, [activePurchaseStep, activeSectionId]);

  useEffect(() => {
    if (activeSectionId === 'gestion-ferme') {
      setActiveFarmStep(0);
      setActiveFarmPhase(0);
    }
  }, [activeSectionId]);

  useEffect(() => {
    if (activeSectionId === 'expedition') {
      setActiveExpeditionStep(0);
      setActiveExpeditionPhase(0);
    }
  }, [activeSectionId]);

  useEffect(() => {
    if (activeSectionId !== 'gestion-ferme') return;
    setActiveFarmPhase(0);
  }, [activeFarmStep, activeSectionId]);

  useEffect(() => {
    if (activeSectionId !== 'expedition') return;
    setActiveExpeditionPhase(0);
  }, [activeExpeditionStep, activeSectionId]);

  useEffect(() => {
    if (!isOpen) return;

    const onEscape = (event) => {
      if (event.key === 'Escape') {
        onClose?.();
      }
    };

    window.addEventListener('keydown', onEscape);
    return () => window.removeEventListener('keydown', onEscape);
  }, [isOpen, onClose]);

  const activeSection = sections.find((section) => section.id === activeSectionId) || sections[0];

  const handleOverlayMouseDown = (event) => {
    if (event.target === event.currentTarget) {
      onClose?.();
    }
  };

  const handleNavigate = (path) => {
    if (!path) return;
    onNavigate?.(path);
  };

  const handleAnimationHoverStart = () => {
    setIsAnimationPaused(true);
  };

  const handleAnimationHoverEnd = () => {
    setIsAnimationPaused(false);
  };

  const isCreationSection = activeSection.id === 'creation-betail';
  const isPurchaseSection = activeSection.id === 'achat-betail';
  const isFarmSection = activeSection.id === 'gestion-ferme';
  const isExpeditionSection = activeSection.id === 'expedition';
  const activeCreationPhases = creationPhasesByStep[activeCreationStep] || [];
  const activePhase = activeCreationPhases[activeCreationPhase] || activeCreationPhases[0] || null;
  const activePurchasePhases = purchasePhasesByStep[activePurchaseStep] || [];
  const activePurchasePhaseData =
    activePurchasePhases[activePurchasePhase] || activePurchasePhases[0] || null;
  const activeFarmPhases = farmPhasesByStep[activeFarmStep] || [];
  const activeFarmPhaseData = activeFarmPhases[activeFarmPhase] || activeFarmPhases[0] || null;
  const activeExpeditionPhases = expeditionPhasesByStep[activeExpeditionStep] || [];
  const activeExpeditionPhaseData =
    activeExpeditionPhases[activeExpeditionPhase] || activeExpeditionPhases[0] || null;

  useEffect(() => {
    if (!isOpen || !isCreationSection) return;
    if (!activeCreationPhases.length) return;

    const timerKey = `${activeCreationStep}:${activeCreationPhase}`;
    if (creationTimerKeyRef.current !== timerKey) {
      creationTimerKeyRef.current = timerKey;
      creationRemainingMsRef.current = CREATION_PHASE_DURATION_MS;
    }

    if (isAnimationPaused) return;

    const remainingMs = Math.max(0, creationRemainingMsRef.current);
    const startTime = Date.now();
    let hasCompleted = false;

    const timeoutId = window.setTimeout(() => {
      hasCompleted = true;
      creationRemainingMsRef.current = CREATION_PHASE_DURATION_MS;
      const isLastPhaseOfStep = activeCreationPhase >= activeCreationPhases.length - 1;

      if (!isLastPhaseOfStep) {
        setActiveCreationPhase(activeCreationPhase + 1);
        return;
      }

      const nextStep = activeCreationStep + 1 >= creationPhasesByStep.length ? 0 : activeCreationStep + 1;
      setActiveCreationStep(nextStep);
      setActiveCreationPhase(0);

      if (nextStep === 0) {
        setDemoMatricule(createDemoMatricule());
      }
    }, remainingMs);

    return () => {
      window.clearTimeout(timeoutId);
      if (hasCompleted) return;

      const elapsed = Date.now() - startTime;
      creationRemainingMsRef.current = Math.max(0, creationRemainingMsRef.current - elapsed);
    };
  }, [
    activeCreationPhase,
    activeCreationPhases,
    activeCreationStep,
    isCreationSection,
    isAnimationPaused,
    isOpen,
  ]);

  useEffect(() => {
    if (!isOpen || !isPurchaseSection) return;
    if (!activePurchasePhases.length) return;

    const timerKey = `${activePurchaseStep}:${activePurchasePhase}`;
    if (purchaseTimerKeyRef.current !== timerKey) {
      purchaseTimerKeyRef.current = timerKey;
      purchaseRemainingMsRef.current = PURCHASE_PHASE_DURATION_MS;
    }

    if (isAnimationPaused) return;

    const remainingMs = Math.max(0, purchaseRemainingMsRef.current);
    const startTime = Date.now();
    let hasCompleted = false;

    const timeoutId = window.setTimeout(() => {
      hasCompleted = true;
      purchaseRemainingMsRef.current = PURCHASE_PHASE_DURATION_MS;
      const isLastPhaseOfStep = activePurchasePhase >= activePurchasePhases.length - 1;

      if (!isLastPhaseOfStep) {
        setActivePurchasePhase(activePurchasePhase + 1);
        return;
      }

      const nextStep = activePurchaseStep + 1 >= purchasePhasesByStep.length ? 0 : activePurchaseStep + 1;
      setActivePurchaseStep(nextStep);
      setActivePurchasePhase(0);
    }, remainingMs);

    return () => {
      window.clearTimeout(timeoutId);
      if (hasCompleted) return;

      const elapsed = Date.now() - startTime;
      purchaseRemainingMsRef.current = Math.max(0, purchaseRemainingMsRef.current - elapsed);
    };
  }, [
    activePurchasePhase,
    activePurchasePhases,
    activePurchaseStep,
    isAnimationPaused,
    isOpen,
    isPurchaseSection,
  ]);

  useEffect(() => {
    if (!isOpen || !isFarmSection) return;
    if (!activeFarmPhases.length) return;

    const timerKey = `${activeFarmStep}:${activeFarmPhase}`;
    if (farmTimerKeyRef.current !== timerKey) {
      farmTimerKeyRef.current = timerKey;
      farmRemainingMsRef.current = FARM_PHASE_DURATION_MS;
    }

    if (isAnimationPaused) return;

    const remainingMs = Math.max(0, farmRemainingMsRef.current);
    const startTime = Date.now();
    let hasCompleted = false;

    const timeoutId = window.setTimeout(() => {
      hasCompleted = true;
      farmRemainingMsRef.current = FARM_PHASE_DURATION_MS;
      const isLastPhaseOfStep = activeFarmPhase >= activeFarmPhases.length - 1;

      if (!isLastPhaseOfStep) {
        setActiveFarmPhase(activeFarmPhase + 1);
        return;
      }

      const nextStep = activeFarmStep + 1 >= farmPhasesByStep.length ? 0 : activeFarmStep + 1;
      setActiveFarmStep(nextStep);
      setActiveFarmPhase(0);
    }, remainingMs);

    return () => {
      window.clearTimeout(timeoutId);
      if (hasCompleted) return;

      const elapsed = Date.now() - startTime;
      farmRemainingMsRef.current = Math.max(0, farmRemainingMsRef.current - elapsed);
    };
  }, [
    activeFarmPhase,
    activeFarmPhases,
    activeFarmStep,
    isAnimationPaused,
    isFarmSection,
    isOpen,
  ]);

  useEffect(() => {
    if (!isOpen || !isExpeditionSection) return;
    if (!activeExpeditionPhases.length) return;

    const timerKey = `${activeExpeditionStep}:${activeExpeditionPhase}`;
    if (expeditionTimerKeyRef.current !== timerKey) {
      expeditionTimerKeyRef.current = timerKey;
      expeditionRemainingMsRef.current = EXPEDITION_PHASE_DURATION_MS;
    }

    if (isAnimationPaused) return;

    const remainingMs = Math.max(0, expeditionRemainingMsRef.current);
    const startTime = Date.now();
    let hasCompleted = false;

    const timeoutId = window.setTimeout(() => {
      hasCompleted = true;
      expeditionRemainingMsRef.current = EXPEDITION_PHASE_DURATION_MS;
      const isLastPhaseOfStep = activeExpeditionPhase >= activeExpeditionPhases.length - 1;

      if (!isLastPhaseOfStep) {
        setActiveExpeditionPhase(activeExpeditionPhase + 1);
        return;
      }

      const nextStep =
        activeExpeditionStep + 1 >= expeditionPhasesByStep.length ? 0 : activeExpeditionStep + 1;
      setActiveExpeditionStep(nextStep);
      setActiveExpeditionPhase(0);
    }, remainingMs);

    return () => {
      window.clearTimeout(timeoutId);
      if (hasCompleted) return;

      const elapsed = Date.now() - startTime;
      expeditionRemainingMsRef.current = Math.max(0, expeditionRemainingMsRef.current - elapsed);
    };
  }, [
    activeExpeditionPhase,
    activeExpeditionPhases,
    activeExpeditionStep,
    isAnimationPaused,
    isExpeditionSection,
    isOpen,
  ]);

  const handleNextCreationStep = () => {
    setActiveCreationStep((current) => (current + 1 >= activeSection.schema.length ? 0 : current + 1));
  };

  const handleNextPurchaseStep = () => {
    setActivePurchaseStep((current) => (current + 1 >= activeSection.schema.length ? 0 : current + 1));
  };

  const handleNextFarmStep = () => {
    setActiveFarmStep((current) => (current + 1 >= activeSection.schema.length ? 0 : current + 1));
  };

  const handleNextExpeditionStep = () => {
    setActiveExpeditionStep((current) => (current + 1 >= activeSection.schema.length ? 0 : current + 1));
  };

  const strategicLinks = useMemo(() => {
    const links = Array.isArray(activeSection?.links) ? activeSection.links.filter((link) => link && link.label) : [];
    if (isCreationSection) {
      if (activeCreationStep < 2) return links.slice(0, 1);
      return [links[1], links[0]].filter(Boolean);
    }
    if (isExpeditionSection) {
      if (activeExpeditionStep === 0) return [links[0], links[1]].filter(Boolean);
      return [links[1], links[0]].filter(Boolean);
    }
    return links;
  }, [activeCreationStep, activeExpeditionStep, activeSection?.links, isCreationSection, isExpeditionSection]);

  if (!isOpen) return null;

  return (
    <div className="home-help-overlay" role="presentation" onMouseDown={handleOverlayMouseDown}>
      <section
        className="home-help-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="home-help-title"
        aria-describedby="home-help-description"
      >
        <button
          type="button"
          className="home-help-close"
          aria-label="Fermer l'aide de bienvenue"
          onClick={onClose}
        >
          ×
        </button>

        <div className="home-help-layout">
          <aside className="home-help-nav" aria-label="Rubriques d'aide">
            <p className="home-help-nav-title">Rubriques</p>
            <div className="home-help-nav-list" role="tablist" aria-orientation="vertical">
              {sections.map((section) => (
                <button
                  key={section.id}
                  type="button"
                  role="tab"
                  aria-selected={activeSection.id === section.id}
                  className={`home-help-nav-item ${activeSection.id === section.id ? 'is-active' : ''}`}
                  onClick={() => setActiveSectionId(section.id)}
                >
                  {section.label}
                </button>
              ))}
            </div>
          </aside>

          <div className="home-help-content" role="tabpanel">
            <p className="home-help-kicker">{activeSection.kicker}</p>
            <h2 id="home-help-title">{activeSection.title}</h2>
            <p id="home-help-description" className="home-help-summary">
              {activeSection.summary}
            </p>

            {strategicLinks.length ? (
              <div className="home-help-context-links" aria-label="Liens utiles">
                <span className="home-help-context-links-label">Accès direct:</span>
                {strategicLinks.map((link) => (
                  <button
                    key={link.label}
                    type="button"
                    className={`home-help-linklabel home-help-linklabel--context ${link.disabled ? 'is-disabled' : ''}`}
                    onClick={() => handleNavigate(link.to)}
                    disabled={Boolean(link.disabled)}
                  >
                    {link.label}
                  </button>
                ))}
              </div>
            ) : null}

            {isCreationSection ? (
              <HomeWelcomeHelpCreationSection
                schema={activeSection.schema}
                activeCreationStep={activeCreationStep}
                setActiveCreationStep={setActiveCreationStep}
                activePhase={activePhase}
                demoMatricule={demoMatricule}
                isAnimationPaused={isAnimationPaused}
                onAnimationHoverStart={handleAnimationHoverStart}
                onAnimationHoverEnd={handleAnimationHoverEnd}
                onNextStep={handleNextCreationStep}
              />
            ) : isPurchaseSection ? (
              <HomeWelcomeHelpPurchaseSection
                schema={activeSection.schema}
                activePurchaseStep={activePurchaseStep}
                setActivePurchaseStep={setActivePurchaseStep}
                activePhase={activePurchasePhaseData}
                isAnimationPaused={isAnimationPaused}
                onAnimationHoverStart={handleAnimationHoverStart}
                onAnimationHoverEnd={handleAnimationHoverEnd}
                onNextStep={handleNextPurchaseStep}
              />
            ) : isFarmSection ? (
              <HomeWelcomeHelpFarmSection
                schema={activeSection.schema}
                activeFarmStep={activeFarmStep}
                setActiveFarmStep={setActiveFarmStep}
                activePhase={activeFarmPhaseData}
                isAnimationPaused={isAnimationPaused}
                onAnimationHoverStart={handleAnimationHoverStart}
                onAnimationHoverEnd={handleAnimationHoverEnd}
                onNextStep={handleNextFarmStep}
              />
            ) : isExpeditionSection ? (
              <HomeWelcomeHelpExpeditionSection
                schema={activeSection.schema}
                activeExpeditionStep={activeExpeditionStep}
                setActiveExpeditionStep={setActiveExpeditionStep}
                activePhase={activeExpeditionPhaseData}
                isAnimationPaused={isAnimationPaused}
                onAnimationHoverStart={handleAnimationHoverStart}
                onAnimationHoverEnd={handleAnimationHoverEnd}
                onNextStep={handleNextExpeditionStep}
              />
            ) : (
              <HomeWelcomeHelpSectionsOverview schema={activeSection.schema} />
            )}
          </div>
        </div>
      </section>
    </div>
  );
}

export default HomeWelcomeGuidesModal;
