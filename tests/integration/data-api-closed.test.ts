import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { PERSONAS } from '../fixtures/personas';
import { detectLocalStack, signIn, skipMessage } from '../fixtures/local-stack';

/**
 * ADR-019 Option A deploy/CI check: the Data API must not serve domain tables to persona JWTs
 * (SECURITY.md §13.1 "Direct API abuse"). With `[api] enabled = false` the gateway has no
 * PostgREST upstream, so every REST/GraphQL path must fail and never return rows.
 */

describe('config: Data API disabled for domain schemas', () => {
  const config = readFileSync('supabase/config.toml', 'utf8');
  const apiSection = config.split(/^\[api\]$/m)[1]?.split(/^\[/m)[0] ?? '';

  it('[api] enabled = false, no exposed schemas, no auto-expose', () => {
    expect(apiSection).toMatch(/^enabled = false$/m);
    expect(apiSection).toMatch(/^schemas = \[\]$/m);
    expect(apiSection).toMatch(/^auto_expose_new_tables = false$/m);
  });

  it('realtime is disabled', () => {
    const realtime = config.split(/^\[realtime\]$/m)[1]?.split(/^\[/m)[0] ?? '';
    expect(realtime).toMatch(/^enabled = false$/m);
  });
});

const stack = await detectLocalStack();
skipMessage('data-api-closed', stack);

describe.skipIf(!stack.available)('Data API rejects persona JWTs (live stack)', () => {
  let token: string;
  const base = () => process.env.NEXT_PUBLIC_SUPABASE_URL as string;
  const headers = () => ({
    apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string,
    authorization: `Bearer ${token}`,
  });

  beforeAll(async () => {
    token = await signIn(PERSONAS.ownerA, 'aal2');
  });

  for (const path of [
    '/rest/v1/organizations?select=*',
    '/rest/v1/memberships?select=*',
    '/rest/v1/audit_logs?select=*',
    '/rest/v1/rpc/my_capacities',
    '/rest/v1/',
  ]) {
    it(`GET ${path} is unavailable`, async () => {
      const res = await fetch(`${base()}${path}`, { headers: headers() });
      const body = await res.text();
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(body).not.toContain('demo-a');
      expect(body).not.toContain('"slug"');
    });
  }

  it('POST /graphql/v1 is unavailable', async () => {
    const res = await fetch(`${base()}/graphql/v1`, {
      method: 'POST',
      headers: { ...headers(), 'content-type': 'application/json' },
      body: JSON.stringify({ query: '{ organizationsCollection { edges { node { slug } } } }' }),
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(await res.text()).not.toContain('demo-a');
  });

  it('Auth stays available (sign-in path used by the app)', async () => {
    const res = await fetch(`${base()}/auth/v1/user`, { headers: headers() });
    expect(res.status).toBe(200);
  });
});
