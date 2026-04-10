const DEFAULT_MARKETING_VERSION = '0.0.0';
const DEFAULT_COMMIT_HASH = 'dev';

export const getMarketingVersion = () =>
  import.meta.env.VITE_APP_MARKETING_VERSION || DEFAULT_MARKETING_VERSION;

export const getCommitHash = () =>
  import.meta.env.VITE_APP_COMMIT_HASH || DEFAULT_COMMIT_HASH;

export const getFullVersionLabel = () =>
  `v${getMarketingVersion()} • ${getCommitHash()}`;

export const getShortVersionLabel = () =>
  `v${getMarketingVersion()}`;