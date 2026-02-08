import { useEffect, useRef, useState } from 'react';
import { Icon } from '@iconify/react';
import './RegisterModal.css';
import miloCreateAccount from '../../assets/img/milo_createaccount.png';
import { signUpWithEmail } from './authApi';
import { supabase } from './supabaseClient';

function RegisterModal({ isOpen, onClose, onOpenLogin, onRegisterSuccess }) {
  const pseudoInputRef = useRef(null);
  const [pseudo, setPseudo] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
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

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (!pseudo.trim()) {
      setError('Le pseudo est requis.');
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
        username: pseudo,
        email,
        receive_newsletter: newsletter,
        created_at: now,
        updated_at: now
      });
      if (profileError) {
        setError('Compte créé mais erreur lors de l’enregistrement du profil.');
        setLoading(false);
        return;
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
            <button type="button" className="register-modal-social-button" aria-label="Inscription Google">
              <Icon icon="logos:google-icon" width={20} height={20} />
            </button>
            <button type="button" className="register-modal-social-button" aria-label="Inscription Apple">
              <Icon icon="logos:apple" width={20} height={20} />
            </button>
            <button type="button" className="register-modal-social-button" aria-label="Inscription Discord">
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
