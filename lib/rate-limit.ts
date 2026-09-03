/**
 * Spend guards for the two endpoints that cost money.
 *
 * Both routes are public and unauthenticated, and `/api/check` accepts text
 * from any origin so the browser extension can reach it. Without a limit,
 * anyone who finds the URL can run the project's Gemini spend down - and that
 * key is shared with another live deployment, so the blast radius is not
 * confined to this app.
 *
 * This is in-memory and therefore per-instance: a serverless platform can run
 * several, so the real ceiling is the limit times the instance count. That is
 * accepted. The point is to bound accidental and casual abuse, not to survive
 * a determined attacker - for that the answer is an API key, not a counter.
 */

interface Bucket {
  hits: number[];
  day: string;
  dayCount: number;
}

const buckets = new Map<string, Bucket>();

/** Callers seen in the last hour are kept; the map is swept on write. */
const SWEEP_AFTER_MS = 60 * 60 * 1000;
let lastSweep = 0;

export interface Limit {
  /** Requests allowed per caller inside `windowMs`. */
  perWindow: number;
  windowMs: number;
  /** Hard per-caller ceiling for one UTC day. */
  perDay: number;
}

/** A full corpus run is ~75 model calls, so it is held much tighter. */
export const CORPUS_LIMIT: Limit = { perWindow: 2, windowMs: 10 * 60 * 1000, perDay: 12 };
/** A single document is a fraction of that and is the path we want people using. */
export const DOCUMENT_LIMIT: Limit = { perWindow: 6, windowMs: 5 * 60 * 1000, perDay: 60 };

/**
 * Identifies the caller.
 *
 * Only trusts `x-forwarded-for` when the platform actually set it. Falling back
 * to a constant would bucket every local request together and make the limiter
 * fire during development for the wrong reason - a bug worth not repeating.
 */
export function callerKey(request: Request): string | null {
  const fwd = request.headers.get('x-forwarded-for');
  if (fwd) return fwd.split(',')[0].trim();
  const real = request.headers.get('x-real-ip');
  if (real) return real.trim();
  return null; // not behind a proxy: local dev, so do not limit
}

export interface Decision {
  ok: boolean;
  /** Seconds to wait, when rejected. */
  retryAfter?: number;
  reason?: string;
}

export function check(request: Request, limit: Limit): Decision {
  const key = callerKey(request);
  if (!key) return { ok: true };

  const now = Date.now();
  const today = new Date(now).toISOString().slice(0, 10);

  if (now - lastSweep > SWEEP_AFTER_MS) {
    for (const [k, b] of buckets) {
      if (!b.hits.some((t) => now - t < SWEEP_AFTER_MS)) buckets.delete(k);
    }
    lastSweep = now;
  }

  let bucket = buckets.get(key);
  if (!bucket) {
    bucket = { hits: [], day: today, dayCount: 0 };
    buckets.set(key, bucket);
  }
  if (bucket.day !== today) {
    bucket.day = today;
    bucket.dayCount = 0;
  }

  bucket.hits = bucket.hits.filter((t) => now - t < limit.windowMs);

  if (bucket.dayCount >= limit.perDay) {
    return {
      ok: false,
      retryAfter: 3600,
      reason: `Daily limit reached for this address (${limit.perDay} runs). It resets at midnight UTC.`,
    };
  }
  if (bucket.hits.length >= limit.perWindow) {
    const oldest = Math.min(...bucket.hits);
    const retryAfter = Math.max(1, Math.ceil((limit.windowMs - (now - oldest)) / 1000));
    return {
      ok: false,
      retryAfter,
      reason: `Too many runs from this address. Each one costs real model spend, so it is capped at ${limit.perWindow} per ${Math.round(limit.windowMs / 60000)} minutes.`,
    };
  }

  bucket.hits.push(now);
  bucket.dayCount += 1;
  return { ok: true };
}

/** 429 with the headers a well-behaved client expects. */
export function tooMany(decision: Decision, extraHeaders: Record<string, string> = {}): Response {
  return Response.json(
    { error: decision.reason ?? 'Rate limited.' },
    {
      status: 429,
      headers: { 'Retry-After': String(decision.retryAfter ?? 60), ...extraHeaders },
    },
  );
}
