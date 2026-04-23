import { useEffect, useRef, useState } from 'react';
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
import NotFoundPage from './features/other/NotFoundPage';
import FarmPage from './features/farms/FarmPage';
import ShopPage from './features/boutique/ShopPage';
import GCEPage from './features/betails/expedition/GCEPage/GCEPage';
import CommunityPage from './features/community/CommunityPage';
import CommunityProfilePage from './features/community/CommunityProfilePage';
import { useAuth } from './features/authentification/AuthContext';
import { readInitialSurpriseCode, redeemSurpriseCode } from './features/authentification/surpriseCode';
import './App.css';

const SURPRISE_AUTO_REDEEM_PREFIX = 'farmgestion_surprise_auto_redeem_';

const getAutoRedeemAttemptStorageKey = (userId, code) => {
  const safeUserId = String(userId || '').trim();
  const safeCode = String(code || '').trim();
  if (!safeUserId || !safeCode) return '';
  return `${SURPRISE_AUTO_REDEEM_PREFIX}${safeUserId}::${safeCode}`;
};

const hasAutoRedeemBeenAttempted = (userId, code) => {
  const key = getAutoRedeemAttemptStorageKey(userId, code);
  if (!key || typeof window === 'undefined') return false;
  try {
    return window.sessionStorage.getItem(key) === '1';
  } catch {
    return false;
  }
};

const markAutoRedeemAsAttempted = (userId, code) => {
  const key = getAutoRedeemAttemptStorageKey(userId, code);
  if (!key || typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(key, '1');
  } catch {
    // Ignore session storage issues.
  }
};

const getStaticPageTitle = (pathname) => {
  if (pathname.startsWith('/betail-register')) return null;
  if (pathname === '/mes-betails') return null;
  if (pathname.startsWith('/farm/')) return null;

  switch (pathname) {
    case '/':
      return 'FarmGestion FR';
    case '/home':
      return 'FarmGestion - Accueil';
    case '/betail-maker':
      return 'FG - Création de bétail';
    case '/community':
    case '/farms-actives':
      return 'FG - Communauté';
    case '/gce':
      return 'FG - Grand Calendrier Expéditions';
    case '/boutique':
      return 'FG - Boutique';
    case '/rules':
      return 'FG - Règlement';
    default:
      return 'FarmGestion FR';
  }
};

function AppRoutes() {
  const location = useLocation();
  const { user } = useAuth();
  const [toast, setToast] = useState(null);
  const autoRedeemInFlightRef = useRef(new Set());

  useEffect(() => {
    const staticTitle = getStaticPageTitle(location.pathname);
    if (staticTitle) {
      document.title = staticTitle;
    }
  }, [location.pathname]);

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

  useEffect(() => {
    const userId = String(user?.id || '').trim();
    if (!userId) return;

    const code = readInitialSurpriseCode();
    if (!code) return;

    if (hasAutoRedeemBeenAttempted(userId, code)) return;

    const inFlightKey = `${userId}::${code}`;
    if (autoRedeemInFlightRef.current.has(inFlightKey)) return;

    markAutoRedeemAsAttempted(userId, code);
    autoRedeemInFlightRef.current.add(inFlightKey);

    (async () => {
      try {
        const result = await redeemSurpriseCode({
          code,
          source: 'app_auto_auth',
        });

        if (result?.error) {
          setToast({
            type: 'error',
            message: 'Le code surprise n\'a pas pu etre applique pour le moment.',
            visible: true,
          });
          return;
        }

        if (!result?.success) {
          const reason = String(result?.reason || 'UNKNOWN').toUpperCase();
          if (!reason.startsWith('ALREADY_REDEEMED_')) {
            setToast({
              type: 'warning',
              message: `Code surprise non applique (${reason.toLowerCase()}).`,
              visible: true,
            });
          }
          return;
        }

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

        setToast({
          type: 'success',
          message: `Code surprise applique: ${rewardLabel}.`,
          visible: true,
        });
      } finally {
        autoRedeemInFlightRef.current.delete(inFlightKey);
      }
    })();
  }, [location.search, user?.id]);

  return (
    <>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/maintenance" element={<MaintenancePage />} />
        <Route
          path="/test"
          element={
            <PrivateRoute requireOnboarding={false} requireAdmin>
              <TestSurpriseDemoPage />
            </PrivateRoute>
          }
        />
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
        <Route path="*" element={<NotFoundPage />} />
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
