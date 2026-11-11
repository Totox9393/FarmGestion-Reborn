import { supabase } from '../authentification/supabaseClient';

const invokeAuthenticatedFunction = async (name, body) => {
  let { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  const expiresAtMs = Number(sessionData?.session?.expires_at || 0) * 1000;
  if (!sessionError && expiresAtMs && expiresAtMs - Date.now() < 60_000) {
    const refreshResult = await supabase.auth.refreshSession();
    sessionData = refreshResult.data;
    sessionError = refreshResult.error;
  }
  let accessToken = sessionData?.session?.access_token;

  if (sessionError || !accessToken) {
    throw new Error('Votre session a expiré. Reconnectez-vous.');
  }

  const invokeWithToken = (token) => supabase.functions.invoke(name, {
    body,
    headers: { Authorization: `Bearer ${token}` },
  });

  let response = await invokeWithToken(accessToken);

  // getSession lit d'abord le cache local. Si le serveur rejette ce JWT entre-temps,
  // renouveler réellement la session puis rejouer une seule fois la requête.
  if (Number(response.error?.context?.status || 0) === 401) {
    const refreshResult = await supabase.auth.refreshSession();
    const refreshedToken = refreshResult.data?.session?.access_token;
    if (refreshResult.error || !refreshedToken) {
      await supabase.auth.signOut({ scope: 'local' }).catch(() => {});
      throw new Error('Votre session a expiré. Reconnectez-vous.');
    }
    accessToken = refreshedToken;
    response = await invokeWithToken(accessToken);
  }

  const { data, error } = response;

  if (error) {
    let message = error.message || 'Le service de messagerie est indisponible.';
    try {
      const payload = await error.context?.json();
      if (payload?.error) {
        const diagnosticMessage = String(payload?.diagnostic?.message || '').trim();
        const diagnosticCode = payload?.diagnostic?.code;
        const diagnosticSuffix = diagnosticMessage
          ? ` — ${diagnosticMessage}${diagnosticCode !== null && diagnosticCode !== undefined ? ` (code ${diagnosticCode})` : ''}`
          : '';
        message = `${payload.error}${diagnosticSuffix}`;
      }
    } catch {
      // The Functions client may already have consumed the response body.
    }
    const functionError = new Error(message);
    functionError.status = error.context?.status;
    throw functionError;
  }

  return data;
};

export const fetchStreamCredentials = () => invokeAuthenticatedFunction('stream-auth', {});

export const openStreamConversation = (friendUserId) =>
  invokeAuthenticatedFunction('stream-open-conversation', { friendUserId });

export const openPublicStreamChannel = () =>
  invokeAuthenticatedFunction('stream-public-channel', { action: 'open' });

export const moderatePublicStreamChannel = (payload) =>
  invokeAuthenticatedFunction('stream-public-channel', payload);
