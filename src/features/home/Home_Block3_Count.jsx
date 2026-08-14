import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../authentification/supabaseClient';
import './Home_Block3_Count.css';
import betail1 from '../../assets/img/betails/betail1.jpeg';
import betail2 from '../../assets/img/betails/betail2.jpg';
import betail3 from '../../assets/img/betails/betail3.png';
import betail4 from '../../assets/img/betails/betail4.webp';
import betail5 from '../../assets/img/betails/betail5.jpg';
import betail6 from '../../assets/img/betails/betail6.webp';
import betail7 from '../../assets/img/betails/betail7.jpg';
import betail8 from '../../assets/img/betails/betail8.webp';
import betail9 from '../../assets/img/betails/betail9.jpg';
import betail10 from '../../assets/img/betails/betail10.webp';
import betail11 from '../../assets/img/betails/betail11.jpg';
import betail12 from '../../assets/img/betails/betail12.jpg';
import betail13 from '../../assets/img/betails/betail13.jpg';
import betail14 from '../../assets/img/betails/betail14.jpg';
import betail15 from '../../assets/img/betails/betail15.jpg';
import betail16 from '../../assets/img/betails/betail16.jpg';
import betail17 from '../../assets/img/betails/betail17.jpg';
import betail18 from '../../assets/img/betails/betail18.jpg';
import betail19 from '../../assets/img/betails/betail19.jpg';
import betail20 from '../../assets/img/betails/betail20.jpg';
import betail21 from '../../assets/img/betails/betail21.jpg';
import betail22 from '../../assets/img/betails/betail22.jpg';
import betail23 from '../../assets/img/betails/betail23.jpg';
import betail24 from '../../assets/img/betails/betail24.jpg';
import betail25 from '../../assets/img/betails/betail25.jpg';
import betail26 from '../../assets/img/betails/betail26.jpg';
import betail27 from '../../assets/img/betails/betail27.jpg';
import betail28 from '../../assets/img/betails/betail28.png';
import betail29 from '../../assets/img/betails/betail29.webp';
import betail30 from '../../assets/img/betails/betail30.jpg';
import betail31 from '../../assets/img/betails/betail31.jpg';
import betail32 from '../../assets/img/betails/betail32.png';

const BETAIL_IMAGES = [
  betail1,
  betail2,
  betail3,
  betail4,
  betail5,
  betail6,
  betail7,
  betail8,
  betail9,
  betail10,
  betail11,
  betail12,
  betail13,
  betail14,
  betail15,
  betail16,
  betail17,
  betail18,
  betail19,
  betail20,
  betail21,
  betail22,
  betail23,
  betail24,
  betail25,
  betail26,
  betail27,
  betail28,
  betail29,
  betail30,
  betail31,
  betail32,
];

const POSITION_PRESETS = [
  { x: '3%', y: '6%', size: '62px', delay: '0s' },
  { x: '14%', y: '3%', size: '56px', delay: '0.8s' },
  { x: '28%', y: '4%', size: '64px', delay: '1.2s' },
  { x: '42%', y: '4%', size: '58px', delay: '0.4s' },
  { x: '58%', y: '4%', size: '62px', delay: '1.6s' },
  { x: '72%', y: '5%', size: '66px', delay: '1s' },
  { x: '86%', y: '8%', size: '60px', delay: '0.2s' },
  { x: '97%', y: '20%', size: '64px', delay: '1.4s' },
  { x: '98%', y: '36%', size: '58px', delay: '0.6s' },
  { x: '96%', y: '52%', size: '62px', delay: '1.1s' },
  { x: '90%', y: '68%', size: '66px', delay: '0.3s' },
  { x: '80%', y: '84%', size: '58px', delay: '1.8s' },
  { x: '62%', y: '94%', size: '62px', delay: '0.9s' },
  { x: '44%', y: '96%', size: '66px', delay: '1.5s' },
  { x: '26%', y: '94%', size: '60px', delay: '0.5s' },
  { x: '10%', y: '84%', size: '64px', delay: '1.9s' },
  { x: '2%', y: '68%', size: '58px', delay: '0.1s' },
  { x: '1%', y: '52%', size: '62px', delay: '1.3s' },
  { x: '2%', y: '36%', size: '56px', delay: '0.7s' },
  { x: '8%', y: '20%', size: '60px', delay: '1.7s' },
  { x: '20%', y: '18%', size: '54px', delay: '0.4s' },
  { x: '34%', y: '16%', size: '60px', delay: '1.2s' },
  { x: '50%', y: '16%', size: '56px', delay: '0.2s' },
  { x: '66%', y: '18%', size: '58px', delay: '1.1s' },
  { x: '80%', y: '26%', size: '54px', delay: '0.6s' },
  { x: '84%', y: '40%', size: '58px', delay: '1.4s' },
  { x: '82%', y: '56%', size: '54px', delay: '0.8s' },
  { x: '74%', y: '72%', size: '58px', delay: '1.6s' },
  { x: '56%', y: '80%', size: '54px', delay: '0.5s' },
  { x: '38%', y: '80%', size: '58px', delay: '1.3s' },
  { x: '22%', y: '70%', size: '54px', delay: '0.9s' },
  { x: '16%', y: '54%', size: '58px', delay: '1.5s' },
];

