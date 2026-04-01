import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const CONVENTIONAL_FEAT_RE = /^feat(?:\([^)]+\))?!?:(?:\s|$)/i;
const CONVENTIONAL_FIX_RE = /^fix(?:\([^)]+\))?!?:(?:\s|$)/i;
const CONVENTIONAL_BREAKING_SUBJECT_RE = /^[a-z]+(?:\([^)]+\))?!:(?:\s|$)/i;
const BREAKING_BODY_RE = /(?:^|\n)BREAKING[ -]CHANGE:\s/i;

const runGit = (command) => {
  try {
    return execSync(command, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return '';
  }
};

const parseSemver = (value) => {
  const match = String(value || '').trim().match(/^(?:v)?(\d+)\.(\d+)\.(\d+)$/i);
  if (!match) return [0, 0, 0];
  return [Number(match[1]), Number(match[2]), Number(match[3])];
};

const getPackageVersion = () => {
  try {
    const pkgRaw = readFileSync(resolve(process.cwd(), 'package.json'), 'utf8');
    const pkg = JSON.parse(pkgRaw);
    return typeof pkg.version === 'string' ? pkg.version : '0.0.0';
  } catch {
    return '0.0.0';
  }
};

const computeMarketingVersion = () => {
  const latestTag = runGit('git describe --tags --abbrev=0');
  const baseVersion = latestTag || getPackageVersion();
  let [major, minor, patch] = parseSemver(baseVersion);

  const range = latestTag ? `${latestTag}..HEAD` : '';
  const commitsRaw = runGit(`git log --reverse --pretty=%s%x1f%b%x1e ${range}`.trim());
  const commits = commitsRaw
    ? commitsRaw
        .split('\x1e')
        .map((chunk) => chunk.trim())
        .filter(Boolean)
        .map((chunk) => {
          const [subject = '', body = ''] = chunk.split('\x1f');
          return {
            subject: subject.trim(),
            body: body.trim(),
          };
        })
    : [];

  for (const commit of commits) {
    const line = commit.subject;
    if (!line) continue;

    const isBreaking = CONVENTIONAL_BREAKING_SUBJECT_RE.test(line) || BREAKING_BODY_RE.test(commit.body);
    if (isBreaking) {
      major += 1;
      minor = 0;
      patch = 0;
      continue;
    }

    if (CONVENTIONAL_FEAT_RE.test(line)) {
      minor += 1;
      patch = 0;
      continue;
    }
    if (CONVENTIONAL_FIX_RE.test(line)) {
      patch += 1;
    }
  }

  return `${major}.${minor}.${patch}`;
};

const marketingVersion = computeMarketingVersion();
const commitHash = runGit('git rev-parse --short HEAD') || 'dev';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  define: {
    'import.meta.env.VITE_APP_MARKETING_VERSION': JSON.stringify(marketingVersion),
    'import.meta.env.VITE_APP_COMMIT_HASH': JSON.stringify(commitHash),
    'import.meta.env.VITE_APP_VERSION_LABEL': JSON.stringify(`v${marketingVersion} • ${commitHash}`),
  },
});
