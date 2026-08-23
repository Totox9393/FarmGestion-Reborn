import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { supabase } from './supabaseClient';

const AuthContext = createContext();
const AUTH_STORAGE_KEY = 'farmgestion-auth-token';

const isInvalidRefreshTokenError = (error) => {
  const message = String(error?.message || error || '').toLowerCase();
  return message.includes('invalid refresh token')
    || message.includes('refresh token not found');
};

const clearInvalidLocalSession = async () => {
  try {
    const { error } = await supabase.auth.signOut({ scope: 'local' });
    if (error) throw error;
  } catch {
    try {
      window.localStorage.removeItem(AUTH_STORAGE_KEY);
      window.localStorage.removeItem(`${AUTH_STORAGE_KEY}-code-verifier`);
    } catch {
      // Ignore storage failures; the app will continue as signed out.
    }
  }
};

const areUsersEquivalent = (a, b) => {
  if (!a && !b) return true;
  if (!a || !b) return false;
  return (
    a.id === b.id &&
    a.email === b.email &&
    a.phone === b.phone &&
    a.updated_at === b.updated_at &&
    a.last_sign_in_at === b.last_sign_in_at
  );
};

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const userRef = useRef(null);

  useEffect(() => {
    userRef.current = user;
  }, [user]);

  useEffect(() => {
    const setUserFromSession = (sessionUser) => {
      setUser((currentUser) => (areUsersEquivalent(currentUser, sessionUser) ? currentUser : sessionUser));
    };

    const syncProfileEmail = async (sessionUser) => {
      if (!sessionUser?.id || !sessionUser?.email) return;
      const currentEmail = userRef.current?.email;
      if (currentEmail && currentEmail === sessionUser.email) return;
      try {
        await supabase
          .from('users_profiles')
          .update({ email: sessionUser.email })
          .eq('id', sessionUser.id);
      } catch (error) {
        console.error('Erreur lors de la synchronisation du profil:', error);
      }
    };

    // Récupérer la session initiale
    supabase.auth.getSession().then(async ({ data: { session }, error }) => {
      if (error) {
        console.error('Erreur lors de la récupération de la session:', error);
        if (isInvalidRefreshTokenError(error)) {
          await clearInvalidLocalSession();
        }
      }
      setUserFromSession(error ? null : (session?.user ?? null));
      setLoading(false);
      if (!error && session?.user) {
        syncProfileEmail(session.user);
      }
    }).catch(async (error) => {
      console.error('Erreur inattendue lors de getSession:', error);
      if (isInvalidRefreshTokenError(error)) {
        await clearInvalidLocalSession();
      }
      setUserFromSession(null);
      setLoading(false);
    });

    // Écouter les changements d'authentification
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      setUserFromSession(session?.user ?? null);
      if (session?.user) {
        syncProfileEmail(session.user);
      }
    });
    
    return () => {
      listener?.subscription.unsubscribe();
    };
  }, []);

  const value = { user, loading };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
