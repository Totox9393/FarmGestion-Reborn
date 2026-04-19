import { useEffect, useState, forwardRef, useImperativeHandle } from 'react';
import { useNavigate } from 'react-router-dom';
import RegisterModal from './RegisterModal';
import LoginModal from './LoginModal';
import PasswordModal from './PasswordModal';
import FarmCreationStepper from '../farms/FarmCreationStepper';
import { useAuth } from './AuthContext';
import { supabase } from './supabaseClient';
import { readInitialSurpriseCode, redeemSurpriseCode } from './surpriseCode';

const tryAutoRedeemSurpriseCode = async () => {
  const code = readInitialSurpriseCode();
  if (!code) return;

  const result = await redeemSurpriseCode({
    code,
    source: 'auth_flow_oauth',
  });

  if (!result?.success || typeof window === 'undefined') return;

  const awardedMoney = Number(result?.awarded_money || 0);
  const awardedBadgeIds = Array.isArray(result?.awarded_badge_ids)
    ? result.awarded_badge_ids.filter(Boolean)
    : [result?.awarded_badge_id].filter(Boolean);
  const rewards = [];
  if (awardedMoney > 0) rewards.push(`+${awardedMoney} argent`);
  if (awardedBadgeIds.length > 0) {
    rewards.push(awardedBadgeIds.length > 1 ? `${awardedBadgeIds.length} badges` : '1 badge');
  }
  const rewardLabel = rewards.length ? rewards.join(' et ') : 'bonus applique';

  window.dispatchEvent(
    new CustomEvent('farmgestion-toast', {
      detail: { type: 'success', message: `Code surprise applique: ${rewardLabel}.` },
    }),
  );
};

const AuthFlowManager = forwardRef((props, ref) => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [showRegister, setShowRegister] = useState(false);
  const [showLogin, setShowLogin] = useState(false);
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [showFarmStepper, setShowFarmStepper] = useState(false);
  const [pendingFarmCheck, setPendingFarmCheck] = useState(false);

  useEffect(() => {
    if (!showRegister && !showLogin) return undefined;
    const previousTitle = document.title;
    if (showRegister) {
      document.title = "FG - S'inscrire";
    } else if (showLogin) {
      document.title = 'FG - Se connecter';
    }
    return () => {
      document.title = previousTitle;
    };
  }, [showRegister, showLogin]);

  // Ouvre le stepper après inscription
  const handleRegisterSuccess = () => {
    setShowRegister(false);
    setShowFarmStepper(true);
  };

  // Ouvre le stepper après login si pas de ferme
  const handleLoginSuccess = async () => {
    setShowLogin(false);
    setPendingFarmCheck(true);
    try {
      // Attendre que la session soit bien établie
      const { data: { session } } = await supabase.auth.getSession();
      const currentUser = session?.user;
      
      if (currentUser) {
        await tryAutoRedeemSurpriseCode();

        const { data } = await supabase
          .from('users_profiles')
          .select('farm_id')
          .eq('id', currentUser.id)
          .maybeSingle();
        if (!data?.farm_id) {
          setShowFarmStepper(true);
        } else {
          navigate('/home');
        }
      } else {
        // Pas de session trouvée - le listener devrait la détecter
        setShowLogin(false);
      }
    } catch (error) {
      console.error('Erreur lors de la récupération du user:', error);
      setShowFarmStepper(false);
    } finally {
      setPendingFarmCheck(false);
    }
  };

  // Expose les méthodes d'ouverture via ref
  useImperativeHandle(ref, () => ({
    openLogin: () => setShowLogin(true),
    openRegister: () => setShowRegister(true),
    openForgotPassword: () => setShowPasswordModal(true),
    openFarmCreation: () => setShowFarmStepper(true),
  }));

  return (
    <>
      <RegisterModal
        isOpen={showRegister}
        onClose={() => setShowRegister(false)}
        onOpenLogin={() => { setShowRegister(false); setShowLogin(true); }}
        onRegisterSuccess={handleRegisterSuccess}
      />
      <LoginModal
        isOpen={showLogin}
        onClose={() => setShowLogin(false)}
        onOpenRegister={() => { setShowLogin(false); setShowRegister(true); }}
        onForgotPassword={() => { setShowLogin(false); setShowPasswordModal(true); }}
        onLoginSuccess={handleLoginSuccess}
      />
      <PasswordModal
        isOpen={showPasswordModal}
        onClose={() => setShowPasswordModal(false)}
        onOpenLogin={() => { setShowPasswordModal(false); setShowLogin(true); }}
      />
      <FarmCreationStepper
        isOpen={showFarmStepper}
        onClose={() => setShowFarmStepper(false)}
        onComplete={() => {
          setShowFarmStepper(false);
          navigate('/home');
        }}
      />
    </>
  );
});
export default AuthFlowManager;