import { useState } from 'react';
import { CheckCircle2, Eye, EyeOff } from 'lucide-react';
import { supabase } from '../authentification/supabaseClient';

function Settings_ChangePassword({ user }) {
  const [isOpen, setIsOpen] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [nextPassword, setNextPassword] = useState('');
  const [nextPasswordConfirm, setNextPasswordConfirm] = useState('');
  const [showNextPassword, setShowNextPassword] = useState(false);
  const [status, setStatus] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSuccessOverlay, setIsSuccessOverlay] = useState(false);

  const resetForm = () => {
    setCurrentPassword('');
    setNextPassword('');
    setNextPasswordConfirm('');
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!user?.email) {
      setStatus({ type: 'error', message: "Impossible de vérifier l'utilisateur." });
      return;
    }
    if (!currentPassword || !nextPassword || !nextPasswordConfirm) {
      setStatus({ type: 'error', message: 'Tous les champs sont requis.' });
      return;
    }
    if (nextPassword !== nextPasswordConfirm) {
      setStatus({ type: 'error', message: 'Les nouveaux mots de passe ne correspondent pas.' });
      return;
    }

    setIsSubmitting(true);
    setStatus(null);

    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: user.email,
      password: currentPassword,
    });

    if (signInError) {
      setStatus({ type: 'error', message: "Mot de passe actuel incorrect." });
      setIsSubmitting(false);
      return;
    }

    const { error: updateError } = await supabase.auth.updateUser({
      password: nextPassword,
    });

    if (updateError) {
      setStatus({ type: 'error', message: "Impossible de mettre à jour le mot de passe." });
      setIsSubmitting(false);
      return;
    }

    window.dispatchEvent(
      new CustomEvent('farmgestion-toast', {
        detail: { type: 'success', message: 'Mot de passe mis à jour.' },
      })
    );
    setStatus({ type: 'success', message: 'Mot de passe mis à jour.' });
    setIsSuccessOverlay(true);
    setIsSubmitting(false);
    setTimeout(() => {
      resetForm();
      setShowNextPassword(false);
      setStatus(null);
      setIsSuccessOverlay(false);
      setIsOpen(false);
    }, 1400);
  };

  return (
    <div className={`settings-item settings-item--stacked ${isOpen ? 'is-open' : ''}`}>
      <div className="settings-item-row">
        <div>
          <p className="settings-item-title">Mot de passe</p>
          <p className="settings-item-subtitle">Modifiez votre mot de passe pour sécuriser votre compte.</p>
        </div>
        <button
          type="button"
          className="settings-action"
          onClick={() => setIsOpen((value) => !value)}
        >
          {isOpen ? 'Fermer' : 'Modifier'}
        </button>
      </div>

      {isOpen && (
        <form className={`settings-password-panel ${isSuccessOverlay ? 'is-success' : ''}`} onSubmit={handleSubmit}>
          <div className="settings-password-fields">
            <label className="settings-password-field">
              <span>Mot de passe actuel</span>
              <input
                type="password"
                value={currentPassword}
                onChange={(event) => setCurrentPassword(event.target.value)}
                placeholder="Votre mot de passe actuel"
                disabled={isSuccessOverlay}
              />
            </label>
            <label className="settings-password-field">
              <span>Nouveau mot de passe</span>
              <div className="settings-password-input">
                <input
                  type={showNextPassword ? 'text' : 'password'}
                  value={nextPassword}
                  onChange={(event) => setNextPassword(event.target.value)}
                  placeholder="Nouveau mot de passe"
                  disabled={isSuccessOverlay}
                />
                <button
                  type="button"
                  className="settings-password-toggle"
                  onClick={() => setShowNextPassword((value) => !value)}
                  aria-label={showNextPassword ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}
                  disabled={isSuccessOverlay}
                >
                  {showNextPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </label>
            <label className="settings-password-field">
              <span>Confirmer le nouveau mot de passe</span>
              <input
                type="password"
                value={nextPasswordConfirm}
                onChange={(event) => setNextPasswordConfirm(event.target.value)}
                placeholder="Répétez le nouveau mot de passe"
                disabled={isSuccessOverlay}
              />
            </label>
          </div>

          {status?.message && (
            <p className={`settings-password-status ${status.type}`}>{status.message}</p>
          )}

          <div className="settings-password-actions">
            <button
              type="button"
              className="settings-action settings-action--ghost"
              onClick={() => {
                resetForm();
                setStatus(null);
                setIsOpen(false);
              }}
              disabled={isSubmitting || isSuccessOverlay}
            >
              Annuler
            </button>
            <button type="submit" className="settings-action settings-action--primary" disabled={isSubmitting || isSuccessOverlay}>
              {isSubmitting ? 'Mise à jour...' : 'Mettre à jour'}
            </button>
          </div>
          {isSuccessOverlay && (
            <div className="settings-password-success" role="status" aria-live="polite">
              <span className="settings-password-success-icon">
                <CheckCircle2 size={22} />
              </span>
              <span>Changement du mot de passe effectué</span>
            </div>
          )}
        </form>
      )}
    </div>
  );
}

export default Settings_ChangePassword;
