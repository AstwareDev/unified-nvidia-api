const RATE_LIMIT_COOLDOWN_MS = 30_000;
const SERVER_ERROR_COOLDOWN_MS = 10_000;

export interface KeyStats {
  id: string;
  requests: number;
  successes: number;
  rateLimits: number;
  errors: number;
  cooldownUntil: number | null;
}

interface PoolKey extends KeyStats {
  readonly secret: string;
}

interface KeyPool {
  keys: PoolKey[];
  cursor: number;
}

let pool: KeyPool | null = null;

function readKeysFromEnv(): string[] {
  const collected: string[] = [];

  const csv = process.env.NVIDIA_API_KEYS;
  if (csv) {
    for (const part of csv.split(",")) {
      const trimmed = part.trim();
      if (trimmed) collected.push(trimmed);
    }
  }

  for (let i = 1; i <= 64; i++) {
    const value = process.env[`NVIDIA_API_KEY_${i}`]?.trim();
    if (value) collected.push(value);
  }

  const single = process.env.NVIDIA_API_KEY?.trim();
  if (single) collected.push(single);

  return [...new Set(collected)];
}

function buildPool(): KeyPool {
  const secrets = readKeysFromEnv();
  return {
    cursor: 0,
    keys: secrets.map((secret, index) => ({
      id: `key_${index + 1}`,
      secret,
      requests: 0,
      successes: 0,
      rateLimits: 0,
      errors: 0,
      cooldownUntil: null,
    })),
  };
}

function getPool(): KeyPool {
  if (!pool) pool = buildPool();
  return pool;
}

export function resetKeyPool(): void {
  pool = null;
}

export function getKeyCount(): number {
  return getPool().keys.length;
}

export function getKeyStats(): KeyStats[] {
  const now = Date.now();
  return getPool().keys.map((k) => ({
    id: k.id,
    requests: k.requests,
    successes: k.successes,
    rateLimits: k.rateLimits,
    errors: k.errors,
    cooldownUntil:
      k.cooldownUntil !== null && k.cooldownUntil > now
        ? k.cooldownUntil
        : null,
  }));
}

export interface KeyLease {
  id: string;
  secret: string;
  markAttempt(): void;
  markSuccess(): void;
  markRateLimited(): void;
  markError(): void;
}

function lease(key: PoolKey): KeyLease {
  return {
    id: key.id,
    secret: key.secret,
    markAttempt() {
      key.requests++;
    },
    markSuccess() {
      key.successes++;
      key.cooldownUntil = null;
    },
    markRateLimited() {
      key.rateLimits++;
      key.cooldownUntil = Date.now() + RATE_LIMIT_COOLDOWN_MS;
    },
    markError() {
      key.errors++;
      key.cooldownUntil = Date.now() + SERVER_ERROR_COOLDOWN_MS;
    },
  };
}

export function leaseKeysInRotation(): KeyLease[] {
  const p = getPool();
  if (p.keys.length === 0) return [];

  const start = p.cursor % p.keys.length;
  p.cursor = (p.cursor + 1) % p.keys.length;

  const now = Date.now();
  const ordered: PoolKey[] = [];
  for (let i = 0; i < p.keys.length; i++) {
    ordered.push(p.keys[(start + i) % p.keys.length]);
  }

  const healthy = ordered.filter(
    (k) => k.cooldownUntil === null || k.cooldownUntil <= now,
  );
  const cooling = ordered
    .filter((k) => k.cooldownUntil !== null && k.cooldownUntil > now)
    .sort((a, b) => (a.cooldownUntil ?? 0) - (b.cooldownUntil ?? 0));

  return [...healthy, ...cooling].map(lease);
}
