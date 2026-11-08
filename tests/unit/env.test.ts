import { describe, expect, it, vi } from 'vitest';

// src/server/env.ts validates process.env at import; give it placeholders first.
vi.hoisted(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL ??= 'http://127.0.0.1:54321';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= 'unit-test-placeholder';
  process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'unit-test-placeholder';
  process.env.DATABASE_URL ??= 'postgresql://app_server:placeholder@127.0.0.1:1/postgres';
  process.env.APP_BASE_DOMAIN ??= 'localhost';
  process.env.SESSION_ACTIVITY_SECRET ??= 'unit-test-placeholder-secret-0123456789';
});

import { parseServerEnv, TRUSTED_PROXY_REQUIRED_MESSAGE } from '@/server/env';

// Fictional placeholders only.
const base = {
  NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321',
  NEXT_PUBLIC_SUPABASE_ANON_KEY: 'unit-test-placeholder',
  SUPABASE_SERVICE_ROLE_KEY: 'unit-test-secret-placeholder',
  DATABASE_URL: 'postgresql://app_server:placeholder@127.0.0.1:1/postgres',
  APP_BASE_DOMAIN: 'localhost',
  SESSION_ACTIVITY_SECRET: 'unit-test-placeholder-secret-0123456789',
};

describe('P1-21: TRUSTED_PROXY is required in production off Vercel', () => {
  it('fails startup validation with a clear message when unset', () => {
    expect(() => parseServerEnv({ ...base, NODE_ENV: 'production' })).toThrow(
      TRUSTED_PROXY_REQUIRED_MESSAGE,
    );
    expect(() => parseServerEnv({ ...base, NODE_ENV: 'production' })).toThrow(/TRUSTED_PROXY/);
  });

  it('never prints secret values in the error', () => {
    try {
      parseServerEnv({ ...base, NODE_ENV: 'production' });
      expect.unreachable();
    } catch (error) {
      expect(String(error)).not.toContain('unit-test-secret-placeholder');
    }
  });

  it('accepts an explicit mode in production', () => {
    for (const mode of ['vercel', 'xff', 'none'] as const) {
      expect(
        parseServerEnv({ ...base, NODE_ENV: 'production', TRUSTED_PROXY: mode }).TRUSTED_PROXY,
      ).toBe(mode);
    }
  });

  it('on Vercel, unset is allowed (defaults to the platform header)', () => {
    expect(() => parseServerEnv({ ...base, NODE_ENV: 'production', VERCEL: '1' })).not.toThrow();
  });

  it('is not enforced during `next build` nor in development/test', () => {
    expect(() =>
      parseServerEnv({ ...base, NODE_ENV: 'production', NEXT_PHASE: 'phase-production-build' }),
    ).not.toThrow();
    expect(() => parseServerEnv({ ...base, NODE_ENV: 'development' })).not.toThrow();
    expect(() => parseServerEnv({ ...base, NODE_ENV: 'test' })).not.toThrow();
  });
});
