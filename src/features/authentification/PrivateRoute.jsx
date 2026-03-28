import { Navigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { useAuth } from './AuthContext';
import { supabase } from './supabaseClient';

function PrivateRoute({ children, requireFarm = false, requireAvatar = false, requireOnboarding = true }) {
  const { user, loading } = useAuth();
  const requiresProfileCheck = requireOnboarding || requireFarm || requireAvatar;
  const [checkingAccess, setCheckingAccess] = useState(requiresProfileCheck);
  const [hasFarm, setHasFarm] = useState(null);
  const [hasAvatar, setHasAvatar] = useState(null);

  useEffect(() => {
    let ignore = false;

    if (!requiresProfileCheck || !user) {
      setCheckingAccess(false);
      setHasFarm(null);
      setHasAvatar(null);
      return () => { ignore = true; };
    }

    setCheckingAccess(true);
    supabase
      .from('users_profiles')
      .select('farm_id, avatar_url')
      .eq('id', user.id)
      .maybeSingle()
      .then(({ data }) => {
        if (ignore) return;
        setHasFarm(data?.farm_id ? true : false);
        setHasAvatar(typeof data?.avatar_url === 'string' ? data.avatar_url.trim().length > 0 : Boolean(data?.avatar_url));
        setCheckingAccess(false);
      })
      .catch(() => {
        if (!ignore) {
          setHasFarm(null);
          setHasAvatar(null);
          setCheckingAccess(false);
        }
      });
    return () => { ignore = true; };
  }, [requiresProfileCheck, user]);

  if (loading || checkingAccess) return null;
  if (!user) return <Navigate to="/" replace />;

  const farmRequired = requireOnboarding || requireFarm;
  const avatarRequired = requireOnboarding || requireAvatar;
  const hasRequiredFarm = !farmRequired || hasFarm === true;
  const hasRequiredAvatar = !avatarRequired || hasAvatar === true;

  if (!hasRequiredFarm || !hasRequiredAvatar) {
    sessionStorage.setItem('fg_forceFarmCreation', '1');
    return <Navigate to="/" replace />;
  }

  return children;
}

export default PrivateRoute;
