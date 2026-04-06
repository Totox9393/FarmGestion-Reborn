// Compte a rebours conserve dans le code (non affiche visuellement)
const COUNTDOWN_HOURS = 72;
const STORAGE_KEY = "farmgestion_mystery_countdown_start";
const CYCLE_MS = COUNTDOWN_HOURS * 60 * 60 * 1000;

const daysEl = document.getElementById("days");
const hoursEl = document.getElementById("hours");
const minutesEl = document.getElementById("minutes");
const secondsEl = document.getElementById("seconds");
const launchDateLabelEl = document.getElementById("launchDateLabel");
const statusMessageEl = document.getElementById("statusMessage");

const bgAudio = document.getElementById("bgAudio");
const soundToggle = document.getElementById("soundToggle");

let autoPlayRetryTimer = null;
let audioUnavailable = false;
let lastAudioErrorName = "";
let activePlayer = bgAudio;

const parseStart = () => {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (!stored) return null;
  const asNumber = Number(stored);
  return Number.isFinite(asNumber) ? asNumber : null;
};

const getCycleStart = () => {
  const now = Date.now();
  const storedStart = parseStart();
  if (!storedStart) {
    localStorage.setItem(STORAGE_KEY, String(now));
    return now;
  }

  const elapsed = now - storedStart;
  if (elapsed >= CYCLE_MS) {
    const newStart = now - (elapsed % CYCLE_MS);
    localStorage.setItem(STORAGE_KEY, String(newStart));
    return newStart;
  }
  return storedStart;
};

const setCountdownValues = ({ days, hours, minutes, seconds }) => {
  daysEl.textContent = String(days).padStart(2, "0");
  hoursEl.textContent = String(hours).padStart(2, "0");
  minutesEl.textContent = String(minutes).padStart(2, "0");
  secondsEl.textContent = String(seconds).padStart(2, "0");
};

const isPlayerRunning = () => Boolean(activePlayer && !activePlayer.paused);

const stopAnyPlayer = () => {
  if (activePlayer) activePlayer.pause();
  if (bgAudio && bgAudio !== activePlayer) bgAudio.pause();
};

const tryPlayElement = async (audioEl) => {
  if (!audioEl) return { ok: false, error: new Error("audio_not_found") };
  try {
    await audioEl.play();
    return { ok: true, error: null };
  } catch (error) {
    return { ok: false, error };
  }
};

const configureAudio = (audioEl) => {
  audioEl.volume = 0.35;
  audioEl.loop = true;
  audioEl.muted = false;
  audioEl.preload = "auto";
};

const startAudioPlayback = async ({ forceReload = false } = {}) => {
  if (!bgAudio) return false;

  configureAudio(bgAudio);
  if (forceReload) bgAudio.load();

  let result = await tryPlayElement(bgAudio);
  if (result.ok) {
    activePlayer = bgAudio;
    audioUnavailable = false;
    lastAudioErrorName = "";
    return true;
  }

  // Fallback: recreate a fresh Audio instance in case browser/decoder state is stale.
  const fallbackPlayer = new Audio("./attentefg.wav");
  configureAudio(fallbackPlayer);
  result = await tryPlayElement(fallbackPlayer);
  if (result.ok) {
    activePlayer = fallbackPlayer;
    audioUnavailable = false;
    lastAudioErrorName = "";
    return true;
  }

  audioUnavailable = true;
  lastAudioErrorName = String(result.error?.name || "play_error");
  return false;
};

const refreshHiddenCountdown = () => {
  const start = getCycleStart();
  const now = Date.now();
  const elapsed = now - start;
  const msLeft = CYCLE_MS - (elapsed % CYCLE_MS);
  const totalSeconds = Math.floor(msLeft / 1000);

  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  setCountdownValues({ days, hours, minutes, seconds });

  const phase = Math.floor((totalSeconds % 18) / 6);
  const phaseText = phase === 0 ? "Analyse" : phase === 1 ? "Synchronisation" : "Verification";
  statusMessageEl.textContent = `${phaseText} en cours`;
  launchDateLabelEl.textContent = "Ouverture imminente";
};

const updateSoundButtonLabel = () => {
  if (!soundToggle) return;
  soundToggle.textContent = isPlayerRunning() ? "Couper le son" : "Activer le son";
};

const scheduleAutoPlayRetries = () => {
  if (autoPlayRetryTimer) return;
  autoPlayRetryTimer = setInterval(async () => {
    if (isPlayerRunning()) {
      clearInterval(autoPlayRetryTimer);
      autoPlayRetryTimer = null;
      return;
    }
    const ok = await startAudioPlayback();
    updateSoundButtonLabel();
    if (ok && autoPlayRetryTimer) {
      clearInterval(autoPlayRetryTimer);
      autoPlayRetryTimer = null;
    }
  }, 2200);
};

const setupAudioControls = () => {
  if (!bgAudio || !soundToggle) return;

  updateSoundButtonLabel();

  soundToggle.addEventListener("click", async () => {
    if (isPlayerRunning()) {
      stopAnyPlayer();
      updateSoundButtonLabel();
      return;
    }
    await startAudioPlayback({ forceReload: true });
    updateSoundButtonLabel();
  });

  ["pointerdown", "touchstart", "keydown", "click"].forEach((eventName) => {
    document.addEventListener(eventName, async () => {
      if (isPlayerRunning()) return;
      await startAudioPlayback();
      updateSoundButtonLabel();
    });
  });

  document.addEventListener("visibilitychange", async () => {
    if (document.visibilityState !== "visible") return;
    if (isPlayerRunning()) return;
    await startAudioPlayback();
    updateSoundButtonLabel();
  });

  window.addEventListener("focus", async () => {
    if (isPlayerRunning()) return;
    await startAudioPlayback();
    updateSoundButtonLabel();
  });

  bgAudio.addEventListener("error", () => {
    audioUnavailable = true;
    lastAudioErrorName = "media_error";
  });
};

refreshHiddenCountdown();
setInterval(refreshHiddenCountdown, 1000);
setupAudioControls();
void startAudioPlayback();
scheduleAutoPlayRetries();
