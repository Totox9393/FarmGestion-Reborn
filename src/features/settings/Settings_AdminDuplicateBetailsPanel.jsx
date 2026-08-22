import { useState } from 'react';
import { AlertTriangle, ArrowLeft, RefreshCw, Sparkles } from 'lucide-react';
import { supabase } from '../authentification/supabaseClient';
import './Settings_AdminDuplicateBetailsPanel.css';

const normalizeAvatarUrl = (value, supabaseUrl) => {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (/^https?:\/\//i.test(raw)) return raw;
  if (raw.startsWith('/storage/')) return `${supabaseUrl}${raw}`;
  if (raw.startsWith('storage/')) return `${supabaseUrl}/${raw}`;
  return `${supabaseUrl}/storage/v1/object/public/betails/${raw.replace(/^\/+/, '')}`;
};

function DuplicateBetailCard({ betail, supabaseUrl, onSelect }) {
  const avatarUrl = normalizeAvatarUrl(betail?.avatarUrl, supabaseUrl);
  return (
    <button type="button" className="duplicate-betail-card" onClick={() => onSelect?.(betail.id)}>
      <div className="duplicate-betail-card__avatar">
        {avatarUrl ? <img src={avatarUrl} alt="" loading="lazy" /> : <span>?</span>}
      </div>
      <div>
        <strong>{betail?.name || 'Sans nom'}</strong>
        <span>#{betail?.matricule || '—'}</span>
        {betail?.visualIdentity ? <small>Reconnu : {betail.visualIdentity}</small> : null}
        {betail?.comments ? <p>{betail.comments}</p> : null}
      </div>
    </button>
  );
}

export default function Settings_AdminDuplicateBetailsPanel({ supabaseUrl, aiAvailable, onClose, onSelectBetail }) {
  const [report, setReport] = useState(null);
  const [isScanning, setIsScanning] = useState(false);
  const [error, setError] = useState('');

  const runScan = async () => {
    setIsScanning(true);
    setError('');
    try {
      const { data, error: invokeError } = await supabase.functions.invoke('detect-betail-duplicates', {
        body: { limit: 100 },
      });
      if (invokeError) throw invokeError;
      setReport(data || { groups: [], scannedCount: 0, totalCount: 0 });
    } catch {
      setError("L'analyse n'a pas pu aboutir. Vérifie le déploiement et les logs de la fonction.");
    } finally {
      setIsScanning(false);
    }
  };

  return (
    <section className="duplicate-panel">
      <header className="duplicate-panel__head">
        <button type="button" className="centrale-reset" onClick={onClose}>
          <ArrowLeft size={16} /> Retour
        </button>
        <div>
          <span><Sparkles size={16} /> Analyse IA</span>
          <h2>Détection des doublons</h2>
          <p>Compare l’identité visuelle, le nom et la description des bétails.</p>
        </div>
        <button type="button" className="duplicate-panel__scan" onClick={runScan} disabled={isScanning || !aiAvailable}>
          <RefreshCw size={17} className={isScanning ? 'is-spinning' : ''} />
          {!aiAvailable ? 'IA indisponible' : isScanning ? 'Analyse en cours…' : report ? 'Relancer' : 'Lancer l’analyse'}
        </button>
      </header>

      {error ? <p className="duplicate-panel__error"><AlertTriangle size={17} /> {error}</p> : null}

      {!report && !isScanning ? (
        <div className="duplicate-panel__empty">
          <ScanIllustration />
          <strong>Aucune analyse lancée</strong>
          <p>L’IA peut reconnaître un même personnage sur deux images différentes.</p>
        </div>
      ) : null}

      {isScanning ? (
        <div className="duplicate-panel__empty is-loading">
          <RefreshCw size={34} className="is-spinning" />
          <strong>Comparaison des bétails…</strong>
          <p>L’analyse des images peut prendre quelques secondes.</p>
        </div>
      ) : null}

      {report && !isScanning ? (
        <>
          <div className="duplicate-panel__summary">
            <strong>{report.groups?.length || 0}</strong> groupe{report.groups?.length > 1 ? 's' : ''} suspect{report.groups?.length > 1 ? 's' : ''}
            <span>{report.scannedCount || 0} bétails analysés sur {report.totalCount || report.scannedCount || 0}</span>
          </div>

          {!report.groups?.length ? (
            <p className="duplicate-panel__no-result">Aucun doublon probable détecté.</p>
          ) : (
            <div className="duplicate-groups">
              {report.groups.map((group, index) => (
                <article className="duplicate-group" key={group.id || index}>
                  <header>
                    <div>
                      <span className={`duplicate-group__score is-${group.level || 'possible'}`}>
                        {group.score}% · {group.level === 'high' ? 'Très probable' : 'À vérifier'}
                      </span>
                      <h3>{group.title || `Groupe suspect ${index + 1}`}</h3>
                    </div>
                    <p>{group.reasons?.join(' · ')}</p>
                  </header>
                  <div className="duplicate-group__items">
                    {group.betails?.map((betail) => (
                      <DuplicateBetailCard key={betail.id} betail={betail} supabaseUrl={supabaseUrl} onSelect={onSelectBetail} />
                    ))}
                  </div>
                </article>
              ))}
            </div>
          )}
        </>
      ) : null}
    </section>
  );
}

function ScanIllustration() {
  return <Sparkles size={34} aria-hidden="true" />;
}
