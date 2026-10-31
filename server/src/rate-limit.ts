/** A fixed one-minute window per key, small enough to keep in memory. */
export interface RateBucket {
  count: number;
  resetAt: number;
}

export const RATE_WINDOW_MS = 60_000;

/** True when this request may proceed. Rejected requests do not extend the window. */
export function takeRate(
  buckets: Map<string, RateBucket>,
  key: string,
  limit: number,
  now: number,
  windowMs = RATE_WINDOW_MS,
): boolean {
  if (!Number.isFinite(limit) || limit < 0) limit = 0;
  const bucket = buckets.get(key);
  if (!bucket || now >= bucket.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return limit > 0;
  }
  if (bucket.count >= limit) return false;
  bucket.count++;
  return true;
}

/** The client key, using X-Forwarded-For only when the deployment trusts its proxy. */
export function clientKey(remoteAddress: string | undefined, forwardedFor: string | undefined, trustProxy: boolean): string {
  if (trustProxy) {
    const first = forwardedFor?.split(',')[0]?.trim();
    if (first) return first;
  }
  return remoteAddress?.trim() || 'unknown';
}
