import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { BrowserRouter as Router, Routes, Route, useLocation } from 'react-router-dom';
import Home from './features/home/Home';
import BetailMaker from './features/betails/BetailMaker';
import BetailsListPage from './features/betails/BetailsListPageQuery';
import FarmGestion_Home_Mere from './features/home/FarmGestion_Home_Mere';
import PrivateRoute from './features/authentification/PrivateRoute';
import { AuthProvider } from './features/authentification/AuthContext';
import AuthenticatedLayout from './features/home/AuthenticatedLayout';
import RulesPage from './features/other/RulesPage';
import './App.css';

function AppRoutes() {
  const location = useLocation();
  const [toast, setToast] = useState(null);

  const showToastFromStorage = () => {
    const raw = localStorage.getItem('farmgestion_toast');
    if (!raw) return;
    localStorage.removeItem('farmgestion_toast');
    try {
      const parsed = JSON.parse(raw);
      setToast({ ...parsed, visible: true });
    } catch {
      setToast({ message: raw, type: 'success', visible: true });
    }
  };

  const showToastFromQuery = () => {
    const params = new URLSearchParams(location.search);
    const toastParam = params.get('toast');
    if (!toastParam) return;
    if (toastParam === 'password-updated') {
      setToast({ message: 'Mot de passe mis à jour.', type: 'success', visible: true });
    }
    if (toastParam === 'email-confirmed') {
      setToast({ message: 'Adresse e-mail confirmée.', type: 'success', visible: true });
    }
    params.delete('toast');
    const nextSearch = params.toString();
    const nextUrl = `${location.pathname}${nextSearch ? `?${nextSearch}` : ''}`;
    window.history.replaceState({}, '', nextUrl);
  };

  useEffect(() => {
    showToastFromStorage();
    showToastFromQuery();
  }, [location.pathname]);

  useEffect(() => {
    showToastFromQuery();
  }, [location.search]);

  useEffect(() => {
    const handleToastEvent = (event) => {
      const detail = event?.detail;
      if (detail?.message) {
        setToast({ ...detail, visible: true });
        return;
      }
      showToastFromStorage();
    };
    window.addEventListener('farmgestion-toast', handleToastEvent);
    return () => window.removeEventListener('farmgestion-toast', handleToastEvent);
  }, []);

  useEffect(() => {
    if (!toast) return undefined;
    const hideTimer = setTimeout(() => {
      setToast((current) => (current ? { ...current, visible: false } : current));
    }, 4200);
    const clearTimer = setTimeout(() => {
      setToast(null);
    }, 4700);
    return () => {
      clearTimeout(hideTimer);
      clearTimeout(clearTimer);
    };
  }, [toast]);

  return (
    <>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route
          path="/betail-maker"
          element={
            <PrivateRoute>
              <AuthenticatedLayout>
                <BetailMaker />
              </AuthenticatedLayout>
            </PrivateRoute>
          }
        />
        <Route path="/rules" element={<RulesPage />} />
        <Route
          path="/home"
          element={
            <PrivateRoute requireFarm>
              <AuthenticatedLayout>
                <FarmGestion_Home_Mere />
              </AuthenticatedLayout>
            </PrivateRoute>
          }
        />
        <Route
          path="/betail-register"
          element={
            <PrivateRoute>
              <AuthenticatedLayout>
                <BetailsListPage />
              </AuthenticatedLayout>
            </PrivateRoute>
          }
        />
      </Routes>
      {toast && typeof document !== 'undefined'
        ? createPortal(
            <div className={`global-toast ${toast.type === 'success' ? 'is-success' : ''} ${toast.visible ? 'is-visible' : ''}`}>
              <span className="global-toast__icon">✅</span>
              <span>{toast.message}</span>
            </div>,
            document.body
          )
        : null}
    </>
  );
}

function App() {
  return (
    <AuthProvider>
      <Router>
        <AppRoutes />
      </Router>
    </AuthProvider>
  );
}

export default App;
