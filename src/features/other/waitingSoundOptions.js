const waitingSoundModules = import.meta.glob('../../assets/sounds/waiting*.wav', {
  eager: true,
  import: 'default',
});

const toLabel = (fileName) => {
  const normalized = String(fileName || '')
    .replace(/^waiting[_-]?/i, '')
    .replace(/\.wav$/i, '')
    .replace(/[_-]+/g, ' ')
    .trim();

  if (!normalized) return 'Son waiting';
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
};

const entries = Object.entries(waitingSoundModules)
  .map(([path, url]) => {
    const fileName = String(path).split('/').pop() || '';
    return {
      key: fileName,
      label: toLabel(fileName),
      url: String(url || ''),
    };
  })
  .filter((entry) => entry.key && entry.url)
  .sort((left, right) => left.label.localeCompare(right.label, 'fr'));

export const WAITING_SOUND_OPTIONS = [
  { key: '', label: 'Aucun son', url: '' },
  ...entries,
];

export const isWaitingSoundKey = (value) =>
  WAITING_SOUND_OPTIONS.some((option) => option.key === String(value || '').trim());

export const resolveWaitingSoundUrl = (value) => {
  const safeValue = String(value || '').trim();
  if (!safeValue) return '';

  const match = WAITING_SOUND_OPTIONS.find((option) => option.key === safeValue);
  if (match?.url) return match.url;

  return safeValue;
};
