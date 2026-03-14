import { useEffect, useState } from 'react';
import Navigation_Bar from './Navigation_Bar';
import { useAuth } from '../authentification/AuthContext';
import {
  applyLocalThemePreference,
  DEFAULT_THEME,
  fetchUserThemePreference,
  getLocalThemePreference,
  saveUserThemePreference,
} from '../settings/themePreferences';

function AuthenticatedLayout({ children }) {
  const { user } = useAuth();
  const [theme, setTheme] = useState(() => getLocalThemePreference());

  useEffect(() => {
    const handleThemeChange = () => {
      setTheme(getLocalThemePreference());
    };

    window.addEventListener('farmgestion-theme-change', handleThemeChange);
    window.addEventListener('storage', handleThemeChange);
    return () => {
      window.removeEventListener('farmgestion-theme-change', handleThemeChange);
      window.removeEventListener('storage', handleThemeChange);
    };
  }, []);

  useEffect(() => {
    let isMounted = true;

    const syncThemeWithUserSettings = async () => {
      if (!user?.id) {
        if (isMounted) {
          setTheme(getLocalThemePreference());
        }
        return;
      }

      const { theme: userTheme, error } = await fetchUserThemePreference(user.id);
      if (error) {
        console.error('Impossible de charger le thème utilisateur', error);
      }

      if (userTheme) {
        applyLocalThemePreference(userTheme);
        if (isMounted) {
          setTheme(userTheme);
        }
        return;
      }

      const fallbackTheme = DEFAULT_THEME;
      applyLocalThemePreference(fallbackTheme);
      if (isMounted) {
        setTheme(fallbackTheme);
      }

      const { error: saveError } = await saveUserThemePreference({
        userId: user.id,
        theme: fallbackTheme,
      });
      if (saveError) {
        console.error('Impossible d\'initialiser le thème utilisateur', saveError);
      }
    };

    syncThemeWithUserSettings();

    return () => {
      isMounted = false;
    };
  }, [user?.id]);

  const themeClass =
    theme === 'dark'
      ? 'dark_theme'
      : theme === 'pastel'
        ? 'pastel_theme'
        : theme === 'galactic'
          ? 'galactic_theme'
          : theme === 'multicolor'
            ? 'multicolor_theme'
            : '';

  return (
    <div className={`auth-theme ${themeClass}`.trim()}>
      <Navigation_Bar />
      {children}
    </div>
  );
}

export default AuthenticatedLayout;
