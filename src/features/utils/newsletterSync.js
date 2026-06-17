const NEWSLETTER_SYNC_URL = 'https://totox.fr/farmgestion-newsletter.php';
const NEWSLETTER_SYNC_KEY = '96mTR6K6B0w6xZz6Tg3fwrSc5aXzYy4eW4Qj2fW8Qh5VVq3A3S8d8N5kP4h3qM2n';

export const syncNewsletterPreferenceToTotoxFr = ({ email, userId, enabled, source }) => {
  const normalizedEmail = String(email || '').trim();
  const normalizedUserId = String(userId || '').trim();
  const normalizedSource = source === 'register' ? 'register' : 'settings';

  if (!normalizedEmail || !normalizedUserId) {
    console.warn('Sync newsletter Totox FR ignorée: email ou userId manquant.');
    return;
  }

  const payload = new URLSearchParams({
    action: 'sync_preference',
    key: NEWSLETTER_SYNC_KEY,
    email: normalizedEmail,
    userId: normalizedUserId,
    enabled: String(Boolean(enabled)),
    source: normalizedSource,
  });

  void fetch(NEWSLETTER_SYNC_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
    },
    body: payload.toString(),
    keepalive: true,
  })
    .then((response) => {
      if (!response.ok) {
        console.warn('Sync newsletter Totox FR échouée (HTTP non OK).', {
          status: response.status,
          source: normalizedSource,
          userId: normalizedUserId,
        });
      }
    })
    .catch((error) => {
      console.warn('Sync newsletter Totox FR échouée (réseau).', {
        source: normalizedSource,
        userId: normalizedUserId,
        error,
      });
    });
};