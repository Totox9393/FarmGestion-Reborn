import { useState } from 'react';
import { supabase } from '../authentification/supabaseClient';

function Settings_ChangeEmail({ user }) {
  const [isOpen, setIsOpen] = useState(false);
  const [nextEmail, setNextEmail] = useState('');
  const [status, setStatus] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const resetForm = () => {
    setNextEmail('');
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!user?.email) {
      setStatus({ type: 'error', message: "Impossible de lire l'adresse e-mail actuelle." });
      return;
    }
    if (!nextEmail.trim()) {
      setStatus({ type: 'error', message: 'Veuillez saisir une nouvelle adresse e-mail.' });
      return;
    }
    if (nextEmail.trim().toLowerCase() === user.email.toLowerCase()) {
      setStatus({ type: 'error', message: 'La nouvelle adresse e-mail est identique.' });
      return;
    }

    setIsSubmitting(true);
    setStatus(null);
    const redirectTo = `${window.location.origin}/home?toast=email-confirmed`;
    const { error } = await supabase.auth.updateUser(
      { email: nextEmail.trim() },
      { emailRedirectTo: redirectTo }
    );

    if (error) {
      setStatus({ type: 'error', message: "Impossible de mettre à jour l'adresse e-mail." });
      setIsSubmitting(false);
      return;
    }

    window.dispatchEvent(
      new CustomEvent('farmgestion-toast', {
        detail: { type: 'success', message: 'E-mail de confirmation envoyé.' },
      })
    );
    setStatus({
      type: 'success',
      message: 'Un e-mail de confirmation a été envoyé. Le changement sera appliqué après validation.',
    });
    setIsSubmitting(false);
    setTimeout(() => {
      resetForm();
      setStatus(null);
      setIsOpen(false);
    }, 1600);
  };

  return (
    <div className={`settings-item settings-item--stacked ${isOpen ? 'is-open' : ''}`}>
      <div className="settings-item-row">
        <div>
          <p className="settings-item-title">Adresse e-mail</p>
          <p className="settings-item-subtitle">Mettez à jour l'adresse associée au compte.</p>
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
        <form className="settings-email-panel" onSubmit={handleSubmit}>
          <div className="settings-email-fields">
            <label className="settings-email-field">
              <span>Adresse actuelle</span>
              <input
                type="email"
                value={user?.email || ''}
                readOnly
                className="settings-email-readonly"
              />
            </label>
            <label className="settings-email-field">
              <span>Nouvelle adresse</span>
              <input
                type="email"
                value={nextEmail}
                onChange={(event) => setNextEmail(event.target.value)}
                placeholder="nouveau@exemple.fr"
                required
              />
            </label>
          </div>

          {status?.message && (
            <p className={`settings-email-status ${status.type}`}>{status.message}</p>
          )}

          <div className="settings-email-actions">
            <button
              type="button"
              className="settings-action settings-action--ghost"
              onClick={() => {
                resetForm();
                setStatus(null);
                setIsOpen(false);
              }}
              disabled={isSubmitting}
            >
              Annuler
            </button>
            <button type="submit" className="settings-action settings-action--primary" disabled={isSubmitting}>
              {isSubmitting ? 'Mise à jour...' : 'Mettre à jour'}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

export default Settings_ChangeEmail;
