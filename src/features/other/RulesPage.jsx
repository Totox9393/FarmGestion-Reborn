import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Hexagon, Info, Users, Ban, MessageCircle, ShieldCheck } from 'lucide-react';
import { useAuth } from '../authentification/AuthContext';
import { supabase } from '../authentification/supabaseClient';
import AuthenticatedLayout from '../home/AuthenticatedLayout';
import { getLocalThemePreference } from '../settings/themePreferences';
import './RulesPage.css';

const generalRules = [
  {
    title: '1. Respect mutuel',
    description: "Les utilisateurs doivent faire preuve de respect les uns envers les autres. Aucune forme de harcèlement, d'intimidation ou de comportement abusif ne sera tolérée.",
  },
  {
    title: '2. Contenu approprié',
    description: 'Le contenu partagé sur la plateforme doit rester approprié et ne pas contenir d’éléments offensants, violents, à caractère sexuel ou discriminatoires.',
  },
  {
    title: '3. Informations personnelles',
    description: "Il est interdit de partager des informations personnelles d'autres utilisateurs sans leur consentement explicite.",
  },
];

const registrationRules = [
  {
    title: '1. Images appropriées',
    description: 'Les images utilisées pour représenter le bétail doivent respecter les directives de contenu. Les visuels obscènes, violents ou inappropriés seront retirés.',
  },
  {
    title: '2. Noms et descriptions',
    description: 'Les noms et descriptions doivent rester appropriés. Les références offensantes, discriminatoires ou à caractère sexuel sont interdites.',
  },
  {
    title: '3. Fraude et manipulation',
    description: "Il est interdit d'exploiter des failles techniques ou de manipuler le système d'évaluation pour obtenir des avantages injustes.",
  },
];

const sanctions = [
  'Avertissement officiel',
  'Suppression du contenu inapproprié',
  'Suspension temporaire du compte',
  'Suspension définitive du compte',
];

function RulesPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const onboardingQuery = useQuery({
    queryKey: ['rules', 'onboarding', user?.id],
    enabled: Boolean(user?.id),
    staleTime: 15000,
    gcTime: 60000,
    retry: 1,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('users_profiles')
        .select('farm_id, avatar_url')
        .eq('id', user.id)
        .maybeSingle();

      if (error) throw error;

      const hasFarm = Boolean(data?.farm_id);
      const hasAvatar = typeof data?.avatar_url === 'string'
        ? data.avatar_url.trim().length > 0
        : Boolean(data?.avatar_url);

      return hasFarm && hasAvatar;
    },
  });

  const isOnboardingComplete = Boolean(onboardingQuery.data);
  const checkingOnboarding = Boolean(user?.id) && onboardingQuery.isLoading;
  const isAuthenticated = Boolean(user) && isOnboardingComplete;
  const [theme, setTheme] = useState(() => getLocalThemePreference());

  useEffect(() => {
    if (!isAuthenticated) {
      return undefined;
    }
    const updateTheme = () => {
      setTheme(getLocalThemePreference());
    };
    updateTheme();
    window.addEventListener('farmgestion-theme-change', updateTheme);
    window.addEventListener('storage', updateTheme);
    return () => {
      window.removeEventListener('farmgestion-theme-change', updateTheme);
      window.removeEventListener('storage', updateTheme);
    };
  }, [isAuthenticated]);

  const content = (
    <div className="rules-wrapper">
      {!isAuthenticated && (
        <div className="rules-guest-actions">
          <button
            type="button"
            className="rules-back-button"
            onClick={() => navigate('/')}
          >
            ← Retour à l'accueil
          </button>
        </div>
      )}
      <div>
        <div className="rules-hero">
          <h1>Règlement de FarmGestion</h1>
          <p>Directives et règles à respecter sur la plateforme</p>
        </div>

        <div className="rules-card">
          <div className="rules-card__header">
            <div className="rules-card__title">
              <Hexagon className="rules-card__icon" />
              <div>
                <p className="rules-card__eyebrow">Document officiel</p>
                <h2>Règlement général</h2>
              </div>
            </div>
            <span className="rules-card__badge">Version 1.0</span>
          </div>
          <p className="rules-card__subtitle">Ce règlement s'applique à tous les utilisateurs de FarmGestion.</p>

          <div className="rules-alert">
            <AlertTriangle className="rules-alert__icon" />
            <div>
              <h3>Important</h3>
              <p>
                L'inscription et l'utilisation de FarmGestion impliquent l'acceptation pleine et entière du présent règlement.
                Le non-respect de ces règles peut entraîner des sanctions allant jusqu'à la suspension définitive du compte.
              </p>
            </div>
          </div>

          <section>
            <h3 className="rules-section__title">
              <Info className="rules-section__icon info" />
              Règles générales
            </h3>
            <div className="rules-grid">
              {generalRules.map(rule => (
                <article key={rule.title} className="rules-tile">
                  <h4>{rule.title}</h4>
                  <p>{rule.description}</p>
                </article>
              ))}
            </div>
          </section>

          <section>
            <h3 className="rules-section__title">
              <Users className="rules-section__icon users" />
              Règles d'enregistrement du bétail
            </h3>
            <div className="rules-grid">
              {registrationRules.map(rule => (
                <article key={rule.title} className="rules-tile">
                  <h4>{rule.title}</h4>
                  <p>{rule.description}</p>
                </article>
              ))}
            </div>
          </section>

          <section>
            <h3 className="rules-section__title">
              <Ban className="rules-section__icon ban" />
              Sanctions
            </h3>
            <div className="rules-sanctions">
              <p>En cas de non-respect, les administrateurs peuvent appliquer :</p>
              <ul>
                {sanctions.map(item => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          </section>

          <section>
            <h3 className="rules-section__title">
              <MessageCircle className="rules-section__icon contact" />
              Contact
            </h3>
            <div className="rules-contact">
              <p>
                Pour toute question ou pour signaler un comportement inapproprié, contactez Totox via le formulaire ou à
                <a href="mailto:contact@totox.fr">contact@totox.fr</a>.
              </p>
            </div>
          </section>

          <div className="rules-conclusion">
            <ShieldCheck className="rules-conclusion__icon" />
            <div>
              <h3>Engagement de la communauté</h3>
              <p>
                FarmGestion s'engage à offrir une expérience positive et sécurisée à tous ses utilisateurs. Nous comptons sur
                la collaboration de chacun pour maintenir une communauté respectueuse et bienveillante.
              </p>
            </div>
          </div>

          <p className="rules-updated">Dernière mise à jour : 15 septembre 2025</p>
        </div>
      </div>
    </div>
  );

  if (isAuthenticated) {
    return (
      <AuthenticatedLayout>
        <div className="rules-page" data-theme={theme}>
          {content}
        </div>
      </AuthenticatedLayout>
    );
  }

  return (
    <div className="rules-page" data-theme="hero">
      {checkingOnboarding ? null : content}
    </div>
  );
}

export default RulesPage;
