import { useQuery } from '@tanstack/react-query';
import { supabase } from '../authentification/supabaseClient';

export const AUCTIONS_ENABLED_QUERY_KEY = ['auctions', 'system-enabled'];

// Interrupteur général des enchères (auction_config_reborn.system_enabled).
// Tant que la réponse n'est pas connue, `isLoading` est vrai : on n'affiche rien.
// Si la colonne n'existe pas encore (migration SQL non lancée), le site reste comme avant.
export function useAuctionsEnabled() {
  const query = useQuery({
    queryKey: AUCTIONS_ENABLED_QUERY_KEY,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('auction_config_reborn')
        .select('system_enabled')
        .eq('id', true)
        .maybeSingle();
      if (error) throw error;
      return data?.system_enabled !== false;
    },
    staleTime: 60_000,
    retry: 1,
  });

  return {
    enabled: query.isError ? true : query.data === true,
    isLoading: query.isPending,
  };
}
