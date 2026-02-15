import { useState, forwardRef, useImperativeHandle } from 'react';
import { useNavigate } from 'react-router-dom';
import RegisterModal from './RegisterModal';
import LoginModal from './LoginModal';
import PasswordModal from './PasswordModal';
import FarmCreationStepper from '../farms/FarmCreationStepper';
import { useAuth } from './AuthContext';
import { supabase } from './supabaseClient';

const AuthFlowManager = forwardRef((props, ref) => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [showRegister, setShowRegister] = useState(false);
  const [showLogin, setShowLogin] = useState(false);
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [showFarmStepper, setShowFarmStepper] = useState(false);
  const [pendingFarmCheck, setPendingFarmCheck] = useState(false);

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