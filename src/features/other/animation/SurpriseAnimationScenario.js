const DEFAULT_DURATION_MS = 8000;
const DEFAULT_REWARD_START = 0.3;

const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, value));

const easeInOutCubic = (value) => {
  const t = clamp(value);
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
};

export class SurpriseAnimationScenario {
  constructor(config) {
    this.id = config.id;
    this.label = config.label;
    this.description = config.description || '';
    this.durationMs = config.durationMs || DEFAULT_DURATION_MS;
    this.rewardStartProgress = typeof config.rewardStartProgress === 'number'
      ? config.rewardStartProgress
      : DEFAULT_REWARD_START;
    this.content = {
      eyebrow: config.content?.eyebrow || 'Bienvenue sur FarmGestion',
      title: config.content?.title || 'Créer un compte',
      subtitle: config.content?.subtitle || "Inscris-toi avec ton lien surprise pour récupérer ton bonus.",
      pseudo: config.content?.pseudo || 'Samara',
      email: config.content?.email || 'samara@ferme.fr',
      surpriseCode: config.content?.surpriseCode || 'FARMPRO2026',
      buttonLabel: config.content?.buttonLabel || "Valider le code et m'inscrire",
      rewardEyebrow: config.content?.rewardEyebrow || 'Code surprise activé',
      rewardTitle: config.content?.rewardTitle || 'Récompense débloquée',
      badgeTier: config.content?.badgeTier || 'Épique',
      badgeName: config.content?.badgeName || 'CHOMP',
      money: Number(config.content?.money || 200),
      rewardFooter: config.content?.rewardFooter || 'Bonus ajouté automatiquement à ton compte.',
    };
  }

  getTimeline(progress, hasStarted) {
    const rewardOpacity = hasStarted
      ? easeInOutCubic((progress - this.rewardStartProgress) / 0.26)
      : 0;

    const formOpacity = clamp(1 - rewardOpacity * 1.1);
    const formShift = rewardOpacity * -56;

    return {
      rewardOpacity,
      formOpacity,
      formShift,
      headlineScale: 1 + clamp((progress - 0.58) / 0.18) * 0.08,
      badgeGlow: clamp((progress - 0.56) / 0.14),
      moneyReveal: clamp((progress - 0.64) / 0.2),
      ctaReveal: clamp((progress - 0.8) / 0.15),
    };
  }
}
