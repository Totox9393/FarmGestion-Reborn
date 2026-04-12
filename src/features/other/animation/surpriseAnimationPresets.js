import { SurpriseAnimationScenario } from './SurpriseAnimationScenario';

const PRESET_CONFIGS = [
  {
    id: 'promo-chomp',
    label: 'Promo CHOMP (standard)',
    description: 'Animation surprise classique avec bonus argent et badge CHOMP.',
    durationMs: 8000,
    rewardStartProgress: 0.3,
    content: {
      eyebrow: 'Bienvenue sur FarmGestion',
      title: 'Créer un compte',
      subtitle: "Inscris-toi avec ton lien surprise pour récupérer ton bonus.",
      pseudo: 'Samara',
      email: 'samara@ferme.fr',
      surpriseCode: 'FARMPRO2026',
      buttonLabel: "Valider le code et m'inscrire",
      rewardEyebrow: 'Code surprise activé',
      rewardTitle: 'Récompense débloquée',
      badgeTier: 'Épique',
      badgeName: 'CHOMP',
      money: 200,
      rewardFooter: 'Bonus ajouté automatiquement à ton compte.',
    },
  },
  {
    id: 'event-chomp-max',
    label: 'Événement CHOMP (fort impact)',
    description: 'Version plus dynamique pour les captations marketing courtes.',
    durationMs: 8000,
    rewardStartProgress: 0.26,
    content: {
      eyebrow: 'Nouveau joueur détecté',
      title: 'Inscription express',
      subtitle: 'Ton code partenaire active une récompense exclusive en direct.',
      pseudo: 'Nina',
      email: 'nina@farmgestion.fr',
      surpriseCode: 'TOULOUSE-QR-2026',
      buttonLabel: 'Activer mon bonus',
      rewardEyebrow: 'Lien surprise validé',
      rewardTitle: 'Bonus marketing obtenu',
      badgeTier: 'Épique',
      badgeName: 'CHOMP',
      money: 350,
      rewardFooter: 'Récompense ajoutée et visible immédiatement.',
    },
  },
];

export const surpriseAnimationPresets = PRESET_CONFIGS.map((config) => new SurpriseAnimationScenario(config));

export function getSurpriseAnimationById(id) {
  return surpriseAnimationPresets.find((preset) => preset.id === id) || surpriseAnimationPresets[0];
}
