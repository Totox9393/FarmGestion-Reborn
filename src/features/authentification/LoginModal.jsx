import { useEffect, useRef, useState } from 'react';
import { signInWithEmail, signInWithProvider } from './authApi';
import { Icon } from '@iconify/react';
import './LoginModal.css';
import miloHello from '../../assets/img/milo_hello2.png';
import { readInitialSurpriseCode, saveSurpriseCode } from './surpriseCode';

function LoginModal({ isOpen, onClose, onOpenRegister, onForgotPassword, onLoginSuccess }) {
  const emailInputRef = useRef(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
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
      emailInputRef.current?.focus();
    }, 0);

    return () => window.clearTimeout(focusTimer);
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    const { error } = await signInWithEmail(email, password);
    setLoading(false);
    if (error) {
      let msg = error.message;
      if (msg && msg.toLowerCase().includes('invalid login credentials')) {
        msg = 'Email ou mot de passe incorrect. Veuillez réessayer.';
      }
      setError(msg || 'Erreur de connexion');
    } else {
      onClose?.();
      if (onLoginSuccess) await onLoginSuccess();
    }
  };

  const handleGoogleLogin = async () => {
    setLoading(true);
    setError('');
    saveSurpriseCode(readInitialSurpriseCode());
    const redirectTo = `${window.location.origin}/home`;
    const { error: oauthError } = await signInWithProvider('google', { redirectTo });
    if (oauthError) {
      setError(oauthError.message || 'Erreur de connexion Google.');
      setLoading(false);
    }
  };

  const handleDiscordLogin = async () => {
    setLoading(true);
    setError('');
    saveSurpriseCode(readInitialSurpriseCode());
    const redirectTo = `${window.location.origin}/home`;
    const { error: oauthError } = await signInWithProvider('discord', { redirectTo });
    if (oauthError) {
      setError(oauthError.message || 'Erreur de connexion Discord.');
      setLoading(false);
    }
  };

  return (
    <div className="login-modal-overlay is-open" role="presentation">
      <div
        className="login-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="login-modal-title"
        onClick={(event) => event.stopPropagation()}
      >
        <button
          type="button"
          className="login-modal-close-icon"
          aria-label="Fermer"
          onClick={onClose}
        >
          ×
        </button>
        <div className="login-modal-header">
          <img
            src={miloHello}
            alt="Milo qui fait coucou"
            className="login-modal-hero"
            draggable={false}
          />
          <p className="login-modal-eyebrow">Accédez à votre compte FarmGestion</p>
          <h2 id="login-modal-title">Connexion</h2>
        </div>

        <div className="login-modal-body">
          <div className="login-modal-social">
            <button
              type="button"
              className="login-modal-social-button"
              aria-label="Connexion Google"
              onClick={handleGoogleLogin}
              disabled={loading}
            >
              <Icon icon="logos:google-icon" width={20} height={20} />
            </button>
            <button
              type="button"
              className="login-modal-social-button"
              aria-label="Connexion Discord"
              onClick={handleDiscordLogin}
              disabled={loading}
            >
              <Icon icon="logos:discord-icon" width={20} height={20} />
            </button>
          </div>
          <form className="login-modal-form" onSubmit={handleSubmit}>
            <label className="login-modal-field">
              <span>Email</span>
              <input
                ref={emailInputRef}
                type="email"
                placeholder="exemple@ferme.fr"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
              />
            </label>
            <label className="login-modal-field">
              <span>Mot de passe</span>
              <input
                type="password"
                placeholder="Votre mot de passe"
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
              />
            </label>
            {error && <div style={{color:'red',marginBottom:8}}>{error}</div>}
            <button type="submit" className="login-modal-submit" disabled={loading}>
              {loading ? 'Connexion...' : 'Connexion'}
            </button>
          </form>
          <div className="login-modal-links">
            <button
              type="button"
              className="login-modal-link"
              onClick={() => {
                onClose?.();
                onForgotPassword?.();
              }}
            >
              Mot de passe oublié
            </button>
            <button
              type="button"
              className="login-modal-link"
              onClick={() => {
                onClose?.();
                onOpenRegister?.();
              }}
            >
              Pas de compte ? Créer un compte
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default LoginModal;
