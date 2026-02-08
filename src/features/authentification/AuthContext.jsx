import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { supabase } from './supabaseClient';

const AuthContext = createContext();

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const userRef = useRef(null);

  useEffect(() => {
    userRef.current = user;
  }, [user]);

  useEffect(() => {
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
    supabase.auth.getSession().then(({ data: { session }, error }) => {
      if (error) {
        console.error('Erreur lors de la récupération de la session:', error);
      }
      setUser(session?.user ?? null);
      setLoading(false);
      if (session?.user) {
        syncProfileEmail(session.user);
      }
    }).catch((error) => {
      console.error('Erreur inattendue lors de getSession:', error);
      setLoading(false);
    });

    // Écouter les changements d'authentification
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
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
