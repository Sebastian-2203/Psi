import { beforeEach, describe, expect, it, vi } from 'vitest';

// Pure test of the factor-reset ordering (P1-05) against a fake Auth admin API. No network.
vi.hoisted(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL ??= 'http://127.0.0.1:54321';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= 'unit-test-placeholder';
  process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'unit-test-placeholder';
  process.env.DATABASE_URL ??= 'postgresql://app_server:placeholder@127.0.0.1:1/postgres';
  process.env.APP_BASE_DOMAIN ??= 'localhost';
  process.env.SESSION_ACTIVITY_SECRET ??= 'unit-test-placeholder-secret-0123456789';
});

const fake = vi.hoisted(() => ({
  factors: [] as { id: string; status: string }[],
  listError: false,
  failIds: new Set<string>(),
  deleted: [] as string[],
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    auth: {
      admin: {
        mfa: {
          listFactors: async () =>
            fake.listError
              ? { data: null, error: { message: 'down' } }
              : { data: { factors: fake.factors }, error: null },
          deleteFactor: async ({ id }: { id: string }) => {
            if (fake.failIds.has(id)) return { data: null, error: { message: 'boom' } };
            fake.deleted.push(id);
            return { data: { id }, error: null };
          },
        },
      },
    },
  }),
}));

const { adminDeleteAllMfaFactors } = await import('@/server/db/service-role');

describe('adminDeleteAllMfaFactors (P1-05)', () => {
  beforeEach(() => {
    fake.factors = [
      { id: 'verified-1', status: 'verified' },
      { id: 'unverified-1', status: 'unverified' },
      { id: 'unverified-2', status: 'unverified' },
    ];
    fake.listError = false;
    fake.failIds = new Set();
    fake.deleted = [];
  });

  it('deletes unverified factors first and the verified one last', async () => {
    expect(await adminDeleteAllMfaFactors('user')).toEqual({ ok: true, removed: 3 });
    expect(fake.deleted).toEqual(['unverified-1', 'unverified-2', 'verified-1']);
  });

  it('never throws; reports the stage and keeps the verified factor when a delete fails', async () => {
    fake.failIds.add('unverified-2');
    expect(await adminDeleteAllMfaFactors('user')).toEqual({
      ok: false,
      removed: 1,
      stage: 'delete',
    });
    expect(fake.deleted).not.toContain('verified-1');
  });

  it('reports a listing failure with nothing removed', async () => {
    fake.listError = true;
    expect(await adminDeleteAllMfaFactors('user')).toEqual({
      ok: false,
      removed: 0,
      stage: 'list',
    });
  });
});
