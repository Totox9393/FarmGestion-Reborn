import { useEffect, useRef, useState } from 'react';
import { Icon } from '@iconify/react';
import './RegisterModal.css';
import miloCreateAccount from '../../assets/img/milo_createaccount.png';
import { signInWithProvider, signUpWithEmail } from './authApi';
import { supabase } from './supabaseClient';
import {
  normalizeSurpriseCode,
  readInitialSurpriseCode,
  redeemSurpriseCode,
  saveSurpriseCode,
} from './surpriseCode';
import { syncNewsletterPreferenceToTotoxFr } from '../utils/newsletterSync';

const NEWSLETTER_SETTING_NAME = 'receive_newsletter';

const normalizePseudo = (value) => String(value || '').trim();

const checkUsernameAvailability = async (pseudoValue) => {
  const normalizedPseudo = normalizePseudo(pseudoValue);
  if (!normalizedPseudo) return { available: false, error: 'Le pseudo est requis.' };

  const { data, error } = await supabase
    .from('users_profiles')
    .select('id')
    .ilike('username', normalizedPseudo)
    .limit(1);

  if (error) {
    return { available: false, error: 'Impossible de vérifier la disponibilité du pseudo.' };
  }

  return { available: !Array.isArray(data) || data.length === 0, error: '' };
};

