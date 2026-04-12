import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { BrowserRouter as Router, Routes, Route, useLocation } from 'react-router-dom';
import { CheckCircle2, AlertTriangle, XCircle } from 'lucide-react';
import Home from './features/home/Home';
import BetailMaker from './features/betails/BetailMaker';
import BetailsListPage from './features/betails/BetailsListPageQuery';
import MyBetailsPageQuery from './features/betails/MyBetailsPageQuery';
import FarmGestion_Home_Mere from './features/home/FarmGestion_Home_Mere';
import PrivateRoute from './features/authentification/PrivateRoute';
import ResetPasswordPage from './features/authentification/ResetPasswordPage';
import { AuthProvider } from './features/authentification/AuthContext';
import AuthenticatedLayout from './features/home/AuthenticatedLayout';
import RulesPage from './features/other/RulesPage';
import TestSurpriseDemoPage from './features/other/TestSurpriseDemoPage';
import MaintenancePage from './features/other/MaintenancePage';
import FarmPage from './features/farms/FarmPage';
import ShopPage from './features/boutique/ShopPage';
import GCEPage from './features/betails/expedition/GCEPage/GCEPage';
import CommunityPage from './features/community/CommunityPage';
import CommunityProfilePage from './features/community/CommunityProfilePage';
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
    const handleImageDragStart = (event) => {
      const target = event.target;
      if (!(target instanceof HTMLImageElement)) return;
      if (target.draggable || target.dataset.allowDrag === 'true') return;
      event.preventDefault();
    };

    document.addEventListener('dragstart', handleImageDragStart, true);
    return () => {
      document.removeEventListener('dragstart', handleImageDragStart, true);
    };
  }, []);

  useEffect(() => {
    const storageMarkers = [
      '/storage/v1/object/public/betails/',
      '/storage/v1/object/public/avatars/',
      '/storage/v1/object/public/badges/',
    ];

    const hasKeyword = (value, keywords) => {
      const normalized = String(value || '').toLowerCase();
      return keywords.some((keyword) => normalized.includes(keyword));
    };

    const shouldFadeImage = (img) => {
      if (!(img instanceof HTMLImageElement)) return false;
      if (img.dataset.imageFade === 'off') return false;
      if (img.dataset.imageFade === 'on') return true;

      const src = String(img.currentSrc || img.src || '').toLowerCase();
      if (storageMarkers.some((marker) => src.includes(marker))) return true;

      if (hasKeyword(img.alt, ['betail', 'badge', 'avatar', 'profil', 'profile'])) return true;

      const ownClass = String(img.className || '').toLowerCase();
      const parentClass = String(img.parentElement?.className || '').toLowerCase();
      const grandParentClass = String(img.parentElement?.parentElement?.className || '').toLowerCase();
      return hasKeyword(`${ownClass} ${parentClass} ${grandParentClass}`, ['avatar', 'badge', 'betail']);
    };

    const prepareImage = (img) => {
      if (!shouldFadeImage(img)) return;
      img.classList.add('media-fade-image');
      if (img.complete) {
        img.classList.add('is-loaded');
      } else {
        img.classList.remove('is-loaded');
      }
    };

    const markImageAsLoaded = (img) => {
      if (!shouldFadeImage(img)) return;
      img.classList.add('media-fade-image');
      img.classList.add('is-loaded');
    };

    const scanImages = (root) => {
      if (!root) return;
      if (root instanceof HTMLImageElement) {
        prepareImage(root);
        return;
      }
      if (!(root instanceof Element || root instanceof Document)) return;
      root.querySelectorAll('img').forEach((img) => prepareImage(img));
    };

    const handleImageLoad = (event) => {
      const target = event.target;
      if (!(target instanceof HTMLImageElement)) return;
      markImageAsLoaded(target);
    };

    const handleImageError = (event) => {
      const target = event.target;
      if (!(target instanceof HTMLImageElement)) return;
      markImageAsLoaded(target);
    };

    scanImages(document);
    document.addEventListener('load', handleImageLoad, true);
    document.addEventListener('error', handleImageError, true);

    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (mutation.type === 'attributes' && mutation.target instanceof HTMLImageElement) {
          prepareImage(mutation.target);
          return;
        }

        if (mutation.type === 'childList') {
          mutation.addedNodes.forEach((node) => scanImages(node));
        }
      });
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['src'],
    });

    return () => {
      observer.disconnect();
      document.removeEventListener('load', handleImageLoad, true);
      document.removeEventListener('error', handleImageError, true);
    };
  }, []);

  useEffect(() => {
    if (!toast) return undefined;

    if (!toast.visible) {
      const clearTimer = setTimeout(() => {
        setToast(null);
      }, 220);
      return () => clearTimeout(clearTimer);
    }

    const hideTimer = setTimeout(() => {
      setToast((current) => (current ? { ...current, visible: false } : current));
    }, 4200);

    return () => {
      clearTimeout(hideTimer);
    };
  }, [toast?.message, toast?.type, toast?.visible]);

  return (
    <>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/maintenance" element={<MaintenancePage />} />
        <Route path="/test" element={<TestSurpriseDemoPage />} />
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
        <Route path="/reset-password" element={<ResetPasswordPage />} />
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
        <Route
          path="/betail-register/:id"
          element={
            <PrivateRoute>
              <AuthenticatedLayout>
                <BetailsListPage />
              </AuthenticatedLayout>
            </PrivateRoute>
          }
        />
        <Route
          path="/mes-betails"
          element={
            <PrivateRoute>
              <AuthenticatedLayout>
                <MyBetailsPageQuery />
              </AuthenticatedLayout>
            </PrivateRoute>
          }
        />
        <Route
          path="/farm/:id"
          element={
            <PrivateRoute>
              <AuthenticatedLayout>
                <FarmPage />
              </AuthenticatedLayout>
            </PrivateRoute>
          }
        />
        <Route
          path="/boutique"
          element={
            <PrivateRoute>
              <AuthenticatedLayout>
                <ShopPage />
              </AuthenticatedLayout>
            </PrivateRoute>
          }
        />
        <Route
          path="/community"
          element={
            <PrivateRoute>
              <AuthenticatedLayout>
                <CommunityPage />
              </AuthenticatedLayout>
            </PrivateRoute>
          }
        />
        <Route
          path="/community/profile/:handle"
          element={
            <PrivateRoute>
              <AuthenticatedLayout>
                <CommunityProfilePage />
              </AuthenticatedLayout>
            </PrivateRoute>
          }
        />
        <Route
          path="/farms-actives"
          element={
            <PrivateRoute>
              <AuthenticatedLayout>
                <CommunityPage />
              </AuthenticatedLayout>
            </PrivateRoute>
          }
        />
        <Route
          path="/gce"
          element={
            <PrivateRoute>
              <AuthenticatedLayout>
                <GCEPage />
              </AuthenticatedLayout>
            </PrivateRoute>
          }
        />
      </Routes>
      {toast && typeof document !== 'undefined'
        ? createPortal(
            <div
              className={`global-toast ${toast.type === 'success' ? 'is-success' : toast.type === 'error' ? 'is-error' : toast.type === 'warning' ? 'is-warning' : ''} ${toast.visible ? 'is-visible' : ''}`}
            >
              <span className="global-toast__icon">
                {toast.type === 'error' ? <XCircle size={15} /> : toast.type === 'warning' ? <AlertTriangle size={15} /> : <CheckCircle2 size={15} />}
              </span>
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
