import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

// Conserver le même client lors des remplacements de modules Vite : un ancien
// client peut sinon continuer à renouveler la même session en arrière-plan.
export const supabase = import.meta.hot?.data.supabase ?? createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    // Auto-rafraîchissement du token avant expiration
    autoRefreshToken: true,
    // Détection du changement de la session
    detectSessionInUrl: true,
    // Persister la session dans localStorage
    persistSession: true,
    // Espace de stockage pour la session
    storage: typeof window !== 'undefined' ? window.localStorage : undefined,
    storageKey: 'farmgestion-auth-token',
  },
});

if (import.meta.hot) {
  import.meta.hot.dispose((data) => {
    data.supabase = supabase;
  });
}
