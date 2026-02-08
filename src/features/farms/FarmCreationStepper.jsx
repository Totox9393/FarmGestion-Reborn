import { useState, useRef, useEffect } from 'react';
import { uploadImageToBucket } from './farmsApi';
import { useAuth } from '../authentification/AuthContext';
import { supabase } from '../authentification/supabaseClient';
import FarmCreationModal from './FarmCreationModal';
import defaultProfileUser from '../../assets/defaut_profile_user.png';

// Pour hexagone identique à Home_Block4_Farm
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

const COLOR_POOL = ['#FFB3BA', '#BAFFC9', '#BAE1FF', '#FFFFBA', '#E0BBE4', '#FFDFBA', '#D4C5F9', '#FFE5E5'];
const EMOJI_OPTIONS = ['🏡', '😁', '🐣', '👑', '😈', '🍀', '🧺', '👁️', '⚽', '🏆', '🎮'];

function FarmCreationStepper({ isOpen = true, onClose, onComplete }) {
  const { user } = useAuth();
  const [step, setStep] = useState(0);
  // Avatar
  const [avatarUrl, setAvatarUrl] = useState('');
  const [avatarSource, setAvatarSource] = useState('none');
  const [avatarUrlInput, setAvatarUrlInput] = useState('');
  const [avatarFilePreview, setAvatarFilePreview] = useState('');
  const [avatarZoom, setAvatarZoom] = useState(1.15);
  const [avatarPosition, setAvatarPosition] = useState({ x: 0, y: 12 });
  const [avatarImageNaturalSize, setAvatarImageNaturalSize] = useState({ width: 0, height: 0 });
  const [isAvatarDragging, setIsAvatarDragging] = useState(false);
  const [avatarDragStart, setAvatarDragStart] = useState({ x: 0, y: 0 });
  const [avatarDragOrigin, setAvatarDragOrigin] = useState({ x: 0, y: 0 });
  const [isAvatarDragActive, setIsAvatarDragActive] = useState(false);
  const [avatarError, setAvatarError] = useState('');
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef();

  // Farm
  const [farmName, setFarmName] = useState('');
  const [farmNameError, setFarmNameError] = useState('');
  const [checkingName, setCheckingName] = useState(false);
  const [palette, setPalette] = useState(() => Array(6).fill(COLOR_POOL[0]));
  const [centerType, setCenterType] = useState('emoji');
  const [centerValue, setCenterValue] = useState(EMOJI_OPTIONS[0]);
  const [centerImageFile, setCenterImageFile] = useState(null);
  const [centerImageUrl, setCenterImageUrl] = useState('');
  const [centerImageError, setCenterImageError] = useState('');
  const centerPreviewFallback = 110;
  const defaultCenterZoom = 1.15;
  const defaultCenterOffset = { x: 0, y: 0 };
  const [centerImageZoom, setCenterImageZoom] = useState(defaultCenterZoom);
  const [centerImagePosition, setCenterImagePosition] = useState({ x: 0, y: 0 });
  const [centerImageNaturalSize, setCenterImageNaturalSize] = useState({ width: 0, height: 0 });
  const [isCenterImageDragging, setIsCenterImageDragging] = useState(false);
  const [centerImageDragStart, setCenterImageDragStart] = useState({ x: 0, y: 0 });
  const [centerImageDragOrigin, setCenterImageDragOrigin] = useState({ x: 0, y: 0 });
  const [centerPreviewSize, setCenterPreviewSize] = useState(0);
  const [visible, setVisible] = useState(true);
  const [saving, setSaving] = useState(false);
  const [creationMessage, setCreationMessage] = useState('');
  const [isColorPickerOpen, setIsColorPickerOpen] = useState(false);
  const [activeSiteIndex, setActiveSiteIndex] = useState(null);
  const [customColor, setCustomColor] = useState('#ffffff');
  const centerImageInputRef = useRef();
  const debounceTimeout = useRef();
  const avatarPreviewSize = 200;
  const centerMediaRef = useRef(null);
  const defaultAvatarZoom = 1.15;
  const defaultAvatarOffset = { x: 0, y: 12 };

  // Debounce pour le nom de ferme
  useEffect(() => {
    if (!farmName) {
      setFarmNameError('');
      return;
    }
    setFarmNameError('');
    setCheckingName(true);
    if (debounceTimeout.current) clearTimeout(debounceTimeout.current);
    debounceTimeout.current = setTimeout(async () => {
      const { data, error } = await supabase
        .from('farms_list')
        .select('id')
        .eq('name', farmName)
        .maybeSingle();
      if (error) {
        setFarmNameError('Erreur lors de la vérification.');
      } else if (data) {
        setFarmNameError('Ce nom de ferme est déjà pris.');
      } else {
        setFarmNameError('');
      }
      setCheckingName(false);
    }, 500);
    return () => clearTimeout(debounceTimeout.current);
  }, [farmName]);

  useEffect(() => {
    const updatePreviewSize = () => {
      const rect = centerMediaRef.current?.getBoundingClientRect();
      if (rect?.width && rect?.height) {
        setCenterPreviewSize(Math.min(rect.width, rect.height));
      }
    };
    updatePreviewSize();
    window.addEventListener('resize', updatePreviewSize);
    return () => {
      window.removeEventListener('resize', updatePreviewSize);
    };
  }, []);


  // Upload image centre ferme
  const handleCenterImageChange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setCenterImageError('');
    setUploading(true);
    const { url, error } = await uploadImageToBucket('avatars', file, user.id, 'farm-centers');
    setUploading(false);
    if (error) {
      setCenterImageError(error.message || 'Erreur lors de l’upload de l’image.');
      return;
    }
    setCenterImageFile(file);
    setCenterImageUrl(url);
    setCenterValue(url);
    setCenterImageZoom(defaultCenterZoom);
    setCenterImagePosition({ ...defaultCenterOffset });
    setCenterImageNaturalSize({ width: 0, height: 0 });
    setIsCenterImageDragging(false);
  };

  // Upload avatar (photo de profil)
  const getAvatarBaseScale = () => {
    if (!avatarImageNaturalSize.width || !avatarImageNaturalSize.height) {
      return 1;
    }
    return Math.max(
      avatarPreviewSize / avatarImageNaturalSize.width,
      avatarPreviewSize / avatarImageNaturalSize.height
    );
  };

  const clampAvatarPosition = (position, zoom) => {
    if (!avatarImageNaturalSize.width || !avatarImageNaturalSize.height) {
      return { x: 0, y: 0 };
    }
    const baseScale = getAvatarBaseScale();
    const scaledWidth = avatarImageNaturalSize.width * baseScale * zoom;
    const scaledHeight = avatarImageNaturalSize.height * baseScale * zoom;
    const maxOffsetX = Math.max(0, (scaledWidth - avatarPreviewSize) * 0.5);
    const maxOffsetY = Math.max(0, (scaledHeight - avatarPreviewSize) * 0.5);
    return {
      x: Math.max(-maxOffsetX, Math.min(maxOffsetX, position.x)),
      y: Math.max(-maxOffsetY, Math.min(maxOffsetY, position.y)),
    };
  };

  useEffect(() => {
    if (avatarSource === 'default') return;
    if (!avatarImageNaturalSize.width || !avatarImageNaturalSize.height) return;
    setAvatarPosition((prev) => clampAvatarPosition(prev, avatarZoom));
  }, [avatarZoom, avatarImageNaturalSize, avatarSource]);

  const getCenterBaseScale = () => {
    if (!centerImageNaturalSize.width || !centerImageNaturalSize.height) {
      return 1;
    }
    const previewSize = Math.max(centerPreviewSize || 0, centerPreviewFallback);
    return Math.max(
      previewSize / centerImageNaturalSize.width,
      previewSize / centerImageNaturalSize.height
    );
  };

  const clampCenterPosition = (position, zoom) => {
    if (!centerImageNaturalSize.width || !centerImageNaturalSize.height) {
      return { x: 0, y: 0 };
    }
    const previewSize = Math.max(centerPreviewSize || 0, centerPreviewFallback);
    const baseScale = getCenterBaseScale();
    const scaledWidth = centerImageNaturalSize.width * baseScale * zoom;
    const scaledHeight = centerImageNaturalSize.height * baseScale * zoom;
    const maxOffsetX = Math.max(0, (scaledWidth - previewSize) * 0.5);
    const maxOffsetY = Math.max(0, (scaledHeight - previewSize) * 0.5);
    return {
      x: Math.max(-maxOffsetX, Math.min(maxOffsetX, position.x)),
      y: Math.max(-maxOffsetY, Math.min(maxOffsetY, position.y)),
    };
  };

  useEffect(() => {
    if (!centerImageNaturalSize.width || !centerImageNaturalSize.height) return;
    setCenterImagePosition((prev) => clampCenterPosition(prev, centerImageZoom));
  }, [centerImageNaturalSize, centerImageZoom]);

  const handleAvatarFile = async (file) => {
    if (!file) return;
    setAvatarError('');
    setAvatarSource('file');
    setAvatarUrlInput('');
    setAvatarUrl('');
    setAvatarZoom(defaultAvatarZoom);
    setAvatarPosition(defaultAvatarOffset);
    const reader = new FileReader();
    reader.onloadend = () => {
      setAvatarFilePreview(reader.result?.toString() || '');
    };
    reader.readAsDataURL(file);

    setUploading(true);
    const { url, error } = await uploadImageToBucket('avatars', file, user.id);
    setUploading(false);
    if (error) {
      setAvatarError('Erreur lors de l’upload de la photo.');
      return;
    }
    setAvatarUrl(url);
  };

  const handleAvatarFileChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    handleAvatarFile(file);
  };

  const handleAvatarUrlChange = (value) => {
    setAvatarSource('url');
    setAvatarUrlInput(value);
    setAvatarUrl(value);
    setAvatarFilePreview('');
    setAvatarZoom(defaultAvatarZoom);
    setAvatarPosition(defaultAvatarOffset);
  };

  const handleUseDefaultAvatar = () => {
    setAvatarSource('default');
    setAvatarUrlInput('');
    setAvatarFilePreview('');
    setAvatarUrl(defaultProfileUser);
    setAvatarZoom(defaultAvatarZoom);
    setAvatarPosition(defaultAvatarOffset);
    setAvatarImageNaturalSize({ width: 0, height: 0 });
  };

  const handleRemoveAvatar = () => {
    setAvatarSource('none');
    setAvatarUrl('');
    setAvatarUrlInput('');
    setAvatarFilePreview('');
    setAvatarZoom(defaultAvatarZoom);
    setAvatarPosition(defaultAvatarOffset);
    setAvatarImageNaturalSize({ width: 0, height: 0 });
    setAvatarError('');
  };

  const handleAvatarDrop = (e) => {
    e.preventDefault();
    setIsAvatarDragActive(false);
    const file = e.dataTransfer?.files?.[0];
    if (!file) return;
    handleAvatarFile(file);
  };

  const handleAvatarDragOver = (e) => {
    e.preventDefault();
    setIsAvatarDragActive(true);
  };

  const handleAvatarDragLeave = () => {
    setIsAvatarDragActive(false);
  };

  const handleAvatarPointerDown = (e) => {
    if (!avatarFilePreview && !avatarUrlInput) {
      return;
    }
    if (avatarSource === 'default') {
      return;
    }
    e.preventDefault();
    setIsAvatarDragging(true);
    setAvatarDragStart({ x: e.clientX, y: e.clientY });
    setAvatarDragOrigin({ x: avatarPosition.x, y: avatarPosition.y });
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };

  const handleAvatarPointerMove = (e) => {
    if (!isAvatarDragging) {
      return;
    }
    const dx = e.clientX - avatarDragStart.x;
    const dy = e.clientY - avatarDragStart.y;
    const nextPosition = { x: avatarDragOrigin.x + dx, y: avatarDragOrigin.y + dy };
    setAvatarPosition(clampAvatarPosition(nextPosition, avatarZoom));
  };

  const handleAvatarPointerUp = (e) => {
    if (!isAvatarDragging) {
      return;
    }
    setIsAvatarDragging(false);
    e.currentTarget.releasePointerCapture?.(e.pointerId);
  };

  const handleCenterPointerDown = (e) => {
    if (!centerImageUrl) {
      return;
    }
    e.preventDefault();
    setIsCenterImageDragging(true);
    setCenterImageDragStart({ x: e.clientX, y: e.clientY });
    setCenterImageDragOrigin({ x: centerImagePosition.x, y: centerImagePosition.y });
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };

  const handleCenterPointerMove = (e) => {
    if (!isCenterImageDragging) {
      return;
    }
    const dx = e.clientX - centerImageDragStart.x;
    const dy = e.clientY - centerImageDragStart.y;
    const nextPosition = { x: centerImageDragOrigin.x + dx, y: centerImageDragOrigin.y + dy };
    setCenterImagePosition(clampCenterPosition(nextPosition, centerImageZoom));
  };

  const handleCenterPointerUp = (e) => {
    if (!isCenterImageDragging) {
      return;
    }
    setIsCenterImageDragging(false);
    e.currentTarget.releasePointerCapture?.(e.pointerId);
  };

  // Sélection couleur site
  const handleCenterTypeChange = (nextType) => {
    if (nextType === 'emoji') {
      setCenterType('emoji');
      setCenterValue(EMOJI_OPTIONS[0]);
      setCenterImageUrl('');
      setCenterImageFile(null);
      setCenterImageError('');
      setCenterImageZoom(defaultCenterZoom);
      setCenterImagePosition({ ...defaultCenterOffset });
      setCenterImageNaturalSize({ width: 0, height: 0 });
      setIsCenterImageDragging(false);
    } else {
      setCenterType('image');
      // On laisse centerValue tel quel si une image est déjà chargée; sinon pas de changement
    }
  };

  const handleSiteColorChange = (siteIndex, color) => {
    setPalette((prev) => prev.map((c, i) => (i === siteIndex ? color : c)));
  };

  const openColorPicker = (siteIndex) => {
    setActiveSiteIndex(siteIndex);
    setCustomColor(palette[siteIndex] || '#ffffff');
    setIsColorPickerOpen(true);
  };

  const closeColorPicker = () => {
    setIsColorPickerOpen(false);
    setActiveSiteIndex(null);
  };

  const applyColor = (color) => {
    if (activeSiteIndex === null) return;
    handleSiteColorChange(activeSiteIndex, color);
    closeColorPicker();
  };

  // Validation finale
  const handleSave = async () => {
    setCreationMessage('');
    setSaving(true);
    // Création de la ferme
    const { data: farm, error: farmError } = await supabase.from('farms_list').insert({
      name: farmName,
      proprietaire: user.id,
      visible,
      site_colors: palette,
      center_style: { type: centerType, value: centerValue },
    }).select().maybeSingle();
    if (farmError || !farm) {
      setFarmNameError('Erreur lors de la création de la ferme.');
      setSaving(false);
      return;
    }
    // Mise à jour du profil utilisateur
    await supabase.from('users_profiles').update({
      avatar_url: avatarUrl,
      farm_id: farm.id,
      updated_at: new Date().toISOString(),
    }).eq('id', user.id);
    setSaving(false);
    setCreationMessage('Ferme créée avec succès !');
    onComplete?.(farm);
  };

  const effectiveCenterPreviewSize = Math.max(centerPreviewSize || 0, centerPreviewFallback);

  return (
    <FarmCreationModal isOpen={isOpen} onClose={onClose}>
      <div className="farm-modal-stepper">
        {step === 0 && (
          <div className="farm-modal-step farm-modal-step-avatar">
            <div className="farm-modal-title">Photo de profil</div>
            <div className="farm-modal-photo-options">
              <button
                type="button"
                className={`farm-modal-option ${avatarSource === 'url' ? 'active' : ''}`}
                onClick={() => {
                  setAvatarSource('url');
                  setAvatarUrl(avatarUrlInput);
                  setAvatarFilePreview('');
                }}
              >
                URL
              </button>
              <button
                type="button"
                className={`farm-modal-option ${avatarSource === 'default' ? 'active' : ''}`}
                onClick={handleUseDefaultAvatar}
              >
                Photo par défaut
              </button>
            </div>
            <input
              type="file"
              accept="image/*"
              ref={fileInputRef}
              style={{ display: 'none' }}
              onChange={handleAvatarFileChange}
            />
            {avatarSource === 'url' && (
              <label className="farm-modal-label">
                URL de la photo
                <input
                  className="farm-modal-input"
                  type="url"
                  value={avatarUrlInput}
                  onChange={(e) => handleAvatarUrlChange(e.target.value)}
                  placeholder="https://..."
                />
              </label>
            )}
            <label
              className={`farm-modal-photo-preview${avatarSource === 'default' ? ' is-default' : ''}${isAvatarDragActive ? ' is-drag-active' : ''}`}
              onPointerDown={avatarSource === 'default' ? undefined : handleAvatarPointerDown}
              onPointerMove={avatarSource === 'default' ? undefined : handleAvatarPointerMove}
              onPointerUp={avatarSource === 'default' ? undefined : handleAvatarPointerUp}
              onPointerLeave={avatarSource === 'default' ? undefined : handleAvatarPointerUp}
              onDragOver={handleAvatarDragOver}
              onDragLeave={handleAvatarDragLeave}
              onDrop={handleAvatarDrop}
              onClick={() => {
                const hasPhoto = Boolean(
                  avatarFilePreview || avatarUrlInput || avatarSource === 'default'
                );
                if (!hasPhoto) {
                  fileInputRef.current?.click();
                }
              }}
            >
              {(() => {
                const previewSrc = avatarSource === 'file'
                  ? avatarFilePreview
                  : avatarSource === 'url'
                    ? avatarUrlInput
                    : avatarSource === 'default'
                      ? defaultProfileUser
                      : '';
                if (!previewSrc) {
                  return (
                    <div className="farm-modal-photo-placeholder">
                      Cliquer ou glisser une photo
                    </div>
                  );
                }
                const canTransform = avatarSource !== 'default';
                return (
                  <img
                    src={previewSrc}
                    alt="Aperçu avatar"
                    className={`farm-modal-photo-preview-image${canTransform ? '' : ' is-default'}`}
                    draggable={false}
                    onDragStart={(e) => e.preventDefault()}
                    onLoad={(e) => {
                      const img = e.currentTarget;
                      if (avatarSource === 'default') return;
                      const naturalSize = { width: img.naturalWidth || 0, height: img.naturalHeight || 0 };
                      setAvatarImageNaturalSize(naturalSize);
                      setAvatarPosition((prev) => clampAvatarPosition(prev, avatarZoom));
                    }}
                    style={canTransform ? {
                      width: `${avatarImageNaturalSize.width ? avatarImageNaturalSize.width * getAvatarBaseScale() : avatarPreviewSize}px`,
                      height: `${avatarImageNaturalSize.height ? avatarImageNaturalSize.height * getAvatarBaseScale() : avatarPreviewSize}px`,
                      transform: `translate(-50%, -50%) translate(${avatarPosition.x}px, ${avatarPosition.y}px) scale(${avatarZoom})`,
                    } : undefined}
                  />
                );
              })()}
            </label>
            {avatarSource !== 'default' && (avatarFilePreview || avatarUrlInput) && (
              <div className="farm-modal-photo-controls">
                <label className="farm-modal-photo-zoom">
                  Zoom
                  <input
                    type="range"
                    min="1"
                    max="2.5"
                    step="0.01"
                    value={avatarZoom}
                    onChange={(e) => setAvatarZoom(parseFloat(e.target.value))}
                  />
                </label>
                <p className="farm-modal-photo-hint">Glisse l’image pour la positionner dans le cercle.</p>
              </div>
            )}
            {((avatarSource === 'file' && avatarFilePreview) || (avatarSource === 'url' && avatarUrlInput.trim())) && (
              <button
                type="button"
                className="farm-modal-btn ghost"
                onClick={handleRemoveAvatar}
                disabled={uploading}
              >
                Supprimer la photo
              </button>
            )}
            {avatarError && <div className="farm-modal-error">{avatarError}</div>}
            <div className="farm-modal-actions">
              <button className="farm-modal-btn" onClick={() => setStep(1)} disabled={!avatarUrl || uploading}>
                Suivant
              </button>
            </div>
          </div>
        )}
        {step === 1 && (
          <div className="farm-modal-step farm-modal-step-farm">
            <div className="farm-modal-title">Personnalise ta ferme</div>
            <div className="farm-modal-farm-layout">
              <div className="farm-modal-farm-controls">
                <label className="farm-modal-label">
                  Nom de la ferme
                  <input
                    className="farm-modal-input"
                    type="text"
                    value={farmName}
                    onChange={e => setFarmName(e.target.value)}
                    placeholder="Nom unique de la ferme"
                  />
                </label>
                {checkingName && <span className="farm-modal-hint">Vérification...</span>}
                {farmNameError && <div className="farm-modal-error">{farmNameError}</div>}

                <div className="farm-modal-label">Centre</div>
                <div className="farm-modal-center-controls">
                  <select className="farm-modal-select" value={centerType} onChange={e => handleCenterTypeChange(e.target.value)}>
                    <option value="emoji">Emoji</option>
                    <option value="image">Image</option>
                  </select>
                  {centerType === 'emoji' ? (
                    <select className="farm-modal-select" value={centerValue} onChange={e => setCenterValue(e.target.value)}>
                      {EMOJI_OPTIONS.map((emoji) => (
                        <option key={emoji} value={emoji}>{emoji}</option>
                      ))}
                    </select>
                  ) : (
                    <>
                      <input
                        type="file"
                        accept="image/*"
                        ref={centerImageInputRef}
                        style={{ display: 'none' }}
                        onChange={handleCenterImageChange}
                      />
                      <button className="farm-modal-btn" onClick={() => centerImageInputRef.current.click()} disabled={uploading}>
                        {centerImageUrl ? 'Changer l’image' : 'Importer une image'}
                      </button>
                      {centerImageUrl && (
                        <img src={centerImageUrl} alt="Centre" className="farm-modal-center-preview" />
                      )}
                      {centerImageError && <div className="farm-modal-error">{centerImageError}</div>}
                    </>
                  )}
                </div>

                <div className="farm-modal-checkbox">
                  <input type="checkbox" checked={visible} onChange={e => setVisible(e.target.checked)} id="farm-visible" />
                  <label htmlFor="farm-visible">Ferme publique</label>
                </div>

                <div className="farm-modal-actions">
                  {creationMessage && <div className="farm-modal-success">{creationMessage}</div>}
                  <button
                    className="farm-modal-btn"
                    onClick={handleSave}
                    disabled={!farmName || !!farmNameError || checkingName || saving}
                  >
                    Valider
                  </button>
                </div>
              </div>

              <div className="farm-modal-farm-hexagon">
                <div className="farm-modal-hexagon-title">Hexagone de la ferme</div>
                <div className="farm-modal-hexagon-svg">
                  <svg className="farm-hexagon" viewBox="0 0 200 200">
                    {[0, 1, 2, 3, 4, 5].map((siteIndex) => (
                      <polygon
                        key={siteIndex}
                        className="farm-hexagon-site"
                        style={{
                          '--site-color': palette[siteIndex],
                          opacity: 0.88,
                          cursor: 'pointer',
                          transition: 'fill 0.3s',
                          fill: palette[siteIndex],
                        }}
                        points={createTrianglePoints(100, 100, 90, siteIndex)}
                        onClick={() => openColorPicker(siteIndex)}
                      />
                    ))}
                    <circle className="farm-hexagon-core" cx="100" cy="100" r="25" />
                  </svg>
                  <div className="farm-hexagon-core-media" ref={centerMediaRef}>
                    {centerType === 'image' && centerImageUrl ? (
                      <div
                        className={`farm-hexagon-core-image${isCenterImageDragging ? ' is-dragging' : ''}`}
                        onPointerDown={handleCenterPointerDown}
                        onPointerMove={handleCenterPointerMove}
                        onPointerUp={handleCenterPointerUp}
                        onPointerLeave={handleCenterPointerUp}
                      >
                        <img
                          src={centerImageUrl}
                          alt="Centre de ferme"
                          draggable={false}
                          onDragStart={(e) => e.preventDefault()}
                          onLoad={(e) => {
                            setCenterImageNaturalSize({
                              width: e.currentTarget.naturalWidth || 0,
                              height: e.currentTarget.naturalHeight || 0,
                            });
                          }}
                          style={{
                            width: `${centerImageNaturalSize.width ? centerImageNaturalSize.width * getCenterBaseScale() : effectiveCenterPreviewSize}px`,
                            height: `${centerImageNaturalSize.height ? centerImageNaturalSize.height * getCenterBaseScale() : effectiveCenterPreviewSize}px`,
                            transform: `translate(-50%, -50%) translate(${centerImagePosition.x}px, ${centerImagePosition.y}px) scale(${centerImageZoom})`,
                          }}
                        />
                      </div>
                    ) : (
                      <span className="farm-hexagon-core-emoji">{centerValue}</span>
                    )}
                  </div>
                </div>
                <div className="farm-modal-hexagon-hint">Clique sur un quartier pour changer sa couleur.</div>
                {centerType === 'image' && centerImageUrl && (
                  <div className="farm-modal-photo-controls">
                    <label className="farm-modal-photo-zoom">
                      Zoom
                      <input
                        type="range"
                        min="1"
                        max="2.5"
                        step="0.01"
                        value={centerImageZoom}
                        onChange={(e) => {
                          const nextZoom = Number(e.target.value);
                          if (Number.isNaN(nextZoom) || nextZoom === centerImageZoom) return;
                          setCenterImageZoom(nextZoom);
                          setCenterImagePosition((prev) => clampCenterPosition(prev, nextZoom));
                        }}
                      />
                    </label>
                    <p className="farm-modal-photo-hint">Glisse l’image pour la positionner dans le cercle.</p>
                  </div>
                )}
              </div>
            </div>
            {isColorPickerOpen && (
              <div className="farm-color-modal-overlay" role="presentation" onClick={closeColorPicker}>
                <div className="farm-color-modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
                  <div className="farm-color-modal-title">Choisir une couleur</div>
                  <div className="farm-color-swatch-grid">
                    {COLOR_POOL.map((color) => (
                      <button
                        key={color}
                        type="button"
                        className="farm-color-swatch"
                        style={{ background: color }}
                        onClick={() => applyColor(color)}
                        aria-label={`Couleur ${color}`}
                      />
                    ))}
                  </div>
                  <label className="farm-color-custom">
                    Personnalisée
                    <input
                      type="color"
                      value={customColor}
                      onChange={(e) => {
                        const next = e.target.value;
                        if (!next || next === customColor) return;
                        setCustomColor(next);
                      }}
                    />
                  </label>
                  <button
                    type="button"
                    className="farm-modal-btn"
                    onClick={() => applyColor(customColor)}
                  >
                    Appliquer
                  </button>
                  <button
                    type="button"
                    className="farm-color-modal-close"
                    aria-label="Fermer"
                    onClick={closeColorPicker}
                  >
                    ×
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </FarmCreationModal>
  );
}

export default FarmCreationStepper;
