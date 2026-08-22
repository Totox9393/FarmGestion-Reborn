import { useMemo, useState } from 'react';
import defaultProfileUser from '../../assets/defaut_profile_user.png';

const SUPABASE_URL = String(import.meta.env.VITE_SUPABASE_URL || '').replace(/\/$/, '');

const buildProfileAvatarCandidates = (value) => {
  const raw = String(value || '').trim();
  if (!raw) return [];

  const candidates = [raw];
  if (!SUPABASE_URL) return candidates;

  if (raw.startsWith('/storage/v1/object/public/')) {
    candidates.push(`${SUPABASE_URL}${raw}`);
  } else if (raw.startsWith('storage/v1/object/public/')) {
    candidates.push(`${SUPABASE_URL}/${raw}`);
  } else if (raw.startsWith('/')) {
    candidates.push(`${SUPABASE_URL}${raw}`, `${SUPABASE_URL}/${raw.replace(/^\/+/, '')}`);
  } else if (!/^https?:\/\//i.test(raw)) {
    if (raw.includes('/')) {
      candidates.push(`${SUPABASE_URL}/storage/v1/object/public/${raw.replace(/^\/+/, '')}`);
    } else {
      candidates.push(
        `${SUPABASE_URL}/storage/v1/object/public/avatars/${raw}`,
        `${SUPABASE_URL}/storage/v1/object/public/ressources/${raw}`,
      );
    }
  }

  // Les anciennes URL signées peuvent expirer alors que l'objet est public.
  const avatarPathMatch = raw.match(/\/storage\/v1\/object\/(?:public|sign|authenticated)\/avatars\/([^?#]+)/i);
  if (avatarPathMatch?.[1]) {
    candidates.push(`${SUPABASE_URL}/storage/v1/object/public/avatars/${avatarPathMatch[1]}`);
  }

  return Array.from(new Set(candidates));
};

export default function ProfileAvatarImage({ avatarUrl, alt = '', onError, ...imageProps }) {
  const source = String(avatarUrl || '').trim();
  const candidates = useMemo(() => buildProfileAvatarCandidates(source), [source]);
  const [failure, setFailure] = useState({ source, index: 0 });
  const candidateIndex = failure.source === source ? failure.index : 0;
  const src = candidates[candidateIndex] || defaultProfileUser;

  return (
    <img
      {...imageProps}
      src={src}
      alt={alt}
      onError={(event) => {
        if (candidateIndex < candidates.length - 1) {
          setFailure({ source, index: candidateIndex + 1 });
          return;
        }
        if (src !== defaultProfileUser) {
          setFailure({ source, index: candidates.length });
          return;
        }
        onError?.(event);
      }}
    />
  );
}
