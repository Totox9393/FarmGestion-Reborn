import { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { X } from 'lucide-react';
import './BetailCreationHelp.css';

export default function BetailCreationHelp({ onClose }) {
  const dialogRef = useRef(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    dialog.showModal();
    return () => dialog.close();
  }, []);

  return (
    <dialog
      ref={dialogRef}
      className="betail-creation-help"
      aria-labelledby="betail-creation-help-title"
      onCancel={onClose}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="betail-creation-help__content">
        <header className="betail-creation-help__header">
          <h2 id="betail-creation-help-title">Avant de créer un bétail</h2>
          <button type="button" className="betail-creation-help__close" aria-label="Fermer l’aide" onClick={onClose}>
            <X size={20} aria-hidden="true" />
          </button>
        </header>
        <dl className="betail-creation-help__facts">
          <div>
            <dt>Une création pour les autres</dt>
            <dd>Une fois enregistré, ton bétail rejoint le registre. Les autres joueurs peuvent alors l’acheter.</dd>
          </div>
          <div>
            <dt>Pour ta propre ferme</dt>
            <dd>Tu ne peux pas acheter ton propre bétail. Pour peupler ta ferme, choisis les créations des autres joueurs.</dd>
          </div>
          <div>
            <dt>Un contenu adapté</dt>
            <dd>Photo, nom et description doivent respecter le règlement : pas de contenu offensant, violent ou sexuel.</dd>
          </div>
        </dl>
        <footer className="betail-creation-help__footer">
          <p>En enregistrant ton bétail, tu acceptes le règlement de FarmGestion.</p>
          <Link to="/rules" onClick={onClose}>Lire le règlement</Link>
        </footer>
      </div>
    </dialog>
  );
}
