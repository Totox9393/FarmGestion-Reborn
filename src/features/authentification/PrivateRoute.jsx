import { Navigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { useAuth } from './AuthContext';
import { supabase } from './supabaseClient';

function PrivateRoute({ children, requireFarm = false }) {
  const { user, loading } = useAuth();
  const [checkingAccess, setCheckingAccess] = useState(requireFarm);
  const [hasFarm, setHasFarm] = useState(null);

  useEffect(() => {
    let ignore = false;
    if (!requireFarm || !user) {
      setCheckingAccess(false);
      return () => { ignore = true; };
    }
    setCheckingAccess(true);
    supabase
      .from('users_profiles')
      .select('farm_id')
      .eq('id', user.id)
      .maybeSingle()
      .then(({ data }) => {
        if (ignore) return;
        setHasFarm(data?.farm_id ? true : false);
        setCheckingAccess(false);
      })
      .catch(() => {
        if (!ignore) {
          setHasFarm(null);
          setCheckingAccess(false);
        }
      });
    return () => { ignore = true; };
  }, [requireFarm, user]);

  if (loading || checkingAccess) return null;
  if (!user) return <Navigate to="/" replace />;
  if (requireFarm && hasFarm === false) {
    sessionStorage.setItem('fg_forceFarmCreation', '1');
    return <Navigate to="/" replace />;
  }
  return children;
}

export default PrivateRoute;
