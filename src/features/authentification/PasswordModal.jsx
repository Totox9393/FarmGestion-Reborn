import { useEffect, useRef, useState } from 'react';
import './PasswordModal.css';
import miloPassword from '../../assets/img/milo_password.png';
import { supabase } from './supabaseClient';

function PasswordModal({ isOpen, onClose, onOpenLogin }) {
  const emailInputRef = useRef(null);
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
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

  useEffect(() => {
    if (!isOpen) return;
    setError('');
    setSuccess('');
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError('');
    setSuccess('');
    setLoading(true);

    const redirectTo = `${window.location.origin}/reset-password`;
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo,
    });

    setLoading(false);

    if (resetError) {
      setError(resetError.message || 'Impossible d\'envoyer l\'email de réinitialisation.');
      return;
    }

    setSuccess('Si cette adresse existe, un email de réinitialisation vient d\'être envoyé.');
  };

  return (
    <div className="password-modal-overlay is-open" role="presentation">
      <div
        className="password-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="password-modal-title"
        onClick={(event) => event.stopPropagation()}
      >
        <button
          type="button"
          className="password-modal-close-icon"
          aria-label="Fermer"
          onClick={onClose}
        >
          ×
        </button>

        <div className="password-modal-header">
          <img
            src={miloPassword}
            alt="Milo pour la récupération de mot de passe"
            className="password-modal-hero"
            draggable={false}
          />
          <p className="password-modal-eyebrow">Récupération de compte</p>
          <h2 id="password-modal-title">Mot de passe oublié</h2>
          <p className="password-modal-subtitle">
            Saisis ton adresse email pour recevoir le lien de réinitialisation.
          </p>
        </div>

        <div className="password-modal-body">
          <form className="password-modal-form" onSubmit={handleSubmit}>
            <label className="password-modal-field">
              <span>Email</span>
              <input
                ref={emailInputRef}
                type="email"
                placeholder="exemple@ferme.fr"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
              />
            </label>

            {error ? <div className="password-modal-feedback is-error">{error}</div> : null}
            {success ? <div className="password-modal-feedback is-success">{success}</div> : null}

            <button type="submit" className="password-modal-submit" disabled={loading}>
              {loading ? 'Envoi...' : 'Envoyer le lien'}
            </button>
          </form>

          <div className="password-modal-links">
            <button
              type="button"
              className="password-modal-link"
              onClick={() => {
                onClose?.();
                onOpenLogin?.();
              }}
            >
              Retour à la connexion
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default PasswordModal;
