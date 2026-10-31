import { describe, expect, it } from 'vitest';
import { clientKey, takeRate, type RateBucket } from './rate-limit.ts';

describe('voice rate limit', () => {
  it('allows the limit, rejects the next, then resets after a minute', () => {
    const buckets = new Map<string, RateBucket>();
    expect(takeRate(buckets, 'ip', 2, 1_000)).toBe(true);
    expect(takeRate(buckets, 'ip', 2, 1_001)).toBe(true);
    expect(takeRate(buckets, 'ip', 2, 1_002)).toBe(false);
    expect(takeRate(buckets, 'ip', 2, 61_000)).toBe(true);
    expect(buckets.get('ip')?.count).toBe(1);
  });

  it('keeps separate keys separate', () => {
    const buckets = new Map<string, RateBucket>();
    expect(takeRate(buckets, 'a', 1, 1_000)).toBe(true);
    expect(takeRate(buckets, 'b', 1, 1_000)).toBe(true);
    expect(takeRate(buckets, 'a', 1, 1_001)).toBe(false);
  });

  it('trusts X-Forwarded-For only when told to', () => {
    expect(clientKey('10.0.0.1', '203.0.113.9, 10.0.0.2', false)).toBe('10.0.0.1');
    expect(clientKey('10.0.0.1', '203.0.113.9, 10.0.0.2', true)).toBe('203.0.113.9');
    expect(clientKey(undefined, undefined, true)).toBe('unknown');
  });
});
