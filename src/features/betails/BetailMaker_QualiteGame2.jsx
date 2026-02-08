import { useState, useRef } from 'react';
import './BetailMaker.css';


function BetailMaker_QualiteGame2({ disabled, onStart, onComplete }) {
  const [rolling, setRolling] = useState(false);
  const [face, setFace] = useState('—');
  const [isDone, setIsDone] = useState(false);
  const [result, setResult] = useState(null);
  const [skipAvailable, setSkipAvailable] = useState(false);
  const intervalRef = useRef();
  const timeoutRef = useRef();

  // Pour stopper les sons de qualité
  const qualityAudioRef = useRef();
  const didRevealRef = useRef(false);
  const doResult = (forcedResult, forcedFace) => {
    if (didRevealRef.current) return;
    didRevealRef.current = true;
    setRolling(false);
    setIsDone(true);
    setResult(forcedResult);
    setFace(String(forcedFace));
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

  const handleRoll = () => {
    if (disabled || rolling) {
      return;
    }
    didRevealRef.current = false;
    onStart?.();
    setRolling(true);
    setSkipAvailable(true);
    let ticks = 0;
    intervalRef.current = setInterval(() => {
      setFace(String(Math.floor(Math.random() * 6) + 1));
      ticks += 1;
      if (ticks > 10) {
        clearInterval(intervalRef.current);
        const final = Math.floor(Math.random() * 6) + 1;
        setFace(String(final));
        const result = final <= 2 ? 'premium' : 'standard';
        timeoutRef.current = setTimeout(() => {
          doResult(result, final);
          setSkipAvailable(false);
        }, 700);
      }
    }, 120);
  };

  const handleSkip = () => {
    if (!rolling) return;
    setSkipAvailable(false);
    clearInterval(intervalRef.current);
    clearTimeout(timeoutRef.current);
    // On prend la face affichée si possible, sinon on génère
    let final = parseInt(face, 10);
    if (isNaN(final) || final < 1 || final > 6) {
      final = Math.floor(Math.random() * 6) + 1;
    }
    setFace(String(final));
    const res = final <= 2 ? 'premium' : 'standard';
    doResult(res, final);
  };

  return (
    <div className="quality-game">
      <div className={`quality-dice ${rolling ? 'rolling' : ''}`}>{face}</div>
      {!isDone && (
        <button
          className={`next-button${rolling && skipAvailable ? ' skip-matricule' : ''}`}
          onClick={rolling && skipAvailable ? handleSkip : handleRoll}
          disabled={rolling && skipAvailable ? false : disabled}
        >
          {rolling && skipAvailable ? 'Skipper' : rolling ? 'Lancement...' : 'Lancer le dé'}
          <span className="arrow">→</span>
        </button>
      )}
    </div>
  );
}

export default BetailMaker_QualiteGame2;
