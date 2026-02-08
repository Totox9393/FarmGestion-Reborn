import { useEffect, useState } from 'react';
import Navigation_Bar from './Navigation_Bar';

function AuthenticatedLayout({ children }) {
  const [theme, setTheme] = useState(() => localStorage.getItem('farmgestion_theme') || 'dark');

  useEffect(() => {
    const handleThemeChange = () => {
      setTheme(localStorage.getItem('farmgestion_theme') || 'dark');
    };

    window.addEventListener('farmgestion-theme-change', handleThemeChange);
    window.addEventListener('storage', handleThemeChange);
    return () => {
      window.removeEventListener('farmgestion-theme-change', handleThemeChange);
      window.removeEventListener('storage', handleThemeChange);
    };
  }, []);

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
