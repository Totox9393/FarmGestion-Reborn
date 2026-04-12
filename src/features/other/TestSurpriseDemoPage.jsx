import { useEffect, useMemo, useRef, useState } from 'react';
import './TestSurpriseDemoPage.css';
import chompBadgeImage from '../../assets/img/farmcenterexample5.png';
import { getSurpriseAnimationById, surpriseAnimationPresets } from './animation/surpriseAnimationPresets';

const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, value));

function formatMoney(value) {
  return new Intl.NumberFormat('fr-FR').format(value);
}

function TestSurpriseDemoPage() {
  const rafRef = useRef(0);
  const previousFrameRef = useRef(0);

  const [selectedAnimationId, setSelectedAnimationId] = useState(surpriseAnimationPresets[0]?.id || '');
  const [isPlaying, setIsPlaying] = useState(false);
  const [hasStarted, setHasStarted] = useState(false);
  const [progress, setProgress] = useState(0);

  const selectedAnimation = useMemo(
    () => getSurpriseAnimationById(selectedAnimationId),
    [selectedAnimationId],
  );

  useEffect(() => {
    if (!isPlaying) {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = 0;
      }
      previousFrameRef.current = 0;
      return undefined;
    }

    const tick = (timestamp) => {
      if (!previousFrameRef.current) {
        previousFrameRef.current = timestamp;
      }

      const delta = timestamp - previousFrameRef.current;
      previousFrameRef.current = timestamp;

      setProgress((current) => {
        const next = clamp(current + delta / selectedAnimation.durationMs);
        if (next >= 1) {
          setIsPlaying(false);
          return 1;
        }
        return next;
      });

      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);

    return () => {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = 0;
      }
    };
  }, [isPlaying, selectedAnimation.durationMs]);

  useEffect(() => {
    setIsPlaying(false);
    setHasStarted(false);
    setProgress(0);
  }, [selectedAnimationId]);

  useEffect(() => {
    return () => {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
      }
    };
  }, []);

  const timeline = useMemo(
    () => selectedAnimation.getTimeline(progress, hasStarted),
    [selectedAnimation, progress, hasStarted],
  );

  const handlePlay = () => {
    if (!hasStarted) {
      setHasStarted(true);
      setProgress(0);
    }
    setIsPlaying(true);
  };

  const handlePause = () => {
    setIsPlaying(false);
  };

  const handleReplay = () => {
    setHasStarted(true);
    setProgress(0);
    setIsPlaying(true);
  };

  const handleValidateClick = () => {
    setHasStarted(true);
    if (progress >= 1) {
      setProgress(0);
    }
    setIsPlaying(true);
  };

  return (
    <main className="test-demo-page">
      <header className="test-demo-header">
        <p className="test-demo-kicker">Mode tournage</p>
        <h1>Démo surprise QR - FarmGestion</h1>
        <p>Animation de 8 secondes dans un format téléphone, prête pour capture vidéo.</p>
      </header>

      <section className="test-demo-layout">
        <div className="test-demo-phone" role="presentation">
          <div className="test-demo-notch" />

          <div className="test-demo-screen">
            <div className="test-demo-bg-orb test-demo-bg-orb--one" />
            <div className="test-demo-bg-orb test-demo-bg-orb--two" />

            <div
              className="test-demo-register"
              style={{
                opacity: timeline.formOpacity,
                transform: `translateY(${timeline.formShift}px) scale(${1 - timeline.rewardOpacity * 0.04})`,
              }}
            >
              <p className="test-demo-register__eyebrow">{selectedAnimation.content.eyebrow}</p>
              <h2>{selectedAnimation.content.title}</h2>
              <p className="test-demo-register__subtitle">{selectedAnimation.content.subtitle}</p>

              <div className="test-demo-field-list">
                <label>
                  <span>Pseudo</span>
                  <input type="text" value={selectedAnimation.content.pseudo} readOnly />
                </label>
                <label>
                  <span>Email</span>
                  <input type="email" value={selectedAnimation.content.email} readOnly />
                </label>
                <label>
                  <span>Code surprise</span>
                  <input type="text" value={selectedAnimation.content.surpriseCode} readOnly />
                </label>
              </div>

              <button type="button" className="test-demo-validate" onClick={handleValidateClick}>
                {selectedAnimation.content.buttonLabel}
              </button>
            </div>

            <div className="test-demo-reward" style={{ opacity: timeline.rewardOpacity }}>
              <div className="test-demo-rays-wrap" aria-hidden="true">
                <div className="test-demo-rays" />
              </div>
              <p className="test-demo-reward__eyebrow">{selectedAnimation.content.rewardEyebrow}</p>
              <h2 style={{ transform: `scale(${timeline.headlineScale})` }}>{selectedAnimation.content.rewardTitle}</h2>

              <div className="test-demo-badge-wrap" style={{ '--badge-glow': timeline.badgeGlow }}>
                <div className="test-demo-badge-tier">{selectedAnimation.content.badgeTier}</div>
                <div className="test-demo-badge-card">
                  <img
                    src={chompBadgeImage}
                    alt="Badge épique"
                  />
                </div>
                <p className="test-demo-badge-name">Badge exclusif: {selectedAnimation.content.badgeName}</p>
              </div>

              <div className="test-demo-money" style={{ opacity: timeline.moneyReveal, transform: `translateY(${(1 - timeline.moneyReveal) * 18}px)` }}>
                +{formatMoney(selectedAnimation.content.money)} argent crédité
              </div>

              <p className="test-demo-footer" style={{ opacity: timeline.ctaReveal }}>{selectedAnimation.content.rewardFooter}</p>
            </div>
          </div>
        </div>

        <aside className="test-demo-controls">
          <label className="test-demo-controls__select">
            <span>Animation</span>
            <select value={selectedAnimationId} onChange={(event) => setSelectedAnimationId(event.target.value)}>
              {surpriseAnimationPresets.map((preset) => (
                <option key={preset.id} value={preset.id}>
                  {preset.label}
                </option>
              ))}
            </select>
            <small>{selectedAnimation.description}</small>
          </label>

          <div className="test-demo-controls__progress">
            <p>Progression</p>
            <div className="test-demo-progress-track" aria-hidden="true">
              <span style={{ transform: `scaleX(${progress})` }} />
            </div>
            <small>{Math.round(progress * selectedAnimation.durationMs)} ms / {selectedAnimation.durationMs} ms</small>
          </div>

          <div className="test-demo-controls__buttons">
            <button type="button" className="test-demo-btn" onClick={isPlaying ? handlePause : handlePlay}>
              {isPlaying ? 'Pause' : 'Play'}
            </button>
            <button type="button" className="test-demo-btn test-demo-btn--secondary" onClick={handleReplay}>
              Replay
            </button>
          </div>

          <p className="test-demo-note">
            Astuce capture: clique d'abord sur <strong>Replay</strong>, attends 1 seconde, puis démarre l'enregistrement.
          </p>
        </aside>
      </section>
    </main>
  );
}

export default TestSurpriseDemoPage;
