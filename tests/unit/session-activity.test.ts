import { describe, expect, it } from 'vitest';
import {
  decideSessionExpiry,
  evaluateActivityCookie,
  FRESH_AUTH_GRACE_SECONDS,
  latestAuthenticationAt,
  signActivity,
  usableActivitySecret,
  verifyActivity,
} from '@/lib/session-activity';

// Fictional key and session ids (SECURITY.md §14 P1-02).
const SECRET = 'unit-test-activity-secret-0123456789abcdef';
const OTHER_SECRET = 'another-unit-test-secret-0123456789abcdef';
const SID = '0b7c8a52-3f7e-4d55-9c1e-4c1f2e9a8d01';
const OTHER_SID = '5d1f6a10-8e2b-4c3a-9f47-2b6e0c9d7a12';
const NOW = 1_800_000_000;

/** Signed in 2 h ago with password, MFA 1 h ago. */
const claims = (overrides: Record<string, unknown> = {}) => ({
  session_id: SID,
  amr: [
    { method: 'password', timestamp: NOW - 7200 },
    { method: 'totp', timestamp: NOW - 3600 },
  ],
  ...overrides,
});

describe('signed activity cookie (P1-02)', () => {
  it('round-trips and is bound to the session id', async () => {
    const value = await signActivity(SECRET, SID, NOW - 10);
    expect(value).toMatch(/^v1\.[0-9a-f-]{36}\.\d+\.[A-Za-z0-9_-]{43}$/);
    expect(await verifyActivity(SECRET, value, SID, NOW)).toBe(NOW - 10);
    expect(await verifyActivity(SECRET, value, SID.toUpperCase(), NOW)).toBe(NOW - 10);
    expect(await verifyActivity(SECRET, value, OTHER_SID, NOW)).toBeNull();
  });

  it('rejects edited timestamps, forged MACs, other keys and malformed values', async () => {
    const value = await signActivity(SECRET, SID, NOW - 1000);
    const [v, sid, , mac] = value.split('.');
    expect(await verifyActivity(SECRET, `${v}.${sid}.${NOW}.${mac}`, SID, NOW)).toBeNull();
    const flipped = `${mac!.slice(0, -1)}${mac!.endsWith('A') ? 'B' : 'A'}`;
    expect(await verifyActivity(SECRET, `${v}.${sid}.${NOW - 1000}.${flipped}`, SID, NOW)).toBeNull();
    expect(await verifyActivity(OTHER_SECRET, value, SID, NOW)).toBeNull();
    expect(await verifyActivity(null, value, SID, NOW)).toBeNull();
    for (const bad of [undefined, '', String(NOW), 'v1..1.x', `v2.${sid}.${NOW}.${mac}`, 'x'.repeat(500)]) {
      expect(await verifyActivity(SECRET, bad, SID, NOW)).toBeNull();
    }
  });

  it('rejects timestamps too far in the future', async () => {
    const future = await signActivity(SECRET, SID, NOW + 3600);
    expect(await verifyActivity(SECRET, future, SID, NOW)).toBeNull();
    const skew = await signActivity(SECRET, SID, NOW + 30);
    expect(await verifyActivity(SECRET, skew, SID, NOW)).toBe(NOW + 30);
  });

  it('requires a secret of at least 32 characters', () => {
    expect(usableActivitySecret(undefined)).toBeNull();
    expect(usableActivitySecret('short')).toBeNull();
    expect(usableActivitySecret(SECRET)).toBe(SECRET);
  });
});

describe('session expiry decision (fail closed)', () => {
  it('idle after 15 min of verified inactivity; active within it', () => {
    expect(decideSessionExpiry(claims(), NOW - 60, NOW)).toBe('active');
    expect(decideSessionExpiry(claims(), NOW - 901, NOW)).toBe('idle');
  });

  it('absolute after 12 h from the EARLIEST authentication, whatever the activity', () => {
    const old = claims({ amr: [{ method: 'password', timestamp: NOW - 43_201 }] });
    expect(decideSessionExpiry(old, NOW - 1, NOW)).toBe('absolute');
    expect(decideSessionExpiry(claims({ amr: [] }), NOW - 1, NOW)).toBe('absolute');
  });

  it('missing/invalid cookie = idle, except right after an authentication event', () => {
    expect(decideSessionExpiry(claims(), null, NOW)).toBe('idle');
    const fresh = claims({ amr: [{ method: 'password', timestamp: NOW - 5 }] });
    expect(decideSessionExpiry(fresh, null, NOW)).toBe('active');
    const graceEnd = claims({
      amr: [{ method: 'password', timestamp: NOW - FRESH_AUTH_GRACE_SECONDS - 1 }],
    });
    expect(decideSessionExpiry(graceEnd, null, NOW)).toBe('idle');
    // MFA step-up refreshes the authentication time (latest amr entry).
    const stepUp = claims({
      amr: [
        { method: 'password', timestamp: NOW - 600 },
        { method: 'totp', timestamp: NOW - 3 },
      ],
    });
    expect(latestAuthenticationAt(stepUp)).toBe(NOW - 3);
    expect(decideSessionExpiry(stepUp, null, NOW)).toBe('active');
  });

  it('evaluates cookie + claims in one step (forged cookie on an old session = idle)', async () => {
    const good = await signActivity(SECRET, SID, NOW - 30);
    expect(
      await evaluateActivityCookie({ secret: SECRET, cookieValue: good, claims: claims(), now: NOW }),
    ).toBe('active');
    expect(
      await evaluateActivityCookie({
        secret: SECRET,
        cookieValue: String(NOW), // legacy unsigned value
        claims: claims(),
        now: NOW,
      }),
    ).toBe('idle');
    expect(
      await evaluateActivityCookie({
        secret: SECRET,
        cookieValue: await signActivity(SECRET, OTHER_SID, NOW - 30),
        claims: claims(),
        now: NOW,
      }),
    ).toBe('idle');
    // No usable secret: nothing verifies, only the fresh-authentication grace remains.
    expect(
      await evaluateActivityCookie({ secret: null, cookieValue: good, claims: claims(), now: NOW }),
    ).toBe('idle');
  });
});
