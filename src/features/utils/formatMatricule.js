// Règle de base FarmGestion : un matricule de bétail s'affiche toujours avec un # devant (voir REGLES_DE_BASE.md).
// En base, le matricule est stocké sans le #.
export const formatMatricule = (value, fallback = '-') => {
  const raw = String(value ?? '').trim();
  if (!raw) return fallback;
  if (raw.startsWith('#')) return raw;
  // Valeurs de remplissage ("—", "---", "-") : pas de # devant.
  if (!/[0-9a-z]/i.test(raw)) return raw;
  return `#${raw}`;
};

export default formatMatricule;
