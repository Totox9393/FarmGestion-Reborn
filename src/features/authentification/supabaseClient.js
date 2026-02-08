import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

// Configuration améliorée pour la persistance de session
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    // Auto-rafraîchissement du token avant expiration
    autoRefreshTokens: true,
    // Détection du changement de la session
    detectSessionInUrl: true,
    // Persister la session dans localStorage
    persistSession: true,
    // Espace de stockage pour la session
    storage: typeof window !== 'undefined' ? window.localStorage : undefined,
    // Refresh token avant 60 secondes de l'expiration
    storageKey: 'farmgestion-auth-token',
  },
});