function RegisterModal({ isOpen, onClose, onOpenLogin, onRegisterSuccess }) {
  const pseudoInputRef = useRef(null);
  const [pseudo, setPseudo] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [surpriseCode, setSurpriseCode] = useState('');
  const [showSurpriseField, setShowSurpriseField] = useState(false);
  const [newsletter, setNewsletter] = useState(true);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        onClose?.();
      }
    };

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, onClose]);

  useEffect(() => {
    if (!isOpen) return;

    const focusTimer = window.setTimeout(() => {
      pseudoInputRef.current?.focus();
    }, 0);

    return () => window.clearTimeout(focusTimer);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const initialCode = readInitialSurpriseCode();
    setSurpriseCode(initialCode);
    setShowSurpriseField(Boolean(initialCode));
  }, [isOpen]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    const normalizedPseudo = normalizePseudo(pseudo);
    const normalizedSurpriseCode = normalizeSurpriseCode(surpriseCode);

    if (!normalizedPseudo) {
      setError('Le pseudo est requis.');
      return;
    }

    const { available, error: availabilityError } = await checkUsernameAvailability(normalizedPseudo);
    if (!available) {
      setError(availabilityError || 'Ce pseudo est déjà utilisé.');
      return;
    }

    if (password !== confirmPassword) {
      setError('Les mots de passe ne correspondent pas.');
      return;
    }
    setLoading(true);
    const { data, error: signUpError } = await signUpWithEmail(email, password);
    if (signUpError) {
      setError(signUpError.message || 'Erreur lors de la création du compte.');
      setLoading(false);
      return;
    }
    // Ajout dans users_profiles
    const user = data.user;
    if (user) {
      const now = new Date().toISOString();
      const { error: profileError } = await supabase.from('users_profiles').insert({
        id: user.id,
        username: normalizedPseudo,
        email,
        created_at: now,
        updated_at: now
      });
      if (profileError) {
        const isUsernameConflict = profileError?.code === '23505'
          || String(profileError?.message || '').toLowerCase().includes('users_profiles_username_ci_unique_idx')
          || String(profileError?.message || '').toLowerCase().includes('duplicate key');
        if (isUsernameConflict) {
          setError('Ce pseudo est déjà utilisé. Choisissez-en un autre.');
          setLoading(false);
          return;
        }
        setError('Compte créé mais erreur lors de l’enregistrement du profil.');
        setLoading(false);
        return;
      }

      let newsletterError = null;
      if (newsletter) {
        const { error: deleteError } = await supabase
          .from('user_settings')
          .delete()
          .eq('user_id', user.id)
          .eq('setting_name', NEWSLETTER_SETTING_NAME);
        newsletterError = deleteError;
      } else {
        const { error: upsertError } = await supabase
          .from('user_settings')
          .upsert(
            {
              user_id: user.id,
              setting_name: NEWSLETTER_SETTING_NAME,
              setting_value: false,
            },
            { onConflict: 'user_id,setting_name' },
          );
        newsletterError = upsertError;
      }

      if (newsletterError) {
        console.error('Impossible de sauvegarder la préférence newsletter lors de l\'inscription', newsletterError);
      } else {
        syncNewsletterPreferenceToTotoxFr({
          email,
          userId: user.id,
          enabled: newsletter,
          source: 'register',
        });
      }

      if (normalizedSurpriseCode) {
        const redeemResult = await redeemSurpriseCode({
          code: normalizedSurpriseCode,
          source: 'register_modal_email',
        });

        if (redeemResult?.error) {
          const message = String(redeemResult.error?.message || '').toLowerCase();
          if (redeemResult.error?.code === '42883' || message.includes('redeem_surprise_code_reborn')) {
            console.error('Fonction SQL redeem_surprise_code_reborn absente.', redeemResult.error);
          } else {
            window.dispatchEvent(
              new CustomEvent('farmgestion-toast', {
                detail: { type: 'error', message: 'Le code surprise n\'a pas pu etre applique.' },
              }),
            );
          }
        } else if (redeemResult?.success) {
          const awardedMoney = Number(redeemResult?.awarded_money || 0);
          const awardedBadgeIds = Array.isArray(redeemResult?.awarded_badge_ids)
            ? redeemResult.awarded_badge_ids.filter(Boolean)
            : [redeemResult?.awarded_badge_id].filter(Boolean);
          const rewardParts = [];
          if (awardedMoney > 0) rewardParts.push(`+${awardedMoney} argent`);
          if (awardedBadgeIds.length > 0) {
            rewardParts.push(awardedBadgeIds.length > 1 ? `${awardedBadgeIds.length} badges debloques` : 'badge debloque');
          }
          const rewardLabel = rewardParts.length ? rewardParts.join(' et ') : 'bonus applique';

          window.dispatchEvent(
            new CustomEvent('farmgestion-toast', {
              detail: { type: 'success', message: `Code surprise valide: ${rewardLabel}.` },
            }),
          );
        } else if (redeemResult?.reason) {
          window.dispatchEvent(
            new CustomEvent('farmgestion-toast', {
              detail: {
                type: 'error',
                message: `Code surprise non applique (${String(redeemResult.reason).toLowerCase()}).`,
              },
            }),
          );
        }
      }

      // Attendre que la session soit bien établie avant de fermer
      try {
        await new Promise(resolve => setTimeout(resolve, 500));
        const { data: sessionData } = await supabase.auth.getSession();
        if (!sessionData?.session) {
          console.warn('Session non trouvée après inscription');
        }
      } catch (sessionError) {
        console.error('Erreur lors de la vérification de session:', sessionError);
      }    }
    setLoading(false);
    onClose?.();
    if (onRegisterSuccess) {
      onRegisterSuccess();
    } else {
      onOpenLogin?.();
    }
  };

  const handleGoogleSignUp = async () => {
    setLoading(true);
    setError('');
    saveSurpriseCode(surpriseCode);
    const redirectTo = `${window.location.origin}/home`;
    const { error: oauthError } = await signInWithProvider('google', { redirectTo });
    if (oauthError) {
      setError(oauthError.message || 'Erreur de connexion Google.');
      setLoading(false);
    }
  };

  const handleDiscordSignUp = async () => {
    setLoading(true);
    setError('');
    saveSurpriseCode(surpriseCode);
    const redirectTo = `${window.location.origin}/home`;
    const { error: oauthError } = await signInWithProvider('discord', { redirectTo });
    if (oauthError) {
      setError(oauthError.message || 'Erreur de connexion Discord.');
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="register-modal-overlay is-open" role="presentation">
      <div
        className="register-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="register-modal-title"
        onClick={(event) => event.stopPropagation()}
      >
        <button
          type="button"
          className="register-modal-close-icon"
          aria-label="Fermer"
          onClick={onClose}
        >
          ×
        </button>
        <div className="register-modal-header">
          <img
            src={miloCreateAccount}
            alt="Milo qui présente la création de compte"
            className="register-modal-hero"
            draggable={false}
          />
          <p className="register-modal-eyebrow">Bienvenue sur FarmGestion</p>
          <h2 id="register-modal-title">Créer un compte</h2>
        </div>

        <div className="register-modal-body">
          <div className="register-modal-social">
            <button
              type="button"
              className="register-modal-social-button"
              aria-label="Inscription Google"
              onClick={handleGoogleSignUp}
              disabled={loading}
            >
              <Icon icon="logos:google-icon" width={20} height={20} />
            </button>
            <button
              type="button"
              className="register-modal-social-button"
              aria-label="Inscription Discord"
              onClick={handleDiscordSignUp}
              disabled={loading}
            >
              <Icon icon="logos:discord-icon" width={20} height={20} />
            </button>
          </div>

          <form className="register-modal-form" onSubmit={handleSubmit}>
            <label className="register-modal-field">
              <span>Pseudo</span>
              <input ref={pseudoInputRef} type="text" placeholder="Votre pseudo" value={pseudo} onChange={e => setPseudo(e.target.value)} required />
            </label>
            <label className="register-modal-field">
              <span>Email</span>
              <input type="email" placeholder="exemple@ferme.fr" value={email} onChange={e => setEmail(e.target.value)} required />
            </label>
            <label className="register-modal-field">
              <span>Mot de passe</span>
              <input type="password" placeholder="Votre mot de passe" value={password} onChange={e => setPassword(e.target.value)} required />
            </label>
            <label className="register-modal-field">
              <span>Confirmer le mot de passe</span>
              <input type="password" placeholder="Confirmez votre mot de passe" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} required />
            </label>
            <div className="register-modal-surprise-wrap">
              <button
                type="button"
                className="register-modal-surprise-toggle"
                onClick={() => setShowSurpriseField((current) => !current)}
                aria-expanded={showSurpriseField}
              >
                {showSurpriseField ? 'Masquer le code bonus' : 'J\'ai un code bonus'}
              </button>
              {showSurpriseField ? (
                <label className="register-modal-field register-modal-field--surprise">
                  <span>Code surprise (facultatif)</span>
                  <input
                    type="text"
                    placeholder="Ex: SALON_2026"
                    value={surpriseCode}
                    onChange={(event) => setSurpriseCode(normalizeSurpriseCode(event.target.value))}
                  />
                </label>
              ) : null}
            </div>
            <label className="register-modal-checkbox">
              <input type="checkbox" checked={newsletter} onChange={e => setNewsletter(e.target.checked)} />
              <span>Recevoir la newsletter</span>
            </label>
            {error && <div style={{ color: 'red', marginBottom: 8 }}>{error}</div>}
            <button type="submit" className="register-modal-submit" disabled={loading}>
              {loading ? 'Création...' : 'Créer mon compte'}
            </button>
          </form>

          <div className="register-modal-links">
            <button
              type="button"
              className="register-modal-link"
              onClick={() => {
                onClose?.();
                onOpenLogin?.();
              }}
            >
              Déjà un compte ? Se connecter
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default RegisterModal;
