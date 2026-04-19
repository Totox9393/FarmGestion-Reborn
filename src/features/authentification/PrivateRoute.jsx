import { Navigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { useAuth } from './AuthContext';
import { supabase } from './supabaseClient';

function PrivateRoute({ children, requireFarm = false, requireAvatar = false, requireOnboarding = true, requireAdmin = false }) {
  const { user, loading } = useAuth();
  const userId = user?.id ?? null;
  const requiresProfileCheck = requireOnboarding || requireFarm || requireAvatar || requireAdmin;
  const [checkingAccess, setCheckingAccess] = useState(requiresProfileCheck);
  const [hasFarm, setHasFarm] = useState(null);
  const [hasAvatar, setHasAvatar] = useState(null);
  const [hasAdminRole, setHasAdminRole] = useState(null);

  useEffect(() => {
    let ignore = false;

    if (!requiresProfileCheck || !userId) {
      setCheckingAccess(false);
      setHasFarm(null);
      setHasAvatar(null);
      setHasAdminRole(null);
      return () => { ignore = true; };
    }

    setCheckingAccess(true);
    supabase
      .from('users_profiles')
      .select('farm_id, avatar_url, role, role_ingame')
      .eq('id', userId)
      .maybeSingle()
      .then(({ data }) => {
        if (ignore) return;
        setHasFarm(data?.farm_id ? true : false);
        setHasAvatar(typeof data?.avatar_url === 'string' ? data.avatar_url.trim().length > 0 : Boolean(data?.avatar_url));
        const normalizedRoles = String(`${data?.role || ''} ${data?.role_ingame || ''}`).toUpperCase();
        setHasAdminRole(normalizedRoles.includes('ADMIN'));
        setCheckingAccess(false);
      })
      .catch(() => {
        if (!ignore) {
          setHasFarm(null);
          setHasAvatar(null);
          setHasAdminRole(null);
          setCheckingAccess(false);
        }
      });
    return () => { ignore = true; };
  }, [requiresProfileCheck, userId]);

  if (loading || checkingAccess) return null;
  if (!user) return <Navigate to="/" replace />;

  const farmRequired = requireOnboarding || requireFarm;
  const avatarRequired = requireOnboarding || requireAvatar;
  const adminRequired = requireAdmin;
  const hasRequiredFarm = !farmRequired || hasFarm === true;
  const hasRequiredAvatar = !avatarRequired || hasAvatar === true;
  const hasRequiredAdmin = !adminRequired || hasAdminRole === true;

  if (!hasRequiredFarm || !hasRequiredAvatar || !hasRequiredAdmin) {
    const isBlockedByOnboarding = !hasRequiredFarm || !hasRequiredAvatar;
    if (isBlockedByOnboarding) {
      sessionStorage.setItem('fg_forceFarmCreation', '1');
    }
    return <Navigate to="/" replace />;
  }

  return children;
}

export default PrivateRoute;
