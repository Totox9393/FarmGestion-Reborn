import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import miloPassword from '../../assets/img/milo_password.png';
import { supabase } from './supabaseClient';
import './ResetPasswordPage.css';

function ResetPasswordPage() {
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [canReset, setCanReset] = useState(false);

  const hasRecoveryParams = useMemo(() => {
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    const query = new URLSearchParams(window.location.search);
    const type = hash.get('type') || query.get('type');
    const token = hash.get('access_token') || query.get('access_token');
    return type === 'recovery' && Boolean(token);
  }, []);

  useEffect(() => {
    let mounted = true;

    const checkRecovery = async () => {
      if (hasRecoveryParams) {
        setCanReset(true);
        return;
      }

      const { data: authListener } = supabase.auth.onAuthStateChange((event) => {
        if (!mounted) return;
        if (event === 'PASSWORD_RECOVERY') {
          setCanReset(true);
        }
      });

      const { data } = await supabase.auth.getSession();
      if (mounted && data?.session && hasRecoveryParams) {
        setCanReset(true);
      }

      return () => {
        authListener?.subscription?.unsubscribe();
      };
    };

    let cleanup;
    checkRecovery().then((unsubscribe) => {
      cleanup = unsubscribe;
    });

    return () => {
      mounted = false;
      if (cleanup) cleanup();
    };
  }, [hasRecoveryParams]);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError('');

    if (password.length < 8) {
      setError('Le mot de passe doit contenir au moins 8 caractères.');
      return;
    }

    if (password !== confirmPassword) {
      setError('Les mots de passe ne correspondent pas.');
      return;
    }

    setLoading(true);
    const { error: updateError } = await supabase.auth.updateUser({ password });

    if (updateError) {
      setError(updateError.message || 'Impossible de mettre à jour le mot de passe.');
      setLoading(false);
      return;
    }

    await supabase.auth.signOut();
    setLoading(false);
    navigate('/?auth=login&toast=password-updated', { replace: true });
  };

  return (
    <div className="reset-page">
      <div className="reset-card" role="region" aria-label="Réinitialisation du mot de passe">
        <img src={miloPassword} alt="Milo pour la réinitialisation" className="reset-hero" draggable={false} />
        <p className="reset-eyebrow">Sécurité du compte</p>
        <h1 className="reset-title">Définir un nouveau mot de passe</h1>

        {!canReset ? (
          <>
            <p className="reset-message">
              Ce lien de réinitialisation est invalide ou expiré. Recommence depuis « Mot de passe oublié ».
            </p>
            <button type="button" className="reset-submit" onClick={() => navigate('/', { replace: true })}>
              Retour à l'accueil
            </button>
          </>
        ) : (
          <form className="reset-form" onSubmit={handleSubmit}>
            <label className="reset-field">
              <span>Nouveau mot de passe</span>
              <input
                type="password"
                placeholder="Minimum 8 caractères"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
              />
            </label>

            <label className="reset-field">
              <span>Confirmer le mot de passe</span>
              <input
                type="password"
                placeholder="Confirme ton mot de passe"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                required
              />
            </label>

            {error ? <div className="reset-error">{error}</div> : null}

            <button type="submit" className="reset-submit" disabled={loading}>
              {loading ? 'Mise à jour...' : 'Mettre à jour le mot de passe'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

export default ResetPasswordPage;
