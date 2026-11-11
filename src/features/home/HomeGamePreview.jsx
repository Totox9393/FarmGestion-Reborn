import { useState, useEffect, useRef } from 'react';
import { createTrianglePoints } from '../utils/FarmDesign/farmDesignUtils';
import { formatMatricule } from '../utils/formatMatricule';
import yunaImage from '../../assets/img/betails/betail6.webp';
import claraImage from '../../assets/img/betails/betail4.webp';
import suzieImage from '../../assets/img/betails/betail8.webp';
import './HomeGamePreview.css';

const PREVIEWS = [
  { id: 'create', label: 'Créer', title: 'Une image. Un nom. Votre création.', description: 'Inventez un bétail à votre façon. Il rejoint le registre, où les autres joueurs pourront l’acheter.' },
  { id: 'collect', label: 'Collectionner', title: 'Une collection qui vous ressemble.', description: 'Achetez les créations des autres joueurs et retrouvez-les dans votre ferme personnalisée.' },
  { id: 'ship', label: 'Expédier', title: 'À vous de décider de la suite.', description: 'Gardez vos favoris, programmez les expéditions des autres et gagnez de la monnaie pour vos badges.' },
];
const SITE_COLORS = ['#FFB3BA', '#BAFFC9', '#BAE1FF', '#FFFFBA', '#E0BBE4', '#FFDFBA'];
const DEMO_BETAILS = [
  { name: 'Yuna', image: yunaImage, x: 66, y: 25 },
  { name: 'Clara', image: claraImage, x: 69, y: 66 },
  { name: 'Suzie', image: suzieImage, x: 25, y: 48 },
];

// Only bundled demonstration images; no player data is exposed on the landing.
export default function HomeGamePreview() {
  const [activeIndex, setActiveIndex] = useState(0);
  const active = PREVIEWS[activeIndex];
  const [betailIndex, setBetailIndex] = useState(0);
  const betailImages = [yunaImage, claraImage, suzieImage];
  const betailNames = ['Yuna', 'Clara', 'Suzie'];
  const betailMatricules = ['73584', '12345', '67890'];
  const betailDescriptions = [
    'Un air innocent. Un caractère bien à elle.',
    'Une beauté discrète, toujours observée.',
    'Une énergie contagieuse, prête à tout explorer.'
  ];

  useEffect(() => {
    const interval = setInterval(() => {
      setActiveIndex((prev) => (prev + 1) % PREVIEWS.length);
    }, 3000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (active.id === 'create') {
      const betailInterval = setInterval(() => {
        setBetailIndex((prev) => (prev + 1) % betailImages.length);
      }, 2000);
      return () => clearInterval(betailInterval);
    }
  }, [active.id, betailImages.length]);

  return (
    <aside className="home-game-preview" aria-label="Aperçu du fonctionnement du jeu">
      <div className="home-game-preview__heading">
        <span>Dans FarmGestion</span>
      </div>
      <div className="home-game-preview__choices" role="group" aria-label="Choisir un aperçu">
        {PREVIEWS.map((preview, index) => (
          <button
            key={preview.id}
            type="button"
            aria-pressed={activeIndex === index}
            aria-controls="home-game-preview-content"
            onClick={() => setActiveIndex(index)}
          >
            {preview.label}
          </button>
        ))}
      </div>

      <div id="home-game-preview-content" aria-live="polite" aria-atomic="true">
        <div className="home-game-preview__stage">
          {active.id === 'create' && (
            <div className="home-game-preview__creation">
              <div className="home-game-preview__portrait">
                <img src={betailImages[betailIndex]} alt={`${betailNames[betailIndex]}, bétail de démonstration`} width="140" height="140" draggable={false} />
              </div>
              <div className="home-game-preview__identity">
                <span className="home-game-preview__name">{betailNames[betailIndex]}</span>
                <span className="home-game-preview__matricule">{formatMatricule(betailMatricules[betailIndex])}</span>
              </div>
              <p className="home-game-preview__character">« {betailDescriptions[betailIndex]} »</p>
              <span className="home-game-preview__detail">Nom, photo et description personnalisés</span>
            </div>
          )}
          {active.id === 'collect' && (
            <div className="home-game-preview__collection">
              <div className="home-game-preview__farm" role="img" aria-label="Exemple de ferme hexagonale avec trois bétails">
                <svg viewBox="0 0 200 200" aria-hidden="true">
                  {SITE_COLORS.map((color, index) => (
                    <polygon key={color} points={createTrianglePoints(100, 100, 91, index)} fill={color} />
                  ))}
                </svg>
                <span className="home-game-preview__core" aria-hidden="true">🏡</span>
                {DEMO_BETAILS.map((betail) => (
                  <span className="home-game-preview__resident" key={betail.name} style={{ left: `${betail.x}%`, top: `${betail.y}%` }}>
                    <img src={betail.image} alt="" width="48" height="48" draggable={false} />
                  </span>
                ))}
              </div>
              <span className="home-game-preview__detail">Votre nom, vos couleurs, vos bétails</span>
            </div>
          )}
          {active.id === 'ship' && (
            <div className="home-game-preview__shipping">
              <div className="home-game-preview__shipment">
                <span className="home-game-preview__shipment-avatar"><img src={yunaImage} alt="" width="64" height="64" draggable={false} /></span>
                <div><span className="home-game-preview__name">Yuna</span><span className="home-game-preview__matricule">Expédition programmée</span></div>
              </div>
              <ol className="home-game-preview__timeline">
                <li><span>Choisir un bétail</span><small>Une partie de votre collection</small></li>
                <li><span>Planifier son départ</span><small>Retrouvez la date dans votre calendrier</small></li>
                <li><span>Recevoir votre gain</span><small>De la monnaie pour personnaliser votre ferme</small></li>
              </ol>
            </div>
          )}
        </div>
        <div className="home-game-preview__caption">
          <h2>{active.title}</h2>
          <p>{active.description}</p>
        </div>
      </div>
    </aside>
  );
}
