import { useState, useRef, useEffect } from 'react';
import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query';
import { supabase } from '../authentification/supabaseClient';
import defaultProfileImg from '../../assets/defaut_profile_user.png';
import './Settings_ChangeAvatar.css';

function Settings_ChangeAvatar({ user, profile: profileProp }) {
  const [isOpen, setIsOpen] = useState(false);
  const [status, setStatus] = useState(null);
  const queryClient = useQueryClient();

  // Charger le profil utilisateur si nécessaire
  const { data: loadedProfile } = useQuery({
    queryKey: ['userProfile', user?.id],
    queryFn: async () => {
      if (!user?.id) return null;
      const { data } = await supabase
        .from('users_profiles')
        .select('*')
        .eq('id', user.id)
        .maybeSingle();
      return data;
    },
    enabled: !!user?.id && !profileProp?.role, // charger si pas de prop ou pas de role
    staleTime: 1000 * 60 * 5,
  });

  // Utiliser le profil chargé ou la prop
  const profile = loadedProfile || profileProp;

  // Vérifier si l'utilisateur a accès à la feature (hiérarchie : ADMIN > MODERATION > VIP > STANDARD)
  const roleHierarchy = ['ADMIN', 'MODERATION', 'VIP'];
  const normalizedRole = (profile?.role || '').trim().toUpperCase();
  const canUseAvatar = roleHierarchy.includes(normalizedRole);


  // Avatar source
  const [avatarSource, setAvatarSource] = useState('none');
  const [avatarUrl, setAvatarUrl] = useState('');
  const [avatarFilePreview, setAvatarFilePreview] = useState('');
  const [avatarUrlInput, setAvatarUrlInput] = useState('');
  const [avatarZoom, setAvatarZoom] = useState(1.15);
  const [avatarPosition, setAvatarPosition] = useState({ x: 0, y: 12 });
  const [avatarImageNaturalSize, setAvatarImageNaturalSize] = useState({ width: 0, height: 0 });
  const [isAvatarDragging, setIsAvatarDragging] = useState(false);
  const [avatarDragStart, setAvatarDragStart] = useState({ x: 0, y: 0 });
  const [avatarDragOrigin, setAvatarDragOrigin] = useState({ x: 0, y: 0 });
  const [isAvatarDragActive, setIsAvatarDragActive] = useState(false);
  const [avatarError, setAvatarError] = useState('');
  const [urlValidating, setUrlValidating] = useState(false);

  const fileInputRef = useRef(null);
  const avatarPreviewSize = 200;
  const defaultAvatarZoom = 1.15;
  const defaultAvatarOffset = { x: 0, y: 12 };

  // Calculer la base scale (le facteur minimum pour remplir le cercle)
  const getAvatarBaseScale = () => {
    if (!avatarImageNaturalSize.width || !avatarImageNaturalSize.height) {
      return 1;
    }
    return Math.max(
      avatarPreviewSize / avatarImageNaturalSize.width,
      avatarPreviewSize / avatarImageNaturalSize.height
    );
  };

  // Upload mutation
  const uploadMutation = useMutation({
    mutationFn: async ({ canvas, fileName }) => {
      // Convertir canvas en blob
      return new Promise((resolve, reject) => {
        canvas.toBlob(async (blob) => {
          if (!blob || blob.size === 0) {
            reject(new Error('Erreur lors de la conversion de l\'image'));
            return;
          }

          console.log('Avatar upload - blob size:', blob.size, 'type:', blob.type);

          const { data, error } = await supabase.storage
            .from('avatars')
            .upload(fileName, blob, { 
              cacheControl: '3600',
              upsert: true 
            });

          if (error) {
            console.error('Supabase upload error:', error);
            reject(error);
            return;
          }

          // Obtenir l'URL publique
          const { data: urlData } = supabase.storage
            .from('avatars')
            .getPublicUrl(fileName);

          resolve(urlData.publicUrl);
        }, 'image/png');
      });
    },
    onSuccess: async (publicUrl) => {
      // Mettre à jour la base de données
      const { error } = await supabase
        .from('users_profiles')
        .update({ avatar_url: publicUrl })
        .eq('id', user.id);

      if (error) {
        setStatus({ type: 'error', message: 'Erreur lors de la mise à jour du profil.' });
        return;
      }

      // Invalider les caches pertinents
      queryClient.invalidateQueries({ queryKey: ['userProfile'] });
      queryClient.invalidateQueries({ queryKey: ['user'] });

      window.dispatchEvent(
        new CustomEvent('farmgestion-toast', {
          detail: { type: 'success', message: 'Photo de profil mise à jour.' },
        })
      );

      setStatus({
        type: 'success',
        message: 'Photo de profil mise à jour.',
      });
      setTimeout(() => {
        resetForm();
        setStatus(null);
        setIsOpen(false);
      }, 1600);
    },
    onError: () => {
      setStatus({ type: 'error', message: 'Erreur lors de l\'upload de la photo.' });
    },
  });

  const resetForm = () => {
    setAvatarSource('none');
    setAvatarUrl('');
    setAvatarFilePreview('');
    setAvatarUrlInput('');
    setAvatarZoom(defaultAvatarZoom);
    setAvatarPosition(defaultAvatarOffset);
    setAvatarImageNaturalSize({ width: 0, height: 0 });
    setAvatarError('');
  };

  // Clamp position
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
    if (avatarZoom && avatarImageNaturalSize.width) {
      setAvatarPosition(clampAvatarPosition(avatarPosition, avatarZoom));
    }
  }, [avatarZoom, avatarImageNaturalSize]);

  // Handle file selection
  const handleAvatarFile = async (file) => {
    if (!file) return;

    const validTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/bmp'];
    if (!validTypes.includes(file.type)) {
      setAvatarError('Format non accepté. Utilisez JPEG, PNG, WebP ou BMP.');
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      setAvatarFilePreview(e.target.result);
    };
    reader.readAsDataURL(file);
  };

  const handleAvatarFileChange = (e) => {
    const file = e.target.files?.[0];
    if (file) {
      setAvatarError('');
      setAvatarSource('file');
      handleAvatarFile(file);
    }
  };

  const handleAvatarUrlInput = (value) => {
    setAvatarUrlInput(value);
    if (value.trim()) {
      setAvatarError('');
    }
  };

  const handleUseDefaultAvatar = () => {
    setAvatarSource('default');
    setAvatarUrl('');
    setAvatarFilePreview('');
    setAvatarUrlInput('');
    setAvatarError('');
  };

  const handleUseUrlAvatar = async () => {
    if (!avatarUrlInput.trim()) {
      setAvatarError('Veuillez entrer une URL.');
      return;
    }

    // Valider que c'est une URL
    try {
      new URL(avatarUrlInput.trim());
    } catch {
      setAvatarError('L\'URL n\'est pas valide.');
      return;
    }

    setUrlValidating(true);
    setAvatarError('');

    // Vérifier que l'image est accessible
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      setAvatarSource('url');
      setAvatarUrl(avatarUrlInput.trim());
      setUrlValidating(false);
    };
    img.onerror = () => {
      setAvatarError('Impossible de charger l\'image depuis cette URL. Essayez de la télécharger et l\'importer localement.');
      setUrlValidating(false);
    };
    img.src = avatarUrlInput.trim();
  };

  const handleRemoveAvatar = () => {
    resetForm();
  };

  const handleAvatarPointerDown = (e) => {
    if (avatarSource === 'default') return;
    setIsAvatarDragging(true);
    setAvatarDragStart({ x: e.clientX, y: e.clientY });
    setAvatarDragOrigin(avatarPosition);
  };

  const handleAvatarPointerMove = (e) => {
    if (!isAvatarDragging) return;
    const deltaX = e.clientX - avatarDragStart.x;
    const deltaY = e.clientY - avatarDragStart.y;
    const newPos = {
      x: avatarDragOrigin.x + deltaX,
      y: avatarDragOrigin.y + deltaY,
    };
    setAvatarPosition(clampAvatarPosition(newPos, avatarZoom));
  };

  const handleAvatarPointerUp = () => {
    setIsAvatarDragging(false);
  };

  // Canvas rendering
  const renderAvatarCanvas = async () => {
    const canvas = document.createElement('canvas');
    canvas.width = avatarPreviewSize;
    canvas.height = avatarPreviewSize;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = 'white';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    if (avatarSource === 'default') {
      return new Promise((resolve) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
          console.log('Default avatar image loaded:', img.naturalWidth, 'x', img.naturalHeight);
          const displayWidth = avatarPreviewSize;
          const displayHeight = avatarPreviewSize;
          const naturalWidth = img.naturalWidth;
          const naturalHeight = img.naturalHeight;

          const baseScale = Math.max(displayWidth / naturalWidth, displayHeight / naturalHeight);
          const scale = baseScale * avatarZoom;
          const scaledWidth = naturalWidth * scale;
          const scaledHeight = naturalHeight * scale;

          const x = (displayWidth - scaledWidth) / 2 + avatarPosition.x;
          const y = (displayHeight - scaledHeight) / 2 + avatarPosition.y;

          ctx.drawImage(img, x, y, scaledWidth, scaledHeight);
          resolve(canvas);
        };
        img.onerror = (err) => {
          console.warn('Default avatar image failed to load:', err);
          resolve(canvas);
        };
        img.src = defaultProfileImg;
      });
    }

    if (avatarSource === 'file' || avatarSource === 'url') {
      const img = new Image();
      if (avatarSource === 'url') {
        img.crossOrigin = 'anonymous';
      }

      return new Promise((resolve) => {
        img.onload = () => {
          console.log('Avatar image loaded:', img.naturalWidth, 'x', img.naturalHeight, 'source:', avatarSource);
          const displayWidth = avatarPreviewSize;
          const displayHeight = avatarPreviewSize;
          const naturalWidth = img.naturalWidth;
          const naturalHeight = img.naturalHeight;

          const baseScale = Math.max(displayWidth / naturalWidth, displayHeight / naturalHeight);
          const scale = baseScale * avatarZoom;
          const scaledWidth = naturalWidth * scale;
          const scaledHeight = naturalHeight * scale;

          const x = (displayWidth - scaledWidth) / 2 + avatarPosition.x;
          const y = (displayHeight - scaledHeight) / 2 + avatarPosition.y;

          ctx.drawImage(img, x, y, scaledWidth, scaledHeight);
          resolve(canvas);
        };
        img.onerror = (err) => {
          console.warn('Avatar image failed to load:', err, 'source:', avatarSource);
          resolve(canvas);
        };
        img.src = avatarSource === 'file' ? avatarFilePreview : avatarUrl;
      });
    }

    return canvas;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!avatarSource || avatarSource === 'none') {
      setAvatarError('Veuillez sélectionner ou importer une photo.');
      return;
    }

    setAvatarError('');
    try {
      const canvas = await renderAvatarCanvas();
      console.log('Canvas created:', canvas.width, 'x', canvas.height);
      const fileName = `${user.id}/${Date.now()}.png`;
      uploadMutation.mutate({ canvas, fileName });
    } catch (error) {
      setAvatarError('Erreur lors de la préparation de l\'image.');
      console.error('Canvas render error:', error);
    }
  };

  const isLoadingOrDisabled = uploadMutation.isPending || !canUseAvatar || urlValidating || !!avatarError;

  if (!isOpen && !canUseAvatar) {
    return (
      <div className="settings-item settings-item--stacked">
        <div className="settings-item-row">
          <div>
            <p className="settings-item-title">
              Photo de profil <span className="settings-avatar-badge">VIP</span>
            </p>
            <p className="settings-item-subtitle">Mettez à jour votre avatar et votre image de profil.</p>
          </div>
          <button
            type="button"
            className="settings-action settings-action--disabled"
            disabled
            title="Cette fonctionnalité est réservée aux utilisateurs VIP"
          >
            Mettre à jour
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={`settings-item settings-item--stacked ${isOpen ? 'is-open' : ''}`}>
      <div className="settings-item-row">
        <div>
          <p className="settings-item-title">
            Photo de profil <span className="settings-avatar-badge">VIP</span>
          </p>
          <p className="settings-item-subtitle">Mettez à jour votre avatar et votre image de profil.</p>
        </div>
        {canUseAvatar && (
          <button
            type="button"
            className="settings-action"
            onClick={() => setIsOpen((value) => !value)}
          >
            {isOpen ? 'Fermer' : 'Mettre à jour'}
          </button>
        )}
      </div>

      {isOpen && (
        <form className="settings-avatar-panel" onSubmit={handleSubmit}>
          {/* Preview */}
          <div className="settings-avatar-preview-section">
            <div className="settings-avatar-preview-label">
              {avatarSource === 'none' && profile?.avatar_url ? 'Aperçu de votre photo actuelle' : 'Aperçu'}
            </div>
            <div
              className={`settings-avatar-preview ${isAvatarDragActive ? 'is-drag-active' : ''}`}
              onPointerDown={avatarSource !== 'none' ? handleAvatarPointerDown : undefined}
              onPointerMove={avatarSource !== 'none' ? handleAvatarPointerMove : undefined}
              onPointerUp={avatarSource !== 'none' ? handleAvatarPointerUp : undefined}
              onPointerLeave={avatarSource !== 'none' ? handleAvatarPointerUp : undefined}
              style={{
                cursor: avatarSource === 'none' || avatarSource === 'default' ? 'default' : isAvatarDragging ? 'grabbing' : 'grab',
              }}
            >
              {avatarSource === 'none' && !profile?.avatar_url && <p className="settings-avatar-preview-placeholder">Aucune photo</p>}
              {avatarSource === 'none' && profile?.avatar_url && (
                <img
                  src={profile.avatar_url}
                  alt="Photo actuelle"
                  className="settings-avatar-preview-image"
                  draggable={false}
                />
              )}
              {avatarSource === 'default' && (
                <img
                  src={defaultProfileImg}
                  alt="Photo par défaut"
                  className="settings-avatar-preview-image"
                  draggable={false}
                />
              )}
              {(avatarSource === 'file' && avatarFilePreview) || (avatarSource === 'url' && avatarUrl) ? (
                <img
                  src={avatarSource === 'file' ? avatarFilePreview : avatarUrl}
                  alt="Aperçu"
                  className="settings-avatar-preview-image"
                  draggable={false}
                  onLoad={(e) => {
                    setAvatarImageNaturalSize({
                      width: e.target.naturalWidth,
                      height: e.target.naturalHeight,
                    });
                  }}
                  style={{
                    position: 'absolute',
                    left: '50%',
                    top: '50%',
                    width: `${avatarImageNaturalSize.width ? avatarImageNaturalSize.width * getAvatarBaseScale() : avatarPreviewSize}px`,
                    height: `${avatarImageNaturalSize.height ? avatarImageNaturalSize.height * getAvatarBaseScale() : avatarPreviewSize}px`,
                    transform: `translate(calc(-50% + ${avatarPosition.x}px), calc(-50% + ${avatarPosition.y}px)) scale(${avatarZoom})`,
                  }}
                />
              ) : null}
            </div>
      {(avatarSource === 'file' && avatarFilePreview && !avatarError) || (avatarSource === 'url' && avatarUrl && !avatarError) ? (
        <div className="settings-avatar-zoom">
          <label>Zoom</label>
          <input
            type="range"
            name="avatar-zoom"
            id={`avatar-zoom-${user.id}`}
            min="1"
            max="3"
            step="0.1"
            value={avatarZoom}
            onChange={(e) => setAvatarZoom(parseFloat(e.target.value))}
            className="settings-avatar-zoom-input"
          />
          <span className="settings-avatar-zoom-value">{avatarZoom.toFixed(2)}x</span>
        </div>
      ) : null}
          </div>

          {/* Options */}
          <div className="settings-avatar-options">
            <div className="settings-avatar-option-group">
              <label className="settings-avatar-option">
                <input
                  type="radio"
                  name="avatar-source"
                  checked={avatarSource === 'default'}
                  onChange={handleUseDefaultAvatar}
                />
                <span>Photo par défaut</span>
              </label>
            </div>

            <div className="settings-avatar-option-group">
              <label className="settings-avatar-option">
                <input
                  type="radio"
                  name="avatar-source"
                  checked={avatarSource === 'file'}
                  onChange={() => {
                    if (fileInputRef.current) {
                      fileInputRef.current.click();
                    }
                  }}
                />
                <span>Importer une photo</span>
              </label>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,image/bmp"
                onChange={handleAvatarFileChange}
                style={{ display: 'none' }}
              />
            </div>

            <div className="settings-avatar-option-group">
              <label className="settings-avatar-option">
                <input
                  type="radio"
                  name="avatar-source"
                  checked={avatarSource === 'url'}
                  onChange={() => setAvatarSource('url')}
                />
                <span>Photo par URL</span>
              </label>
              {avatarSource === 'url' && (
                <div className="settings-avatar-url-input-group">
                  <input
                    type="url"
                    value={avatarUrlInput}
                    onChange={(e) => handleAvatarUrlInput(e.target.value)}
                    placeholder="https://exemple.com/photo.jpg"
                    className="settings-avatar-url-input"
                    disabled={urlValidating}
                  />
                  <button
                    type="button"
                    className="settings-avatar-url-button"
                    onClick={handleUseUrlAvatar}
                    disabled={urlValidating}
                  >
                    {urlValidating ? 'Chargement...' : 'Charger'}
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Erreurs */}
          {avatarError && <p className="settings-avatar-error">{avatarError}</p>}
          {status?.message && (
            <p className={`settings-avatar-status ${status.type}`}>{status.message}</p>
          )}

          {/* Actions */}
          <div className="settings-avatar-actions">
            <button
              type="button"
              className="settings-action settings-action--ghost"
              onClick={() => {
                resetForm();
                setStatus(null);
                setIsOpen(false);
              }}
              disabled={isLoadingOrDisabled}
            >
              Annuler
            </button>
            <button
              type="submit"
              className="settings-action settings-action--primary"
              disabled={isLoadingOrDisabled || avatarSource === 'none'}
            >
              {uploadMutation.isPending ? 'Sauvegarde...' : 'Sauvegarder'}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

export default Settings_ChangeAvatar;
