export const SECRET_PATTERNS: RegExp[] = [
  /sk-[A-Za-z0-9]{20,}/,
  /AKIA[0-9A-Z]{16}/,
  /ghp_[A-Za-z0-9]{36}/,
  /ghs_[A-Za-z0-9]{36}/,
];

export const SECRET_ENV_KEYS = [
  'API_KEY',
  'SECRET',
  'PASSWORD',
  'TOKEN',
  'GITHUB_PERSONAL_ACCESS_TOKEN',
  'GITHUB_TOKEN',
];

export const RISKY_DESCRIPTION_PATTERNS: RegExp[] = [
  /exfiltrate/i,
  /delete\s+all/i,
  /ignore\s+previous\s+instructions/i,
  /\u200b/,
  /\beval\b/i,
];

export const SHELL_INJECTION_PATTERNS: RegExp[] = [
  /&&/,
  /\|\|/,
  /;\s/,
  /`[^`]+`/,
  /\$\([^)]+\)/,
  /\.\.\//,
];
