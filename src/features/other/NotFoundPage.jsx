import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import miloInterogation from '../../assets/milo_interogation.png';
import './NotFoundPage.css';

function NotFoundPage() {
  useEffect(() => {
    document.title = 'FG - 404';
  }, []);

  return (
    <main className="notfound-page" role="main">
      <img src={miloInterogation} alt="Milo perdu" className="notfound-art" draggable={false} />
      <h1 className="notfound-title">404 - Cette page n&apos;existe pas</h1>
      <p className="notfound-text">
        Ici, les murs mentent comme à Grace Field. Si tu vois cette page, c&apos;est qu&apos;un faux passage t&apos;a attiré.
        Rentre vite avant que la cloche sonne.
      </p>
      <Link to="/home" className="notfound-back-link">Retour à l&apos;accueil</Link>
    </main>
  );
}

export default NotFoundPage;