function HomeBlock3Count() {
  const containerRef = useRef(null);
  const [value, setValue] = useState(0);
  const [isVisible, setIsVisible] = useState(false);
  const animationRef = useRef(null);

  const { data: countData } = useQuery({
    queryKey: ['betails-total-count'],
    queryFn: async () => {
      const { count } = await supabase
        .from('betails')
        .select('id', { count: 'exact', head: true })
        .eq('visible', true);
      return count || 0;
    },
    staleTime: 1000 * 60 * 5, // 5 minutes
  });

  const targetValue = countData ?? 0;
  const duration = 1800;

  useEffect(() => {
    const node = containerRef.current;
    if (!node) return;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          setIsVisible(entry.isIntersecting);
        });
      },
      { threshold: 0.4 }
    );

    observer.observe(node);

    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!isVisible) {
      setValue(0);
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
      return;
    }

    const startTime = performance.now();
    setValue(0);

    const tick = (now) => {
      const progress = Math.min((now - startTime) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      const nextValue = Math.floor(eased * targetValue);
      setValue(nextValue);

      if (progress < 1) {
        animationRef.current = requestAnimationFrame(tick);
      }
    };

    animationRef.current = requestAnimationFrame(tick);

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [isVisible]);

  const digits = useMemo(() => {
    return String(value).padStart(6, '0').split('');
  }, [value]);

  return (
    <div className={`home-block3 ${isVisible ? 'is-visible' : ''}`} ref={containerRef}>
      <div className="home-block3-header">
        <p className="home-block3-eyebrow">Statistiques de FarmGestion</p>
        <h2 className="home-block3-title">Total de bétail</h2>
        <p className="home-block3-subtitle">
          Un aperçu en temps réel du nombre de bétails recensés sur la plateforme.
        </p>
      </div>

      <div className="home-counter-orbit">
        {BETAIL_IMAGES.map((src, index) => {
          const preset = POSITION_PRESETS[index % POSITION_PRESETS.length];
          return (
            <span
              key={`${src}-${index}`}
              className="betail-bubble"
              style={{
                '--x': preset.x,
                '--y': preset.y,
                '--size': preset.size,
                '--delay': preset.delay,
              }}
            >
              <img src={src} alt="Bétail" draggable={false} />
            </span>
          );
        })}

        <div className="home-counter-wrap">
          <div className="home-counter-card" aria-live="polite">
            <div className="home-counter-label">Nombre total</div>
            <div className="home-counter">
              {digits.map((digit, index) => (
                <div className="counter-slot" key={`${digit}-${index}`}>
                  <div className="counter-wheel" style={{ '--digit': Number(digit) }}>
                    <span>0</span>
                    <span>1</span>
                    <span>2</span>
                    <span>3</span>
                    <span>4</span>
                    <span>5</span>
                    <span>6</span>
                    <span>7</span>
                    <span>8</span>
                    <span>9</span>
                  </div>
                </div>
              ))}
            </div>
            <div className="home-counter-foot">bétails recensés</div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default HomeBlock3Count;
