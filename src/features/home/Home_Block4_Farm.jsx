import { useEffect, useState } from 'react';
import './Home_Block4_Farm.css';
import farmCenterExample from '../../assets/img/farmcenterexample.png';
import farmCenterExample2 from '../../assets/img/farmcenterexample2.png';
import farmCenterExample3 from '../../assets/img/farmcenterexample3.png';
import farmCenterExample4 from '../../assets/img/farmcenterexample4.png';
import farmCenterExample5 from '../../assets/img/farmcenterexample5.png';
import farmCenterExample6 from '../../assets/img/farmcenterexample6.webp';
import farmCenterExample7 from '../../assets/img/farmcenterexample7.png';

const COLOR_POOL = ['#FFB3BA', '#BAFFC9', '#BAE1FF', '#FFFFBA', '#E0BBE4', '#FFDFBA', '#BEE3F8', '#FBCFE8'];
const EMOJI_OPTIONS = ['🏡', '😁', '🐣', '👑', '😈', '🍀', '🧺', '👁️', '⚽', '🏆', '🎮'];
const IMAGE_OPTIONS = [farmCenterExample, farmCenterExample2, farmCenterExample3, farmCenterExample4, farmCenterExample5, farmCenterExample6, farmCenterExample7];
const createRandomPalette = () =>
  Array.from({ length: 6 }, () => COLOR_POOL[Math.floor(Math.random() * COLOR_POOL.length)]);

const createRandomCenter = () => {
  const useImage = Math.random() < 0.35;
  if (useImage) {
    const image = IMAGE_OPTIONS[Math.floor(Math.random() * IMAGE_OPTIONS.length)];
    return { type: 'image', value: image };
  }
  const emoji = EMOJI_OPTIONS[Math.floor(Math.random() * EMOJI_OPTIONS.length)];
  return { type: 'emoji', value: emoji };
};

const createHexagonPoints = (cx, cy, radius) => {
  const points = [];
  for (let i = 0; i < 6; i += 1) {
    const angle = (Math.PI / 3) * i - Math.PI / 2;
    const x = cx + radius * Math.cos(angle);
    const y = cy + radius * Math.sin(angle);
    points.push(`${x},${y}`);
  }
  return points.join(' ');
};

const createTrianglePoints = (cx, cy, radius, siteIndex) => {
  const angle1 = (Math.PI / 3) * siteIndex - Math.PI / 2;
  const angle2 = (Math.PI / 3) * (siteIndex + 1) - Math.PI / 2;

  const x1 = cx + radius * Math.cos(angle1);
  const y1 = cy + radius * Math.sin(angle1);
  const x2 = cx + radius * Math.cos(angle2);
  const y2 = cy + radius * Math.sin(angle2);

  return `${cx},${cy} ${x1},${y1} ${x2},${y2}`;
};

function HomeBlock4Farm() {
  const [palette, setPalette] = useState(() => createRandomPalette());
  const [center, setCenter] = useState(() => createRandomCenter());
  const [centerKey, setCenterKey] = useState(0);

  useEffect(() => {
    const intervalId = setInterval(() => {
      setPalette(createRandomPalette());
      setCenter(createRandomCenter());
      setCenterKey((prev) => prev + 1);
    }, 3000);

    return () => clearInterval(intervalId);
  }, []);

  return (
    <div className="home-farm-block">
      <div className="home-farm-text">
        <p className="home-farm-eyebrow">Comprendre les fermes</p>
        <h2 className="home-farm-title">Une ferme est représentée par un hexagone</h2>
        <p className="home-farm-description">
          Ici, la ferme est un hexagone. Chaque quartier représente un site où le bétail
          est réparti pour garder l’équilibre. Tout est pensé pour organiser, surveiller et
          contrôler efficacement votre exploitation.
        </p>
        <p className="home-farm-description">
          Chaque ferme est unique et personnalisable, le centre (emoji ou photo), la couleur de
          chaque site, et même le nom de la ferme.
        </p>
        <p className="home-farm-note">Le centre de la ferme permettra d'ouvrir le menu de configuration.</p>
      </div>

      <div className="home-farm-visual" aria-hidden="true">
        <div className="farm-hexagon-wrap">
          <svg className="farm-hexagon" viewBox="0 0 200 200">
            <polygon
              className="farm-hexagon-outline"
              points={createHexagonPoints(100, 100, 80)}
            />
            {[0, 1, 2, 3, 4, 5].map((siteIndex) => (
              <polygon
                key={siteIndex}
                className="farm-hexagon-site"
                style={{
                  '--site-color': palette[siteIndex],
                  '--site-delay': `${siteIndex * 0.12}s`,
                }}
                points={createTrianglePoints(100, 100, 80, siteIndex)}
              />
            ))}
            <circle className="farm-hexagon-core" cx="100" cy="100" r="25" />
          </svg>

          <div className="farm-hexagon-core-media" key={centerKey}>
            {center.type === 'image' ? (
              <div
                className="farm-hexagon-core-image"
                style={{ backgroundImage: `url(${center.value})` }}
              />
            ) : (
              <span className="farm-hexagon-core-emoji">{center.value}</span>
            )}
          </div>

          <div className="farm-core-click" />
          <div className="farm-core-menu">
            <div className="farm-core-menu-title">Menu de la ferme</div>
            <ul>
              <li>Nom de la ferme</li>
              <li>Centre (emoji/photo)</li>
              <li>Couleurs des sites</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}

export default HomeBlock4Farm;
