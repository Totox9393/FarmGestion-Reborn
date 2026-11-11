import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../authentification/AuthContext';
import { supabase } from '../authentification/supabaseClient';
import AuthenticatedLayout from '../home/AuthenticatedLayout';
import { getLocalThemePreference } from '../settings/themePreferences';
import './RulesPage.css';

const generalRules = [
  {
    title: 'Respect mutuel',
    description: "Les utilisateurs doivent faire preuve de respect les uns envers les autres. Aucune forme de harcèlement, d'intimidation ou de comportement abusif ne sera tolérée.",
  },
  {
    title: 'Contenu approprié',
    description: 'Le contenu partagé sur la plateforme doit rester approprié et ne pas contenir d’éléments offensants, violents, à caractère sexuel ou discriminatoires.',
  },
  {
    title: 'Informations personnelles',
    description: "Il est interdit de partager des informations personnelles d'autres utilisateurs sans leur consentement explicite.",
  },
];

const registrationRules = [
  {
    title: 'Images appropriées',
    description: 'Les images utilisées pour représenter le bétail doivent respecter les directives de contenu. Les visuels obscènes, violents ou inappropriés seront retirés.',
  },
  {
    title: 'Noms et descriptions',
    description: 'Les noms et descriptions doivent rester appropriés. Les références offensantes, discriminatoires ou à caractère sexuel sont interdites.',
  },
  {
    title: 'Fraude et manipulation',
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
    <main className="rules-wrapper">
      {!isAuthenticated && (
        <Link className="rules-back-link" to="/">Retour à l’accueil</Link>
      )}
      <header className="rules-header">
        <h1>Règlement de FarmGestion</h1>
        <p>Ce règlement s’applique à tous les utilisateurs de FarmGestion.</p>
        <div className="rules-meta">
          <span>Version 1.1</span>
          <span>Mis à jour le <time dateTime="2026-11-08">8 Novembre 2026</time></span>
        </div>
      </header>

      <div className="rules-layout">
        <nav className="rules-contents" aria-label="Sommaire du règlement">
          <h2>Dans cette page</h2>
          <a href="#rules-general">Règles générales</a>
          <a href="#rules-creation">Création de bétail</a>
          <a href="#rules-sanctions">Sanctions</a>
          <a href="#rules-contact">Contact</a>
          <a href="#rules-commitment">Notre engagement</a>
        </nav>

        <div className="rules-document">
          <p className="rules-introduction">
            L'inscription et l'utilisation de FarmGestion impliquent l'acceptation pleine et entière du présent règlement.
            Le non-respect de ces règles peut entraîner des sanctions allant jusqu'à la suspension définitive du compte.
          </p>

          <section id="rules-general" className="rules-section" aria-labelledby="rules-general-title" tabIndex={-1}>
            <h2 id="rules-general-title">Règles générales</h2>
            <dl className="rules-list">
              {generalRules.map(rule => (
                <div key={rule.title}>
                  <dt>{rule.title}</dt>
                  <dd>{rule.description}</dd>
                </div>
              ))}
            </dl>
          </section>

          <section id="rules-creation" className="rules-section" aria-labelledby="rules-creation-title" tabIndex={-1}>
            <h2 id="rules-creation-title">Création de bétail</h2>
            <dl className="rules-list">
              {registrationRules.map(rule => (
                <div key={rule.title}>
                  <dt>{rule.title}</dt>
                  <dd>{rule.description}</dd>
                </div>
              ))}
            </dl>
          </section>

          <section id="rules-sanctions" className="rules-section" aria-labelledby="rules-sanctions-title" tabIndex={-1}>
            <h2 id="rules-sanctions-title">Sanctions</h2>
            <p>En cas de non-respect, les administrateurs peuvent appliquer :</p>
            <ul className="rules-sanctions-list">
              {sanctions.map(item => <li key={item}>{item}</li>)}
            </ul>
          </section>

          <section id="rules-contact" className="rules-section" aria-labelledby="rules-contact-title" tabIndex={-1}>
            <h2 id="rules-contact-title">Contact</h2>
            <p>
              Pour toute question ou pour signaler un comportement inapproprié, contactez Totox via l'adresse {' '}
              <a href="mailto:contact@totox.fr">contact@totox.fr</a>.
            </p>
          </section>

          <section id="rules-commitment" className="rules-section" aria-labelledby="rules-commitment-title" tabIndex={-1}>
            <h2 id="rules-commitment-title">Engagement de la communauté</h2>
            <p>
              FarmGestion s'engage à offrir une expérience positive et sécurisée à tous ses utilisateurs. Nous comptons sur
              la collaboration de chacun pour maintenir une communauté respectueuse et bienveillante.
            </p>
          </section>
        </div>
      </div>
    </main>
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
