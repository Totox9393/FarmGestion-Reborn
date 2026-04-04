const AUDIO_SOURCE_KEY = Symbol('farmgestion.audio.source');
const AUDIO_RETRIED_KEY = Symbol('farmgestion.audio.retried');

const clampVolume = (value) => Math.min(1, Math.max(0, Number(value)));

const canRetryWithCacheBust = (source) => {
  if (typeof source !== 'string') return false;
  const normalized = source.trim();
  if (!normalized) return false;
  if (normalized.startsWith('blob:') || normalized.startsWith('data:')) return false;
  return true;
};

const buildCacheBustedSource = (source) => {
  const separator = source.includes('?') ? '&' : '?';
  const token = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  return `${source}${separator}fg_audio_retry=${token}`;
};

const retryAudioLoad = (audio) => {
  const source = audio?.[AUDIO_SOURCE_KEY];
  const alreadyRetried = Boolean(audio?.[AUDIO_RETRIED_KEY]);
  if (!audio || alreadyRetried || !canRetryWithCacheBust(source)) return false;

  audio[AUDIO_RETRIED_KEY] = true;
  try {
    audio.src = buildCacheBustedSource(source);
    audio.load();
    return true;
  } catch {
    return false;
  }
};

export const createSafeAudio = (source, { volume, preload = 'auto' } = {}) => {
  const audio = new Audio(source);
  audio[AUDIO_SOURCE_KEY] = source;
  audio[AUDIO_RETRIED_KEY] = false;

  if (preload) {
    audio.preload = preload;
  }
  if (Number.isFinite(Number(volume))) {
    audio.volume = clampVolume(volume);
  }

  return audio;
};

export const playAudioSafely = async (audio) => {
  if (!audio) return false;

  try {
    await audio.play();
    return true;
  } catch {
    if (!retryAudioLoad(audio)) return false;
    try {
      await audio.play();
      return true;
    } catch {
      return false;
    }
  }
};

export const restartAudioSafely = (audio) => {
  if (!audio) return Promise.resolve(false);
  try {
    audio.currentTime = 0;
  } catch {
    // noop
  }
  return playAudioSafely(audio);
};
