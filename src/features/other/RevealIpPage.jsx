import { useEffect, useMemo, useState } from 'react';
import miloExtra from '../../assets/milo_extra.png';

const SECRET_PATH = '/ip-fg-atelier-7x';

const extractFromTrace = (raw, key) => {
  const lines = String(raw || '').split(/\r?\n/);
  const match = lines.find((line) => line.toLowerCase().startsWith(`${key.toLowerCase()}=`));
  if (!match) return '';
  const [, value] = match.split('=');
  return String(value || '').trim();
};

const toIpv6Prefix64 = (ip) => {
  const raw = String(ip || '').trim().toLowerCase();
  if (!raw.includes(':')) return '';

  const [leftRaw, rightRaw] = raw.split('::');
  if (raw.split('::').length > 2) return '';

  const parseSide = (side) => (side ? side.split(':').filter(Boolean) : []);
  const left = parseSide(leftRaw || '');
  const right = parseSide(rightRaw || '');

  let hextets = [];
  if (raw.includes('::')) {
    const missing = 8 - (left.length + right.length);
    if (missing < 1) return '';
    hextets = [...left, ...new Array(missing).fill('0'), ...right];
  } else {
    hextets = left;
  }

  if (hextets.length !== 8) return '';
  const firstFour = hextets.slice(0, 4).map((part) => {
    const normalized = String(part || '0').replace(/^0+/, '');
    return normalized || '0';
  });
  return `${firstFour.join(':')}::/64`;
};

function RevealIpPage() {
  const [state, setState] = useState({ loading: true, ip: '', version: '', error: '' });

  useEffect(() => {
    let active = true;

    const host = String(window.location.hostname || '').toLowerCase();
    const isLocalHost = host === 'localhost' || host === '127.0.0.1' || host === '::1';

    if (isLocalHost) {
      setState({
        loading: false,
        ip: '',
        version: '',
        error: 'Cette page doit etre ouverte sur farmgestion.fr (pas en localhost). Ouvre le lien public pour lire l\'IP Cloudflare.',
      });
      return () => {
        active = false;
      };
    }

    const loadTrace = async () => {
      try {
        const response = await fetch('/cdn-cgi/trace', {
          cache: 'no-store',
          headers: {
            Accept: 'text/plain',
          },
        });

        if (!response.ok) {
          throw new Error('Impossible de recuperer /cdn-cgi/trace');
        }

        const raw = await response.text();
        const ip = extractFromTrace(raw, 'ip');
        const version = ip.includes(':') ? 'IPv6' : ip ? 'IPv4' : '';

        if (!active) return;
        setState({ loading: false, ip, version, error: ip ? '' : 'IP introuvable.' });
      } catch {
        if (!active) return;
        setState({
          loading: false,
          ip: '',
          version: '',
          error: 'Erreur de lecture de l\'IP. Verifie la regle Cloudflare et l\'exception pour /cdn-cgi/trace.',
        });
      }
    };

    void loadTrace();
    return () => {
      active = false;
    };
  }, []);

  const title = useMemo(() => {
    if (state.loading) return 'Lecture IP...';
    if (state.error) return 'Impossible de lire l\'IP';
    return 'Ton IP publique FarmGestion';
  }, [state.error, state.loading]);

  const whitelistValue = useMemo(() => {
    if (!state.ip) return '';
    if (state.version === 'IPv6') {
      return toIpv6Prefix64(state.ip) || state.ip;
    }
    return state.ip;
  }, [state.ip, state.version]);

  return (
    <main
      style={{
        minHeight: '100vh',
        margin: 0,
        display: 'grid',
        placeItems: 'center',
        padding: '24px',
        background: '#0b1220',
        color: '#eaf0ff',
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
      }}
    >
      <section
        style={{
          width: '100%',
          maxWidth: '760px',
          position: 'relative',
          border: '1px solid #2a3f6f',
          borderRadius: '14px',
          padding: '22px clamp(110px, 28vw, 190px) 22px 22px',
          background: '#121d33',
        }}
      >
        <p style={{ margin: 0, opacity: 0.8, fontSize: '13px' }}>URL privée assistance maintenance</p>
        <h1 style={{ margin: '8px 0 16px 0', fontSize: '22px', lineHeight: 1.2 }}>{title}</h1>

        {state.loading ? (
          <p style={{ margin: 0 }}>Chargement...</p>
        ) : state.error ? (
          <>
            <p style={{ margin: 0, color: '#ffb4b4' }}>{state.error}</p>
            <p style={{ margin: '10px 0 0 0', opacity: 0.9 }}>
              Lien à ouvrir: <a href={`https://farmgestion.fr${SECRET_PATH}`} style={{ color: '#a9c6ff' }}>{`https://farmgestion.fr${SECRET_PATH}`}</a>
            </p>
          </>
        ) : (
          <>
            <p style={{ margin: 0, opacity: 0.9 }}>Ton adresse pour être whitelisté :</p>
            <p
              style={{
                margin: '8px 0 0 0',
                fontSize: '24px',
                fontWeight: 700,
                wordBreak: 'break-all',
              }}
            >
              {whitelistValue}
            </p>
            <p style={{ margin: '10px 0 0 0', opacity: 0.8 }}>Type détecté: {state.version || 'Inconnu'}</p>
            {state.version === 'IPv6' ? (
              <p style={{ margin: '6px 0 0 0', opacity: 0.72, fontSize: '12px', wordBreak: 'break-all' }}>
                IP complète détectée: {state.ip}
              </p>
            ) : null}
          </>
        )}

        <p style={{ margin: '18px 0 0 0', fontSize: '12px', opacity: 0.65 }}>
          Chemin secret actif: {SECRET_PATH}
        </p>

        <img
          src={miloExtra}
          alt="Milo"
          style={{
            position: 'absolute',
            right: '16px',
            top: '50%',
            transform: 'translateY(-50%)',
            width: 'clamp(86px, 20vw, 150px)',
            height: 'auto',
            objectFit: 'contain',
            pointerEvents: 'none',
            userSelect: 'none',
          }}
        />
      </section>
    </main>
  );
}

export default RevealIpPage;