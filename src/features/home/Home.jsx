import React, { useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import './Home.css';
import logo from '../../assets/FarmGestion.png';
import orphImage from '../../assets/img/orph.png';
import orphDemonImage from '../../assets/img/orph_demon.png';
import milo1 from '../../assets/img/milo_emotions/milo1.png';
import milo2 from '../../assets/img/milo_emotions/milo2.png';
import milo3 from '../../assets/img/milo_emotions/milo3.png';
import milo4 from '../../assets/img/milo_emotions/milo4.png';
import milo5 from '../../assets/img/milo_emotions/milo5.png';
import milo6 from '../../assets/img/milo_emotions/milo6.png';
import milo7 from '../../assets/img/milo_emotions/milo7.png';
import milo8 from '../../assets/img/milo_emotions/milo8.png';
import milo9 from '../../assets/img/milo_emotions/milo9.png';
import milo10 from '../../assets/img/milo_emotions/milo10.png';
import milo11 from '../../assets/img/milo_emotions/milo11.png';
import milo12 from '../../assets/img/milo_emotions/milo12.png';
import milo13 from '../../assets/img/milo_emotions/milo13.png';
import milo14 from '../../assets/img/milo_emotions/milo14.png';
import milo15 from '../../assets/img/milo_emotions/milo15.png';
import milo16 from '../../assets/img/milo_emotions/milo16.png';
import milo17 from '../../assets/img/milo_emotions/milo17.png';
import milo18 from '../../assets/img/milo_emotions/milo18.png';
import miloInterogation from '../../assets/milo_interogation.png';
import HomeBlock3Count from './Home_Block3_Count';
import HomeBlock4Farm from './Home_Block4_Farm';
import AuthFlowManager from '../authentification/AuthFlowManager';
import { supabase } from '../authentification/supabaseClient';
import { getShortVersionLabel } from '../utils/appVersion';

function Home() {
  const versionBadgeLabel = getShortVersionLabel();
  const homeRef = useRef(null);
  const sectionRefs = useRef([]);
  const [isDemon, setIsDemon] = React.useState(false);
  const [isFlash, setIsFlash] = React.useState(false);
  const authFlowRef = React.useRef();
  const navigate = useNavigate();
  const location = useLocation();

  const miloImages = [
    milo1,
    milo2,
    milo3,
    milo4,
    milo5,
    milo6,
    milo7,
    milo8,
    milo9,
    milo10,
    milo11,
    milo12,
    milo13,
    milo14,
    milo15,
    milo16,
    milo17,
    milo18,
  ];

  const quickStartSteps = [
    {
      title: 'Créez votre ferme',
      text: 'Choisissez son nom et son style visuel pour poser les bases de votre identité.',
    },
    {
      title: 'Créez du bétail',
      text: 'La clé de FarmGestion c\'est le bétail, créez des produits personnalisés et uniques.',
    },
    {
      title: 'Agrémentez votre ferme',
      text: 'Depuis le registre, achetez tous les bétails qui vous font envie pour enrichir votre ferme.',
    },
    {
      title: 'Planifiez les expéditions',
      text: 'Sur FarmGestion, vous devez expédier vos marchandises afin de gagner des 💸',
    },
  ];

  // Ces handlers délèguent à AuthFlowManager via ref
  const handleOpenLogin = () => {
    if (authFlowRef.current) authFlowRef.current.openLogin();
  };
  const handleOpenRegister = () => {
    if (authFlowRef.current) authFlowRef.current.openRegister();
  };

  const handleScrollToNextSection = () => {
    sectionRefs.current[1]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-visible');
          }
        });
      },
      {
        root: homeRef.current,
        threshold: 0.2,
      }
    );

    sectionRefs.current.forEach((section) => {
      if (section) {
        observer.observe(section);
      }
    });

    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let intervalId;
    let flashTimeout;
    const startToggle = () => {
      intervalId = setInterval(() => {
        setIsFlash(true);
        flashTimeout = setTimeout(() => {
          setIsDemon((prev) => !prev);
          setIsFlash(false);
        }, 220);
      }, 5500);
    };

    startToggle();

    return () => {
      clearInterval(intervalId);
      clearTimeout(flashTimeout);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    let opening = false;

    const openFarmCreationIfNeeded = async () => {
      if (opening || cancelled) return;
      opening = true;
      try {
        const { data: userData } = await supabase.auth.getUser();
        const currentUser = userData?.user;
        if (!currentUser || cancelled) return;
        const { data } = await supabase
          .from('users_profiles')
          .select('farm_id')
          .eq('id', currentUser.id)
          .maybeSingle();
        if (!cancelled && !data?.farm_id) {
          authFlowRef.current?.openFarmCreation?.();
        }
      } finally {
        // Keep the marker during this whole effect. AppRoutes reads the same
        // marker and must not redirect to /home before the stepper is opened.
        if (!cancelled) {
          sessionStorage.removeItem('fg_forceFarmCreation');
        }
        opening = false;
      }
    };

    const handleForceFarmCreation = () => {
      void openFarmCreationIfNeeded();
    };

    window.addEventListener('farmgestion-open-farm-creation', handleForceFarmCreation);

    if (sessionStorage.getItem('fg_forceFarmCreation')) {
      void openFarmCreationIfNeeded();
    }

    return () => {
      cancelled = true;
      window.removeEventListener('farmgestion-open-farm-creation', handleForceFarmCreation);
    };
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (params.get('auth') !== 'login') return;
    authFlowRef.current?.openLogin?.();
    params.delete('auth');
    const nextSearch = params.toString();
    const nextUrl = `${location.pathname}${nextSearch ? `?${nextSearch}` : ''}`;
    navigate(nextUrl, { replace: true });
  }, [location.pathname, location.search, navigate]);

  return (
    <div className="home" ref={homeRef}>
      <section
        className="home-section home-section-hero"
        ref={(el) => {
          sectionRefs.current[0] = el;
        }}
      >
        <div className="home-hero-bg" aria-hidden="true">
          {miloImages.map((src, index) => (
            <img
              key={src}
              src={src}
              alt=""
              className={`home-hero-milo milo-${index + 1}`}
              loading="lazy"
              draggable={false}
            />
          ))}
        </div>
        <div className="home-container">
          <div className="logo-container">
            <img
              src={logo}
              alt="FarmGestion Logo"
              className="home-logo"
              draggable={false}
            />
            <span className="home-version-badge">{versionBadgeLabel}</span>
          </div>
          <p className="home-description">
            Vous gerez ce qu'ils ne doivent pas savoir...
          </p>
          <div className="home-auth-actions">
            <button className="home-auth-button" onClick={handleOpenRegister}>
              Créer un compte
            </button>
            <button className="home-auth-button" onClick={handleOpenLogin}>
              Se connecter
            </button>
            <button className="home-info-button" onClick={() => navigate('/rules')}>
              Consulter le règlement
            </button>
          </div>

          <AuthFlowManager ref={authFlowRef} />
        </div>

        <button
          type="button"
          className="home-scroll-hint"
          onClick={handleScrollToNextSection}
          aria-label="Descendre vers la section suivante"
        >
          <span className="home-scroll-mouse" aria-hidden="true">
            <span className="home-scroll-wheel" />
          </span>
          <span className="home-scroll-arrow" aria-hidden="true" />
        </button>
      </section>

      <section
        className="home-section home-section-quickstart"
        ref={(el) => {
          sectionRefs.current[1] = el;
        }}
      >
        <div className="home-quickstart">
          <div className="home-quickstart-header">
            <img src={miloInterogation} alt="Milo interrogation" className="home-quickstart-milo" />
            <p className="home-quickstart-eyebrow">Prise en main rapide</p>
            <h2 className="home-quickstart-title">FarmGestion en 4 etapes</h2>
            <p className="home-quickstart-subtitle">
              Une boucle simple a comprendre, avec juste ce qu il faut pour bien demarrer.
            </p>
          </div>

          <div className="home-quickstart-grid">
            {quickStartSteps.map((step, index) => (
              <article key={step.title} className="home-quickstart-card">
                <span className="home-quickstart-number">{String(index + 1).padStart(2, '0')}</span>
                <h3>{step.title}</h3>
                <p>{step.text}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section
        className="home-section home-section-secondary"
        ref={(el) => {
          sectionRefs.current[2] = el;
        }}
      >
        <div className="home-secondary">
          <div className="home-secondary-text">
            <h2 className="home-secondary-title">Ils pensent être en sécurité...</h2>
            <p>
              Dans FarmGestion, vous gérez votre ferme et votre bétail en toute simplicité.
              Le sort de votre bétail est entre vos mains. Cependant, méfiez-vous des apparences,
              car dans ce monde, rien n'est jamais vraiment sûr.
              Persuadés d'être adoptés par une famille aimante, vos bétails vivent dans l'illusion
              d'une vie paisible. Mais derrière cette façade rassurante se cache une réalité
              bien plus sombre.
            </p>
          </div>
          <div className="home-secondary-visual">
            <div className="orph-visual">
              <img
                src={isDemon ? orphDemonImage : orphImage}
                alt="Illustration du projet"
                draggable={false}
                className={`orph-image ${isDemon ? 'is-demon' : ''} ${isFlash ? 'is-flashing' : ''}`}
              />
              {isFlash && (
                <div
                  className="orph-glitch"
                  style={{ '--orph-mask': `url(${isDemon ? orphDemonImage : orphImage})` }}
                  aria-hidden="true"
                />
              )}
            </div>
          </div>
        </div>
      </section>

      <section
        className="home-section home-section-count"
        ref={(el) => {
          sectionRefs.current[3] = el;
        }}
      >
        <HomeBlock3Count />
      </section>

      <section
        className="home-section home-section-farm"
        ref={(el) => {
          sectionRefs.current[4] = el;
        }}
      >
        <HomeBlock4Farm />
      </section>

      <AuthFlowManager />
    </div>
  );
}

export default Home;
