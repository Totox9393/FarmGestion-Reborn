import { useState, useEffect, useRef } from 'react';
import './BetailMaker.css';


function BetailMaker_QualiteGame1({ disabled, onStart, onComplete }) {
  const [isSpinning, setIsSpinning] = useState(false);
  const [isDone, setIsDone] = useState(false);
  const [result, setResult] = useState(null);
  const [skipAvailable, setSkipAvailable] = useState(false);
  const spinTimeoutRef = useRef();
  const didRevealRef = useRef(false);
  // Pour stopper les sons de qualité
  const qualityAudioRef = useRef();

  const doResult = (forcedResult) => {
    if (didRevealRef.current) return;
    didRevealRef.current = true;
    setIsSpinning(false);
    setIsDone(true);
    setResult(forcedResult);
    // Stoppe le son précédent
    if (qualityAudioRef.current) {
      try { qualityAudioRef.current.pause(); qualityAudioRef.current.currentTime = 0; } catch {}
      qualityAudioRef.current = null;
    }
    // Joue le son de qualité
    try {
      const src = forcedResult === 'premium'
        ? require('../../assets/sounds/WAV_47_GUESS_BNK_SE_COMMON.wav')
        : require('../../assets/sounds/00111 - WAV_111_GUESS_BNK_SE_COMMON.wav');
      const audio = new Audio(src);
      audio.volume = 0.4;
      audio.play();
      qualityAudioRef.current = audio;
    } catch {}
    onComplete(forcedResult);
  };

  const handleSpin = () => {
    if (disabled || isSpinning) {
      return;
    }
    didRevealRef.current = false;
    onStart?.();
    setIsSpinning(true);
    setSkipAvailable(true);
    const result = Math.random() < 0.35 ? 'premium' : 'standard';
    spinTimeoutRef.current = setTimeout(() => {
      doResult(result);
      setSkipAvailable(false);
    }, 2200);
  };

  const handleSkip = () => {
    if (!isSpinning) return;
    setSkipAvailable(false);
    if (spinTimeoutRef.current) clearTimeout(spinTimeoutRef.current);
    doResult(result || (Math.random() < 0.35 ? 'premium' : 'standard'));
  };

  return (
    <div className="quality-game">
      <div className={`quality-wheel ${isSpinning ? 'spinning' : ''}`}>
        <div className="quality-wheel-center">⭐</div>
      </div>
      {!isDone && (
        <button
          className={`next-button${isSpinning && skipAvailable ? ' skip-matricule' : ''}`}
          onClick={isSpinning && skipAvailable ? handleSkip : handleSpin}
          disabled={isSpinning && skipAvailable ? false : disabled}
        >
          {isSpinning && skipAvailable ? 'Skipper' : isSpinning ? 'Évaluation en cours...' : 'Lancer la roue'}
          <span className="arrow">→</span>
        </button>
      )}
    </div>
  );
}

export default BetailMaker_QualiteGame1;
