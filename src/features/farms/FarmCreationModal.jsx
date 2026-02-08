import './FarmCreationModal.css';
import './FarmCreationModal.override.css';

function FarmCreationModal({ isOpen, children }) {
  if (!isOpen) return null;
  return (
    <div className="farm-modal-overlay" role="presentation">
      <div className="farm-modal" role="dialog" aria-modal="true">
        {children}
      </div>
    </div>
  );
}

export default FarmCreationModal;
