import { useState, useRef } from 'react';
import './BetailMaker.css';


function BetailMaker_QualiteGame3({ disabled, onStart, onComplete }) {
  const [revealed, setRevealed] = useState(false);
  const [isScratching, setIsScratching] = useState(false);
  const [result, setResult] = useState(null);
  const [skipAvailable, setSkipAvailable] = useState(false);
  const scratchTimeoutRef = useRef();
  const didRevealRef = useRef(false);
  // Pour stopper les sons de qualité
  const qualityAudioRef = useRef();

  const doResult = (forcedResult) => {
    if (didRevealRef.current) return;
    didRevealRef.current = true;
    setIsScratching(false);
    setRevealed(true);
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

  const handleScratch = () => {
    if (disabled || revealed || isScratching) {
      return;
    }
    didRevealRef.current = false;
    onStart?.();
    setIsScratching(true);
    setSkipAvailable(true);
    const result = Math.random() < 0.35 ? 'premium' : 'standard';
    scratchTimeoutRef.current = setTimeout(() => {
      doResult(result);
      setSkipAvailable(false);
    }, 1600);
  };

  const handleSkip = () => {
    if (!isScratching) return;
    setSkipAvailable(false);
    if (scratchTimeoutRef.current) clearTimeout(scratchTimeoutRef.current);
    doResult(result || (Math.random() < 0.35 ? 'premium' : 'standard'));
  };

  return (
    <div className="quality-game">
      <div className={`quality-card ${revealed ? 'revealed' : ''}`}>
        <div className="quality-card-result">
          {revealed ? (result === 'premium' ? 'PREMIUM ⭐' : 'STANDARD') : 'Carte mystère'}
        </div>
        {!revealed && (
          <button
            className="quality-card-overlay"
            onClick={handleScratch}
            disabled={disabled || isScratching}
          >
            {isScratching ? 'Grattage...' : 'Gratter la carte'}
          </button>
        )}
      </div>
      {!revealed && (
        <button
          className={`next-button${isScratching && skipAvailable ? ' skip-matricule' : ''}`}
          onClick={isScratching && skipAvailable ? handleSkip : handleScratch}
          disabled={isScratching && skipAvailable ? false : disabled}
        >
          {isScratching && skipAvailable ? 'Skipper' : isScratching ? 'Grattage...' : 'Gratter la carte'}
          <span className="arrow">→</span>
        </button>
      )}
    </div>
  );
}

export default BetailMaker_QualiteGame3;
