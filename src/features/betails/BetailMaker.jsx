import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Fingerprint, ChevronsRight } from 'lucide-react';
import './BetailMaker.css';
import miloImage from '../../assets/milo_CLASSIQUE.png';
import digitSound1 from '../../assets/sounds/COUNT_DOWN_10.wav';
import digitSound2 from '../../assets/sounds/COUNT_DOWN_10.wav';
import digitSound3 from '../../assets/sounds/COUNT_DOWN_10.wav';
import digitSound4 from '../../assets/sounds/COUNT_DOWN_3.wav';
import digitSound5 from '../../assets/sounds/COUNT_DOWN_1.wav';
import ageTickSound from '../../assets/sounds/drop_003.ogg';
import defaultProfileImage from '../../assets/defaut_profile.png';
import BetailMaker_QualiteGame1 from './BetailMaker_QualiteGame1';
import BetailMaker_QualiteGame2 from './BetailMaker_QualiteGame2';
import BetailMaker_QualiteGame3 from './BetailMaker_QualiteGame3';
import { useAuth } from '../authentification/AuthContext';
import { supabase } from '../authentification/supabaseClient';
import { qualityStandardSound, qualityPremiumSound } from './qualitySounds';

function BetailMaker() {
  const { user } = useAuth();
  const [qualityRevealEffect, setQualityRevealEffect] = useState('');
  const [isQualityRevealActive, setIsQualityRevealActive] = useState(false);
  const navigate = useNavigate();
  const [currentStep, setCurrentStep] = useState(0);
  const [prenom, setPrenom] = useState('');
  const [age, setAge] = useState(1);
  const [photoUrl, setPhotoUrl] = useState('');
  const [photoFilePreview, setPhotoFilePreview] = useState('');
  const [photoSource, setPhotoSource] = useState('file');
  const [photoZoom, setPhotoZoom] = useState(1);
  const [photoPosition, setPhotoPosition] = useState({ x: 0, y: 0 });
  const [isDraggingPhoto, setIsDraggingPhoto] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [dragOrigin, setDragOrigin] = useState({ x: 0, y: 0 });
  const [isDragActive, setIsDragActive] = useState(false);
  const [imageNaturalSize, setImageNaturalSize] = useState({ width: 0, height: 0 });
  const [matricule, setMatricule] = useState('');
  const [displayedDigits, setDisplayedDigits] = useState(['0', '0', '0', '0', '0']);
  const [arrivedDigits, setArrivedDigits] = useState([false, false, false, false, false]);
  const [digitArrivalCount, setDigitArrivalCount] = useState([0, 0, 0, 0, 0]);
  const [digitGlowColors, setDigitGlowColors] = useState(['#ff6b6b', '#ff6b6b', '#ff6b6b', '#ff6b6b', '#ff6b6b']);
  const [isMatriculeAnimating, setIsMatriculeAnimating] = useState(false);
  const [matriculeStatus, setMatriculeStatus] = useState('idle');
  const [qualityGame, setQualityGame] = useState('wheel');
  const [qualityResult, setQualityResult] = useState(null);
  const [qualityLocked, setQualityLocked] = useState(false);
  const [qualityInProgress, setQualityInProgress] = useState(false);
  const [commentaire, setCommentaire] = useState('');
  const [isHelpOpen, setIsHelpOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const previewSize = 220;
  const defaultPhotoZoom = 1.15;
  const defaultPhotoOffset = { x: 0, y: 12 };
  const animationTimersRef = useRef({ intervals: [], timeouts: [] });
  const lastAgeRef = useRef(age);
  const digitSounds = [digitSound1, digitSound2, digitSound3, digitSound4, digitSound5];
  const digitAudiosRef = useRef([]);

  const playAgeTick = () => {
    try {
      const audio = new Audio(ageTickSound);
      audio.volume = 0.6;
      audio.play();
    } catch {
      // ignore audio play errors
    }
  };

  const totalSteps = 7;
  const glowPalette = ['#ff6b6b', '#968eff', '#f2b3ff', '#ffd166', '#a6e3e9', '#c3f0ca'];
  const confettiPalette = ['#FFD166', '#FFC857', '#FFB703', '#F4C430', '#E6B800', '#FFDE7A'];

  const getBaseScale = () => {
    if (!imageNaturalSize.width || !imageNaturalSize.height) {
      return 1;
    }
    return Math.max(
      previewSize / imageNaturalSize.width,
      previewSize / imageNaturalSize.height
    );
  };

  const clampPhotoPosition = (position, zoom) => {
    if (!imageNaturalSize.width || !imageNaturalSize.height) {
      return { x: 0, y: 0 };
    }
    const baseScale = getBaseScale();
    const scaledWidth = imageNaturalSize.width * baseScale * zoom;
    const scaledHeight = imageNaturalSize.height * baseScale * zoom;
    const maxOffsetX = Math.max(0, (scaledWidth - previewSize) * 0.5);
    const maxOffsetY = Math.max(0, (scaledHeight - previewSize) * 0.5);
    return {
      x: Math.max(-maxOffsetX, Math.min(maxOffsetX, position.x)),
      y: Math.max(-maxOffsetY, Math.min(maxOffsetY, position.y)),
    };
  };

  const handleCreateBetail = () => {
    setCurrentStep(1);
  };

  const handleNextPrenom = () => {
    if (prenom.trim()) {
      setCurrentStep(2);
    }
  };

  const handleNextAge = () => {
    setCurrentStep(3);
  };

  const handleNextPhoto = () => {
    setCurrentStep(4);
  };

  const handleNextMatricule = () => {
    setCurrentStep(5);
  };

  const handleQualityComplete = (result) => {
    setQualityResult(result);
    setQualityLocked(true);
    setQualityInProgress(false);
    setIsQualityRevealActive(true);
    setQualityRevealEffect(result === 'premium' ? 'reveal-premium' : 'reveal-standard');
    // Son
    try {
      const audio = new Audio(result === 'premium' ? qualityPremiumSound : qualityStandardSound);
      audio.volume = 0.4;
      audio.play();
    } catch {}
    // Masquer l'étiquette après 1,5s, puis déflouter et reset après 1,6s
    setTimeout(() => {
      setQualityRevealEffect('');
    }, 1500);
    setTimeout(() => {
      setIsQualityRevealActive(false);
    }, 1600);
  };

  const handleQualityStart = () => {
    setQualityInProgress(true);
  };

  const handleNextQuality = () => {
    setCurrentStep(6);
  };

  const handlePhotoFileChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) {
      setPhotoFilePreview('');
      return;
    }
    setPhotoSource('file');
    const reader = new FileReader();
    reader.onloadend = () => {
      setPhotoFilePreview(reader.result?.toString() || '');
    };
    reader.readAsDataURL(file);
  };

  const handlePhotoUrlChange = (value) => {
    setPhotoSource('url');
    setPhotoUrl(value);
  };

  const handleUseDefaultPhoto = () => {
    setPhotoSource('file');
    setPhotoUrl('');
    setPhotoFilePreview(defaultProfileImage);
    setPhotoZoom(defaultPhotoZoom);
    setPhotoPosition(defaultPhotoOffset);
  };

  const handleRemovePhoto = () => {
    setPhotoFilePreview('');
    setPhotoUrl('');
  };

  const handlePhotoDrop = (e) => {
    e.preventDefault();
    setIsDragActive(false);
    const file = e.dataTransfer?.files?.[0];
    if (!file) {
      return;
    }
    const reader = new FileReader();
    reader.onloadend = () => {
      setPhotoFilePreview(reader.result?.toString() || '');
    };
    reader.readAsDataURL(file);
  };

  const handlePhotoDragOver = (e) => {
    e.preventDefault();
    setIsDragActive(true);
  };

  const handlePhotoDragLeave = () => {
    setIsDragActive(false);
  };

  const handlePhotoPointerDown = (e) => {
    if (!(photoFilePreview || photoUrl)) {
      return;
    }
    e.preventDefault();
    setIsDraggingPhoto(true);
    setDragStart({ x: e.clientX, y: e.clientY });
    setDragOrigin({ x: photoPosition.x, y: photoPosition.y });
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };

  const handlePhotoPointerMove = (e) => {
    if (!isDraggingPhoto) {
      return;
    }
    const dx = e.clientX - dragStart.x;
    const dy = e.clientY - dragStart.y;
    const nextPosition = { x: dragOrigin.x + dx, y: dragOrigin.y + dy };
    setPhotoPosition(clampPhotoPosition(nextPosition, photoZoom));
  };

  const handlePhotoPointerUp = (e) => {
    if (!isDraggingPhoto) {
      return;
    }
    setIsDraggingPhoto(false);
    e.currentTarget.releasePointerCapture?.(e.pointerId);
  };

  const clearAnimationTimers = () => {
    animationTimersRef.current.intervals.forEach(clearInterval);
    animationTimersRef.current.timeouts.forEach(clearTimeout);
    animationTimersRef.current.intervals = [];
    animationTimersRef.current.timeouts = [];
  };

  const skipMatriculeAnimation = () => {
    clearAnimationTimers();
    // Stopper tous les sons de digits
    digitAudiosRef.current.forEach(audio => {
      try {
        audio.pause();
        audio.currentTime = 0;
      } catch {}
    });
    digitAudiosRef.current = [];
    if (!matricule) return;
    const digits = matricule.split('');
    setDisplayedDigits(digits);
    setArrivedDigits([true, true, true, true, true]);
    setDigitGlowColors([
      ...digits.map((_, i) => glowPalette[i % glowPalette.length])
    ]);
    setDigitArrivalCount([1, 1, 1, 1, 1]);
    setIsMatriculeAnimating(false);
    setMatriculeStatus('done');
  };

  const playDigitSound = (index) => {
    const src = digitSounds[index];
    if (!src) {
      return;
    }
    try {
      const audio = new Audio(src);
      audio.volume = 0.8;
      audio.play();
      digitAudiosRef.current.push(audio);
    } catch {
      // ignore audio play errors
    }
  };

  const generateMatricule = () => {
    const value = 10000 + Math.floor(Math.random() * 70001);
    return value.toString();
  };

  const isMatriculeUnique = async (value) => {
    const { data, error } = await supabase
      .from('betails')
      .select('id')
      .eq('matricule', value)
      .limit(1);
    if (error) {
      return false;
    }
    return !data || data.length === 0;
  };

  const generateUniqueMatricule = async (attempts = 6) => {
    for (let i = 0; i < attempts; i += 1) {
      const candidate = generateMatricule();
      // eslint-disable-next-line no-await-in-loop
      const isUnique = await isMatriculeUnique(candidate);
      if (isUnique) {
        return candidate;
      }
    }
    return null;
  };

  const startMatriculeAnimation = (value) => {
    clearAnimationTimers();
    // Stoppe tous les sons précédents
    digitAudiosRef.current.forEach(audio => {
      try {
        audio.pause();
        audio.currentTime = 0;
      } catch {}
    });
    digitAudiosRef.current = [];
    setIsMatriculeAnimating(true);
    setMatriculeStatus('generating');
    const digits = value.split('');
    setDisplayedDigits(['0', '0', '0', '0', '0']);
    setArrivedDigits([false, false, false, false, false]);
    setDigitArrivalCount([0, 0, 0, 0, 0]);
    setDigitGlowColors(['#ff6b6b', '#ff6b6b', '#ff6b6b', '#ff6b6b', '#ff6b6b']);

    digits.forEach((digit, index) => {
      const startDelay = index * 900;
      const startTimeout = setTimeout(() => {
        const interval = setInterval(() => {
          setDisplayedDigits((prev) => {
            const next = [...prev];
            next[index] = Math.floor(Math.random() * 10).toString();
            return next;
          });
        }, 60);
        animationTimersRef.current.intervals.push(interval);

        const stopTimeout = setTimeout(() => {
          clearInterval(interval);
          setDisplayedDigits((prev) => {
            const next = [...prev];
            next[index] = digit;
            return next;
          });
          setArrivedDigits((prev) => {
            const next = [...prev];
            next[index] = true;
            return next;
          });
          setDigitGlowColors((prev) => {
            const next = [...prev];
            let nextColor = glowPalette[Math.floor(Math.random() * glowPalette.length)];
            const previousNeighbor = index > 0 ? next[index - 1] : null;
            let guard = 0;
            while (previousNeighbor && nextColor === previousNeighbor && guard < 10) {
              nextColor = glowPalette[Math.floor(Math.random() * glowPalette.length)];
              guard += 1;
            }
            next[index] = nextColor;
            return next;
          });
          setDigitArrivalCount((prev) => {
            const next = [...prev];
            next[index] += 1;
            return next;
          });
          playDigitSound(index);
          if (index === digits.length - 1) {
            setIsMatriculeAnimating(false);
            setMatriculeStatus('done');
          }
        }, 800);
        animationTimersRef.current.timeouts.push(stopTimeout);
      }, startDelay);
      animationTimersRef.current.timeouts.push(startTimeout);
    });
  };

  const handleGenerateMatricule = async () => {
    setMatriculeStatus('generating');
    const value = await generateUniqueMatricule();
    if (!value) {
      setSaveError("Impossible de générer un matricule unique.");
      setMatriculeStatus('idle');
      return;
    }
    setSaveError('');
    setMatricule(value);
    startMatriculeAnimation(value);
  };

  useEffect(() => {
    if (currentStep !== 4) {
      clearAnimationTimers();
      setIsMatriculeAnimating(false);
      setMatriculeStatus('idle');
      return () => {
        clearAnimationTimers();
      };
    }
    return () => {
      clearAnimationTimers();
    };
  }, [currentStep]);

  const handleBack = () => {
    navigate('/');
  };

  const handleRestart = () => {
    clearAnimationTimers();
    setCurrentStep(0);
    setPrenom('');
    setAge(1);
    setPhotoUrl('');
    setPhotoFilePreview('');
    setPhotoSource('file');
    setPhotoZoom(1);
    setPhotoPosition({ x: 0, y: 0 });
    setIsDraggingPhoto(false);
    setDragStart({ x: 0, y: 0 });
    setDragOrigin({ x: 0, y: 0 });
    setIsDragActive(false);
    setImageNaturalSize({ width: 0, height: 0 });
    setMatricule('');
    setDisplayedDigits(['0', '0', '0', '0', '0']);
    setArrivedDigits([false, false, false, false, false]);
    setDigitArrivalCount([0, 0, 0, 0, 0]);
    setDigitGlowColors(['#ff6b6b', '#ff6b6b', '#ff6b6b', '#ff6b6b', '#ff6b6b']);
    setIsMatriculeAnimating(false);
    setMatriculeStatus('idle');
    setQualityGame('wheel');
    setQualityResult(null);
    setQualityLocked(false);
    setQualityInProgress(false);
    setCommentaire('');
    setIsHelpOpen(false);
    setIsSaving(false);
    setSaveError('');
    setQualityRevealEffect('');
    setIsQualityRevealActive(false);
  };

  const getActiveImageSource = () => {
    if (photoSource === 'url') {
      return photoUrl.trim();
    }
    return photoFilePreview || defaultProfileImage;
  };

  const createCroppedAvatarBlob = async (overrideSource = '') => {
    const source = overrideSource || getActiveImageSource();
    if (!source) return null;

    const outputSize = 512;
    const loadImage = async (src) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.src = src;
      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = reject;
      });
      return img;
    };

    let img;
    try {
      img = await loadImage(source);
    } catch {
      if (source !== defaultProfileImage) {
        try {
          img = await loadImage(defaultProfileImage);
        } catch {
          return null;
        }
      } else {
        return null;
      }
    }

    const canvas = document.createElement('canvas');
    canvas.width = outputSize;
    canvas.height = outputSize;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    ctx.clearRect(0, 0, outputSize, outputSize);
    ctx.save();
    ctx.beginPath();
    ctx.arc(outputSize / 2, outputSize / 2, outputSize / 2, 0, Math.PI * 2);
    ctx.closePath();
    ctx.clip();

    const baseScale = getBaseScale();
    const scaleFactor = outputSize / previewSize;
    const isDefault = (!photoFilePreview && !photoUrl) || photoFilePreview === defaultProfileImage;
    const position = isDefault ? defaultPhotoOffset : photoPosition;
    const zoom = isDefault ? defaultPhotoZoom : photoZoom;

    ctx.translate(
      outputSize / 2 + position.x * scaleFactor,
      outputSize / 2 + position.y * scaleFactor
    );
    ctx.scale(baseScale * zoom * scaleFactor, baseScale * zoom * scaleFactor);
    ctx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2);
    ctx.restore();

    return new Promise((resolve) => {
      canvas.toBlob((blob) => resolve(blob), 'image/png');
    });
  };

  const uploadCroppedAvatar = async () => {
    let overrideSource = '';
    if (photoSource === 'url' && photoUrl.trim()) {
      const { data, error } = await supabase.functions.invoke('fetch-image', {
        body: { imageUrl: photoUrl.trim() },
      });
      if (error || !data?.dataUrl) {
        return null;
      }
      overrideSource = data.dataUrl;
    }

    const blob = await createCroppedAvatarBlob(overrideSource);
    if (!blob) return null;
    const filePath = `${Date.now()}-${user.id}-betail.png`;
    const { error } = await supabase.storage
      .from('betails')
      .upload(filePath, blob, {
        cacheControl: '3600',
        upsert: true,
        contentType: 'image/png',
      });
    if (error) {
      return null;
    }
    const { data } = supabase.storage.from('betails').getPublicUrl(filePath);
    return data?.publicUrl || null;
  };

  const handleSaveBetail = async () => {
    if (!user) {
      setSaveError("Utilisateur non connecté.");
      return;
    }
    if (!prenom.trim() || !matricule || !qualityResult) {
      setSaveError("Informations incomplètes.");
      return;
    }
    setSaveError('');
    setIsSaving(true);
    let avatarUrl = null;
    try {
      avatarUrl = await uploadCroppedAvatar();
    } catch {
      avatarUrl = null;
    }

    if (!avatarUrl) {
      setSaveError("Impossible d'enregistrer l'image.");
      setIsSaving(false);
      return;
    }

    let finalMatricule = matricule;
    const isCurrentUnique = await isMatriculeUnique(finalMatricule);
    if (!isCurrentUnique) {
      const regenerated = await generateUniqueMatricule();
      if (!regenerated) {
        setSaveError("Impossible de générer un matricule unique.");
        setIsSaving(false);
        return;
      }
      finalMatricule = regenerated;
      setMatricule(regenerated);
    }

    const payload = {
      id: crypto.randomUUID(),
      name: prenom.trim(),
      age,
      avatar_url: avatarUrl,
      matricule: finalMatricule,
      premium: qualityResult === 'premium',
      comments: commentaire?.trim() || null,
      author_id: user.id,
      created_at: new Date().toISOString(),
    };
    const { error } = await supabase.from('betails').insert(payload);
    if (error?.code === '23505') {
      const regenerated = await generateUniqueMatricule();
      if (!regenerated) {
        setSaveError("Impossible de générer un matricule unique.");
        setIsSaving(false);
        return;
      }
      setMatricule(regenerated);
      const retryPayload = { ...payload, matricule: regenerated };
      const { error: retryError } = await supabase.from('betails').insert(retryPayload);
      if (retryError) {
        setSaveError("Erreur lors de l'enregistrement.");
        setIsSaving(false);
        return;
      }
    } else if (error) {
      setSaveError("Erreur lors de l'enregistrement.");
      setIsSaving(false);
      return;
    }
    setIsSaving(false);
    setCurrentStep(8);
  };

  const renderStepContent = () => {
    switch (currentStep) {
      case 0:
        return (
          <div className="step-content fade-in">
            <div className="image-container">
              <img src={miloImage} alt="Milo" className="milo-image" />
            </div>
            <button className="create-button" onClick={handleCreateBetail}>
              <span className="button-icon">✨</span>
              Créer un bétail
            </button>
          </div>
        );

      case 1:
        return (
          <div className="step-content fade-in">
            <h2 className="step-title">Quel est le prénom ?</h2>
            <input
              type="text"
              className="step-input"
              placeholder="Entrez le prénom..."
              value={prenom}
              onChange={(e) => setPrenom(e.target.value)}
              autoFocus
              onKeyPress={(e) => e.key === 'Enter' && handleNextPrenom()}
            />
            <button 
              className="next-button" 
              onClick={handleNextPrenom}
              disabled={!prenom.trim()}
            >
              Suivant
              <span className="arrow">→</span>
            </button>
          </div>
        );

      case 2:
        return (
          <div className="step-content fade-in">
            <h2 className="step-title">Quel est son âge ?</h2>
            <div className="age-selector">
              <div className="age-display">
                <span className="age-number">{age}</span>
                <span className="age-label">an{age > 1 ? 's' : ''}</span>
              </div>
              <div className="age-slider-container">
                <input
                  type="range"
                  min="1"
                  max="12"
                  value={age}
                  onChange={(e) => {
                    const nextAge = Number(e.target.value);
                    setAge(nextAge);
                    if (nextAge !== lastAgeRef.current) {
                      playAgeTick();
                      lastAgeRef.current = nextAge;
                    }
                  }}
                  className="age-slider"
                />
                <div className="age-markers">
                  {[1, 3, 6, 9, 12].map((marker) => (
                    <span key={marker} className="age-marker">{marker}</span>
                  ))}
                </div>
              </div>
            </div>
            <button className="next-button" onClick={handleNextAge}>
              Suivant
              <span className="arrow">→</span>
            </button>
          </div>
        );

      case 3:
        return (
          <div className="step-content fade-in">
            <h2 className="step-title">Choisis une photo</h2>

            <div className="photo-choice">
              <div className="photo-input">
                <input
                  type="url"
                  className="step-input"
                  placeholder="Collez une URL d'image..."
                  value={photoUrl}
                  onChange={(e) => handlePhotoUrlChange(e.target.value)}
                />
              </div>
            </div>

            <div
              className="photo-preview"
              onPointerDown={
                photoFilePreview === defaultProfileImage ? undefined : handlePhotoPointerDown
              }
              onPointerMove={
                photoFilePreview === defaultProfileImage ? undefined : handlePhotoPointerMove
              }
              onPointerUp={
                photoFilePreview === defaultProfileImage ? undefined : handlePhotoPointerUp
              }
              onPointerLeave={
                photoFilePreview === defaultProfileImage ? undefined : handlePhotoPointerUp
              }
              onDragOver={handlePhotoDragOver}
              onDragLeave={handlePhotoDragLeave}
              onDrop={handlePhotoDrop}
            >
              {(photoSource === 'file' && photoFilePreview) || (photoSource === 'url' && photoUrl) ? (
                <>
                  <img
                    src={photoSource === 'file' ? photoFilePreview : photoUrl}
                    alt="Aperçu"
                    className="photo-preview-image"
                    draggable={false}
                    onDragStart={(e) => e.preventDefault()}
                    onLoad={(e) => {
                      setImageNaturalSize({
                        width: e.currentTarget.naturalWidth,
                        height: e.currentTarget.naturalHeight,
                      });
                      if (photoFilePreview === defaultProfileImage) {
                        setPhotoPosition(defaultPhotoOffset);
                        setPhotoZoom(defaultPhotoZoom);
                      } else {
                        setPhotoPosition((prev) => clampPhotoPosition(prev, photoZoom));
                      }
                    }}
                    style={{
                      width: `${imageNaturalSize.width ? imageNaturalSize.width * getBaseScale() : previewSize}px`,
                      height: `${imageNaturalSize.height ? imageNaturalSize.height * getBaseScale() : previewSize}px`,
                      transform:
                        photoFilePreview === defaultProfileImage
                          ? `translate(-50%, -50%) translate(${defaultPhotoOffset.x}px, ${defaultPhotoOffset.y}px) scale(${defaultPhotoZoom})`
                          : `translate(-50%, -50%) translate(${photoPosition.x}px, ${photoPosition.y}px) scale(${photoZoom})`,
                    }}
                  />
                </>
              ) : (
                <label className={`photo-preview-placeholder ${isDragActive ? 'active' : ''}`}>
                  <input
                    type="file"
                    accept="image/*"
                    className="file-input"
                    onChange={handlePhotoFileChange}
                  />
                  <span>Cliquer ou glisser une photo ici</span>
                </label>
              )}
            </div>

            {((photoSource === 'file' && photoFilePreview) || (photoSource === 'url' && photoUrl)) &&
              photoFilePreview !== defaultProfileImage && (
              <div className="photo-controls">
                <label className="photo-zoom-label">
                  Zoom
                  <input
                    type="range"
                    min="1"
                    max="2.5"
                    step="0.01"
                    value={photoZoom}
                    onChange={(e) => {
                      const nextZoom = Number(e.target.value);
                      setPhotoZoom(nextZoom);
                      setPhotoPosition((prev) => clampPhotoPosition(prev, nextZoom));
                    }}
                    className="photo-zoom-slider"
                  />
                </label>
                <p className="photo-hint">Fais glisser l’image pour la positionner dans le cercle.</p>
              </div>
            )}


            <div className="photo-actions">
              {photoFilePreview === defaultProfileImage ? (
                <label className="photo-action" style={{ cursor: 'pointer' }}>
                  Choisir une photo parmi la galerie
                  <input
                    type="file"
                    accept="image/*"
                    className="file-input"
                    style={{ display: 'none' }}
                    onChange={handlePhotoFileChange}
                  />
                </label>
              ) : (
                <button className="photo-action" type="button" onClick={handleUseDefaultPhoto}>
                  Utiliser la photo par défaut
                </button>
              )}
              {(photoFilePreview || photoUrl) && photoFilePreview !== defaultProfileImage && (
                <button className="photo-action ghost" type="button" onClick={handleRemovePhoto}>
                  Supprimer la photo
                </button>
              )}
            </div>

            <button
              className="next-button"
              onClick={handleNextPhoto}
              disabled={!photoFilePreview && !photoUrl.trim()}
            >
              Suivant
              <span className="arrow">→</span>
            </button>
          </div>
        );

      case 4:
        return (
          <div className="step-content fade-in">
            <h2 className="step-title">
              {matriculeStatus === 'generating' ? 'Attribution du matricule...' : 'Matricule attribué'}
            </h2>
            <div className="matricule-card">
              <div className="matricule-icon" aria-hidden="true">
                <Fingerprint size={40} color="#ff6b6b" />
              </div>
              <p className="matricule-label">Matricule unique</p>
              <div className={`matricule-number ${isMatriculeAnimating ? 'animating' : ''}`}>
                {displayedDigits.map((digit, index) => (
                  <span
                    key={`${digit}-${index}-${digitArrivalCount[index]}`}
                    className={`matricule-digit ${arrivedDigits[index] ? 'arriving' : ''}`}
                    style={{ '--glow-color': digitGlowColors[index] }}
                  >
                    {digit}
                  </span>
                ))}
              </div>
              <p className="matricule-hint">Ce matricule est automatiquement unique.</p>
            </div>


            {matriculeStatus !== 'done' && !isMatriculeAnimating && (
              <button
                className="next-button"
                onClick={handleGenerateMatricule}
              >
                Générer un matricule
                <span className="arrow">→</span>
              </button>
            )}
            {saveError && (
              <p className="quality-subtitle" role="alert">
                {saveError}
              </p>
            )}
            {matriculeStatus !== 'done' && isMatriculeAnimating && (
              <button
                className="next-button skip-matricule"
                type="button"
                onClick={skipMatriculeAnimation}
                title="Passer l'animation"
              >
                <ChevronsRight size={22} style={{marginRight: 8, verticalAlign: 'middle'}} />
                Skip
              </button>
            )}

            {matriculeStatus === 'done' && (
              <button className="next-button" onClick={handleNextMatricule}>
                Suivant
                <span className="arrow">→</span>
              </button>
            )}
          </div>
        );

      case 5:
        return (
          <div className="step-content fade-in">
            <h2 className="step-title">Évaluer la qualité</h2>
            <p className="quality-subtitle">
              Choisis un mini-jeu : le résultat déterminera si le bétail est Premium ou Standard.
            </p>

            <div className="quality-games">
              <button
                type="button"
                className={`quality-game-card ${qualityGame === 'wheel' ? 'active' : ''}`}
                onClick={() => !qualityLocked && !qualityInProgress && setQualityGame('wheel')}
                disabled={qualityLocked || qualityInProgress}
              >
                Roue du destin
              </button>
              <button
                type="button"
                className={`quality-game-card ${qualityGame === 'dice' ? 'active' : ''}`}
                onClick={() => !qualityLocked && !qualityInProgress && setQualityGame('dice')}
                disabled={qualityLocked || qualityInProgress}
              >
                Dé sacré
              </button>
              <button
                type="button"
                className={`quality-game-card ${qualityGame === 'card' ? 'active' : ''}`}
                onClick={() => !qualityLocked && !qualityInProgress && setQualityGame('card')}
                disabled={qualityLocked || qualityInProgress}
              >
                Carte mystère
              </button>
            </div>

            <div className="quality-game-panel">
              {qualityGame === 'wheel' && (
                <BetailMaker_QualiteGame1
                  disabled={qualityLocked || qualityInProgress}
                  onStart={handleQualityStart}
                  onComplete={handleQualityComplete}
                />
              )}
              {qualityGame === 'dice' && (
                <BetailMaker_QualiteGame2
                  disabled={qualityLocked || qualityInProgress}
                  onStart={handleQualityStart}
                  onComplete={handleQualityComplete}
                />
              )}
              {qualityGame === 'card' && (
                <BetailMaker_QualiteGame3
                  disabled={qualityLocked || qualityInProgress}
                  onStart={handleQualityStart}
                  onComplete={handleQualityComplete}
                />
              )}
            </div>

            {qualityResult && (
              <button
                className={`next-button quality-next${isQualityRevealActive ? ' visible' : ''}`}
                onClick={handleNextQuality}
                style={isQualityRevealActive ? { zIndex: 30, position: 'relative' } : {}}
              >
                Suivant
                <span className="arrow">→</span>
              </button>
            )}

            {/* Effet visuel de révélation */}
            {qualityRevealEffect && qualityResult && (
              <div className={`quality-reveal-card ${qualityRevealEffect} ${qualityResult}`} aria-hidden="true">
                <span className="quality-reveal-label">
                  {qualityResult === 'premium' ? '✨ Premium' : 'Standard'}
                </span>
              </div>
            )}

            {qualityResult === 'premium' && (
              <div className="confetti" aria-hidden="true">
                {Array.from({ length: 28 }).map((_, index) => (
                  <span
                    key={`confetti-${index}`}
                    className="confetti-piece"
                    style={{
                      left: '50%',
                      top: '50%',
                      animationDelay: `${index * 0.02}s`,
                      '--confetti-x': `${Math.cos((index / 28) * Math.PI * 2) * (120 + (index % 6) * 16)}px`,
                      '--confetti-y': `${Math.sin((index / 28) * Math.PI * 2) * (120 + (index % 6) * 16)}px`,
                      background: confettiPalette[index % confettiPalette.length],
                      transform: `translate(-50%, -50%) rotate(${index * 18}deg)`,
                    }}
                  />
                ))}
              </div>
            )}
          </div>
        );

      case 6:
        return (
          <div className="step-content fade-in">
            <h2 className="step-title">Ajouter un commentaire</h2>
            <p className="quality-subtitle">Optionnel</p>
            <textarea
              className="comment-input"
              rows={4}
              placeholder="Écris un commentaire libre pour ce bétail..."
              value={commentaire}
              onChange={(e) => setCommentaire(e.target.value)}
              style={{ resize: 'vertical', minHeight: 80, maxHeight: 200, overflow: 'auto' }}
            />
            <button className="next-button" onClick={() => setCurrentStep(7)}>
              Terminer
              <span className="arrow">→</span>
            </button>
          </div>
        );
      case 7:
        return (
          <div className="step-content fade-in recap-step">
            <h2 className="step-title">Récapitulatif du bétail</h2>
            <p className="quality-subtitle">Voici un récapitulatif de votre bétail vous pouvez le vérifier avant de valider.</p>
            <div className="recap-photo-block">
              <div className="recap-photo-label" style={{display:'block',width:130,height:130}}>
                {(() => {
                  // Taille du cercle du récap
                  const recapSize = 110;
                  // Ratio d'échelle entre la prévisualisation et le récap
                  const scaleRatio = recapSize / previewSize;
                  // Calcul du scale de base (identique à la preview)
                  const baseScale = getBaseScale();
                  // Appliquer la même transformation mais adaptée au petit cercle
                  let imgWidth = imageNaturalSize.width ? imageNaturalSize.width * baseScale * scaleRatio : recapSize;
                  let imgHeight = imageNaturalSize.height ? imageNaturalSize.height * baseScale * scaleRatio : recapSize;
                  let transform;
                  if ((!photoFilePreview && !photoUrl) || photoFilePreview === defaultProfileImage) {
                    // Photo par défaut
                    transform = `translate(-50%, -50%) translate(${defaultPhotoOffset.x * scaleRatio}px, ${defaultPhotoOffset.y * scaleRatio}px) scale(${defaultPhotoZoom})`;
                  } else {
                    transform = `translate(-50%, -50%) translate(${photoPosition.x * scaleRatio}px, ${photoPosition.y * scaleRatio}px) scale(${photoZoom})`;
                  }
                  return (
                    <div
                      className="recap-photo-preview"
                      style={{
                        width: recapSize,
                        height: recapSize,
                        borderRadius: '50%',
                        border: '3px solid #ffd166',
                        overflow: 'hidden',
                        position: 'relative',
                        background: '#fff',
                        margin: '0 auto',
                      }}
                    >
                      <img
                        src={photoFilePreview || photoUrl || defaultProfileImage}
                        alt="Photo du bétail"
                        className="recap-photo"
                        draggable={false}
                        style={{
                          position: 'absolute',
                          left: '50%',
                          top: '50%',
                          width: imgWidth,
                          height: imgHeight,
                          transform,
                          objectFit: 'cover',
                          userSelect: 'none',
                          pointerEvents: 'none',
                        }}
                      />
                    </div>
                  );
                })()}
              </div>
            </div>
            <div className="recap-fields">
              <div className="recap-row">
                <span className="recap-label">Prénom :</span>
                <input
                  className="recap-input"
                  value={prenom}
                  onChange={e => setPrenom(e.target.value)}
                  style={{ minWidth: 80 }}
                />
              </div>
              <div className="recap-row">
                <span className="recap-label">Âge :</span>
                <input
                  className="recap-input"
                  type="number"
                  min={1}
                  max={12}
                  value={age}
                  onChange={e => setAge(Number(e.target.value))}
                  style={{ width: 50 }}
                />
                <span className="recap-unit">an{age > 1 ? 's' : ''}</span>
              </div>
              <div className="recap-row">
                <span className="recap-label">Qualité :</span>
                <span className={`recap-quality ${qualityResult}`}>{qualityResult === 'premium' ? '✨ Premium' : 'Standard'}</span>
              </div>
              <div className="recap-row">
                <span className="recap-label">Matricule :</span>
                <span className="recap-matricule">{matricule}</span>
              </div>
              <div className="recap-row">
                <span className="recap-label">Commentaire :</span>
                <textarea
                  className="recap-input"
                  value={commentaire}
                  onChange={e => setCommentaire(e.target.value)}
                  rows={3}
                  style={{ minWidth: 180, maxWidth: 320, resize: 'vertical' }}
                  placeholder="Aucun commentaire"
                />
              </div>
            </div>
            {saveError && (
              <p className="quality-subtitle" role="alert">
                {saveError}
              </p>
            )}
            <div className="recap-actions">
              <button
                type="button"
                className="restart-button"
                onClick={handleRestart}
                disabled={isSaving}
              >
                Recommencer
              </button>
              <button
                className="next-button"
                onClick={handleSaveBetail}
                disabled={isSaving}
              >
                {isSaving ? 'Enregistrement...' : 'Valider'}
                <span className="arrow">→</span>
              </button>
            </div>
          </div>
        );
      case 8:
        return (
          <div className="step-content fade-in">
            <h2 className="step-title">Bétail enregistré !</h2>
            <p className="quality-subtitle">Tu peux retrouver ce bétail dans la liste.</p>
            <Link to="/betail-register" className="registry-link">
              Voir le registre du bétail
              <span className="arrow">→</span>
            </Link>
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <div className="betail-maker">
      <div className={`betail-container${isQualityRevealActive ? ' blurred' : ''}`}>
        <div className="stepper-card">
          <button
            type="button"
            className="help-button"
            aria-label="Afficher l'aide sur l'enregistrement"
            onClick={() => setIsHelpOpen(true)}
          >
            ?
          </button>
          {currentStep > 0 && (
            <div className="progress-bar">
              <div 
                className="progress-fill" 
                style={{ width: `${(currentStep / (totalSteps - 1)) * 100}%` }}
              />
            </div>
          )}
          {renderStepContent()}
        </div>
      </div>
      <div className="decorative-circles">
        <div className="circle circle-1"></div>
        <div className="circle circle-2"></div>
        <div className="circle circle-3"></div>
      </div>
      {/* Overlay effet visuel qualité */}
      {qualityRevealEffect && qualityResult && (
        <div className={`quality-reveal-card ${qualityRevealEffect} ${qualityResult} ${qualityResult === 'standard' ? 'shake' : ''}`} aria-hidden="true">
          <span className="quality-reveal-label">
            {qualityResult === 'premium' ? '✨ Premium' : 'Standard'}
          </span>
        </div>
      )}
      {isHelpOpen && (
        <div
          className="help-modal-overlay"
          role="dialog"
          aria-modal="true"
          aria-label="Informations sur l'enregistrement"
          onClick={() => setIsHelpOpen(false)}
        >
          <div className="help-modal" onClick={(event) => event.stopPropagation()}>
            <div className="help-modal-header">
              <span className="help-modal-icon">ℹ️</span>
              <div>
                <p className="help-modal-eyebrow">Besoin d'un coup de pouce ?</p>
                <h3>Informations sur l'enregistrement</h3>
              </div>
              <button
                type="button"
                className="help-close"
                aria-label="Fermer l'aide"
                onClick={() => setIsHelpOpen(false)}
              >
                ×
              </button>
            </div>
            <ul className="help-list">
              <li>
                <span className="help-pill positive">Public</span>
                Le bétail sera ajouté au registre public et pourra être acheté par d'autres mères.
              </li>
              <li>
                <span className="help-pill neutral">Affiliation</span>
                L'affiliation sera automatiquement Grace Field House et le bétail sera enregistré sur le site N°5.
              </li>
              <li>
                <span className="help-pill warning">Restriction</span>
                Vous ne pourrez pas acheter votre propre bétail créé.
              </li>
            </ul>
            <p className="help-warning">
              En enregistrant un bétail, vous confirmez avoir pris connaissance et accepter le{' '}
              <Link
                to="/rules"
                className="help-link"
                onClick={() => setIsHelpOpen(false)}
              >
                règlement de FarmGestion
              </Link>
              .
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

export default BetailMaker;
