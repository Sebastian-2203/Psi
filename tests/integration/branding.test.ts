import { randomUUID } from 'node:crypto';
import { deflateSync, crc32 } from 'node:zlib';
import type postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ORGS, PERSONAS, type Persona } from '../fixtures/personas';
import { adminSql, detectLocalStack, signIn, skipMessage } from '../fixtures/local-stack';

/**
 * Workstream 1.7 — organization branding against the REAL local stack: use cases with real
 * AuthzContexts, RLS, audit rows, and the Storage API with real persona JWTs (no user write
 * path into the bucket: P1-16; takedown + superseded cleanup + upload limit: P1-18).
 */
const stack = await detectLocalStack();
skipMessage('branding', stack);

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

/** Tiny valid FICTIONAL PNG; `seed` varies the pixels so each test gets its own object name. */
function png(seed: number, text?: string): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(32, 0);
  ihdr.writeUInt32BE(32, 4);
  ihdr.set([8, 2, 0, 0, 0], 8);
  const raw = Buffer.alloc(32 * (1 + 32 * 3), seed);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    ...(text ? [chunk('tEXt', Buffer.from(text))] : []),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

describe.skipIf(!stack.available)('organization branding (workstream 1.7)', () => {
  let admin: postgres.Sql;
  let authz: typeof import('@/server/authz');
  let service: typeof import('@/modules/branding/server/service');
  let queries: typeof import('@/modules/branding/server/queries');
  let logo: typeof import('@/modules/branding/server/logo');
  let server: typeof import('@/server/db/server');
  let pool: typeof import('@/server/db/pool');
  let verify: (typeof import('@/server/auth/claims'))['verifyAccessToken'];
  let original: Record<string, unknown>;

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL as string;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string;

  async function contextFor(persona: Persona, aal: 'aal1' | 'aal2' = 'aal2') {
    const token = await signIn(persona, aal);
    const claims = await verify(token);
    if (!claims) throw new Error('verification failed');
    const outcome = await authz.resolveAuthzContext(claims, {
      requestId: randomUUID(),
      locale: 'es',
    });
    return { token, claims, outcome };
  }

  async function currentVersion(): Promise<string> {
    const [row] = await admin<{ v: string }[]>`
      select updated_at::text as v from public.organization_branding where organization_id = ${ORGS.A.id}`;
    return row?.v ?? '';
  }

  const input = (version: string, patch: Record<string, string> = {}) => ({
    displayName: 'Psicóloga Daniela Ortega',
    brandColor: '#d94a43',
    functionalColor: '#a73c37',
    secondaryColor: null,
    expectedUpdatedAt: version,
    ...patch,
  });

  beforeAll(async () => {
    admin = adminSql();
    authz = await import('@/server/authz');
    service = await import('@/modules/branding/server/service');
    queries = await import('@/modules/branding/server/queries');
    logo = await import('@/modules/branding/server/logo');
    server = await import('@/server/db/server');
    pool = await import('@/server/db/pool');
    verify = (await import('@/server/auth/claims')).verifyAccessToken;
    const [row] =
      await admin`select * from public.organization_branding where organization_id = ${ORGS.A.id}`;
    original = { ...row };
    await admin`truncate public.rate_limit_counters`;
  });

  afterAll(async () => {
    // Restore the seeded fictional brand of org A.
    await admin`
      update public.organization_branding set
        display_name = ${original.display_name as string},
        brand_color = ${original.brand_color as string},
        functional_color = ${original.functional_color as string | null},
        secondary_color = ${original.secondary_color as string | null},
        logo_path = null
      where organization_id = ${ORGS.A.id}`;
    await admin?.end();
    await pool?.closeSql();
  });

  it('the owner updates branding; an audit row lists the changed field NAMES only', async () => {
    const { outcome } = await contextFor(PERSONAS.ownerA);
    if (!outcome.ok) throw new Error('no context');
    const result = await service.saveBranding(
      outcome.data,
      input(await currentVersion(), {
        displayName: 'Consultorio Integración (ficticio)',
        secondaryColor: '#e8c46b',
      }) as never,
    );
    expect(result.ok).toBe(true);
    const [row] = await admin<{ display_name: string; secondary_color: string }[]>`
      select display_name, secondary_color from public.organization_branding where organization_id = ${ORGS.A.id}`;
    expect(row).toEqual({
      display_name: 'Consultorio Integración (ficticio)',
      secondary_color: '#e8c46b',
    });
    const [audit] = await admin<
      { metadata: { changed_fields: string[] }; actor_profile_id: string }[]
    >`
      select metadata, actor_profile_id from public.audit_logs
      where event_type = 'organization_branding.updated' and organization_id = ${ORGS.A.id}
      order by occurred_at desc limit 1`;
    expect(audit?.actor_profile_id).toBe(PERSONAS.ownerA.id);
    expect([...(audit?.metadata.changed_fields ?? [])].sort()).toEqual([
      'display_name',
      'secondary_color',
    ]);
    expect(JSON.stringify(audit?.metadata)).not.toContain('Integración');
  });

  it('a stale version token is a CONFLICT (optimistic concurrency)', async () => {
    const { outcome } = await contextFor(PERSONAS.ownerA);
    if (!outcome.ok) throw new Error('no context');
    const stale = await service.saveBranding(
      outcome.data,
      input('2020-01-01 00:00:00+00') as never,
    );
    expect(stale.ok).toBe(false);
    if (!stale.ok) expect(stale.error.code).toBe('CONFLICT');
  });

  it('rejects a low-contrast functional colour with the nearest passing shade; nothing is stored', async () => {
    const { outcome } = await contextFor(PERSONAS.ownerA);
    if (!outcome.ok) throw new Error('no context');
    const before = await currentVersion();
    const result = await service.saveBranding(
      outcome.data,
      input(before, { functionalColor: '#ffcc00' }) as never,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('VALIDATION_FAILED');
      expect(result.error.fieldErrors?.functionalColor?.[0]).toMatch(
        /^contrast:#[0-9a-f]{6}:\d+\.\d{2}$/,
      );
    }
    expect(await currentVersion()).toBe(before);
  });

  it('a psychologist (not owner) cannot update branding; nothing changes', async () => {
    const { outcome } = await contextFor(PERSONAS.psyA);
    if (!outcome.ok) throw new Error('no context');
    const before = await currentVersion();
    const result = await service.saveBranding(
      outcome.data,
      input(before, { displayName: 'Intento no autorizado' }) as never,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('FORBIDDEN');
    expect(await currentVersion()).toBe(before);
  });

  it('an owner at aal1 is denied (MFA required)', async () => {
    const { outcome } = await contextFor(PERSONAS.ownerA, 'aal1');
    if (!outcome.ok) {
      expect(['MFA_REQUIRED', 'FORBIDDEN']).toContain(outcome.error.code);
      return;
    }
    const result = await service.saveBranding(outcome.data, input(await currentVersion()) as never);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('MFA_REQUIRED');
  });

  it("another organization's owner cannot touch org A (RLS, even with a hand-written UPDATE)", async () => {
    const { claims } = await contextFor(PERSONAS.ownerB);
    const before = await currentVersion();
    const rows = await server.withUserTransaction(
      claims,
      (tx) => tx`
        update public.organization_branding set display_name = 'Hostil'
        where organization_id = ${ORGS.A.id} returning organization_id`,
    );
    expect(rows).toHaveLength(0);
    expect(await currentVersion()).toBe(before);
    const visible = await server.withUserTransaction(
      claims,
      (tx) => tx`select organization_id from public.organization_branding`,
    );
    expect(visible.map((r) => r.organization_id)).toEqual([ORGS.B.id]);
  });

  it('logo upload: sanitised bytes land in the public bucket, readable without auth, audited', async () => {
    const { outcome } = await contextFor(PERSONAS.ownerA);
    if (!outcome.ok) throw new Error('no context');
    const source = png(11, 'GPS-SECRET');
    const saved = await service.saveLogo(outcome.data, source);
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    expect(saved.data.logoUrl).toMatch(
      new RegExp(`/storage/v1/object/public/branding/${ORGS.A.id}/logo-[0-9a-f]{32}\\.png$`),
    );
    const res = await fetch(saved.data.logoUrl as string); // no Authorization header
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    const body = Buffer.from(await res.arrayBuffer());
    expect(body.toString('latin1')).not.toContain('GPS-SECRET');
    expect(body.equals(logo.sanitizeLogo(source).bytes)).toBe(true);
    const [audit] = await admin<{ metadata: Record<string, unknown> }[]>`
      select metadata from public.audit_logs
      where event_type = 'organization_branding.logo_uploaded' and organization_id = ${ORGS.A.id}
      order by occurred_at desc limit 1`;
    expect(audit?.metadata).toMatchObject({ media_type: 'image/png' });
    // Uploading the same bytes again is idempotent (content-addressed name).
    expect((await service.saveLogo(outcome.data, source)).ok).toBe(true);
    // The pre-auth path (what layouts use) returns it.
    queries.invalidateTenantBranding(ORGS.A.id);
    const tenancy = await import('@/server/tenancy');
    const pub = await tenancy.getPublicBranding(ORGS.A.id);
    expect(queries.toTenantBrand(pub as never).logoUrl).toBe(saved.data.logoUrl);
    // P1-18: publishing a new logo deletes the superseded object from the public bucket.
    const next = await service.saveLogo(outcome.data, png(13));
    expect(next.ok).toBe(true);
    expect((await fetch(saved.data.logoUrl as string)).status).not.toBe(200);
    const folder = await admin<{ name: string }[]>`
      select name from storage.objects where bucket_id = 'branding' and name like ${`${ORGS.A.id}/%`}`;
    expect(folder.map((r) => r.name)).toEqual([
      (next.ok ? next.data.logoUrl : '')?.split('/branding/')[1],
    ]);
  });

  it('P1-16: a pre-existing object under the content-addressed name is overwritten, never trusted', async () => {
    const { outcome } = await contextFor(PERSONAS.ownerA);
    if (!outcome.ok) throw new Error('no context');
    const source = png(14);
    const path = logo.logoObjectPath(ORGS.A.id, logo.sanitizeLogo(source));
    // Simulates an object planted before migration 20261108160000 (HTML labelled as PNG).
    const plant = await fetch(`${supabaseUrl}/storage/v1/object/branding/${path}`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY as string}`,
        apikey: process.env.SUPABASE_SERVICE_ROLE_KEY as string,
        'content-type': 'image/png',
      },
      body: '<html><script>alert(1)</script></html>',
    });
    expect(plant.status).toBe(200);
    const saved = await service.saveLogo(outcome.data, source);
    expect(saved.ok).toBe(true);
    const body = Buffer.from(
      await (await fetch(saved.ok ? (saved.data.logoUrl as string) : '')).arrayBuffer(),
    );
    expect(body.toString('latin1')).not.toContain('<script>');
    expect(body.equals(logo.sanitizeLogo(source).bytes)).toBe(true);
  });

  it('P1-18: uploads are rate limited per owner (fail closed, before touching storage)', async () => {
    const { outcome, claims } = await contextFor(PERSONAS.ownerA);
    if (!outcome.ok) throw new Error('no context');
    const { limit, windowSeconds } = service.LOGO_UPLOAD_LIMIT;
    await admin`
      insert into public.rate_limit_counters (bucket_key, window_start, count)
      values (extensions.digest(${`branding.logo_upload:${claims.sub}`}, 'sha256'),
              app.rate_limit_window_start(make_interval(secs => ${windowSeconds})), ${limit})
      on conflict (bucket_key, window_start) do update set count = excluded.count`;
    const limited = await service.saveLogo(outcome.data, png(15));
    expect(limited.ok).toBe(false);
    if (!limited.ok) expect(limited.error.code).toBe('RATE_LIMITED');
    await admin`truncate public.rate_limit_counters`;
  });

  it('logo upload rejects SVG, spoofed files and a psychologist before touching storage', async () => {
    const owner = await contextFor(PERSONAS.ownerA);
    if (!owner.outcome.ok) throw new Error('no context');
    const svg = await service.saveLogo(
      owner.outcome.data,
      Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'),
    );
    expect(svg.ok).toBe(false);
    if (!svg.ok) expect(svg.error.code).toBe('UNSUPPORTED_MEDIA');
    const psy = await contextFor(PERSONAS.psyA);
    if (!psy.outcome.ok) throw new Error('no context');
    const denied = await service.saveLogo(psy.outcome.data, png(12));
    expect(denied.ok).toBe(false);
    if (!denied.ok) expect(denied.error.code).toBe('FORBIDDEN');
  });

  describe('storage: no user write path (Storage API with real persona JWTs, P1-16)', () => {
    async function put(token: string, path: string, contentType: string, body: Uint8Array) {
      const res = await fetch(`${supabaseUrl}/storage/v1/object/branding/${path}`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          apikey: anon,
          'content-type': contentType,
          'x-upsert': 'false',
        },
        body: body as unknown as BodyInit,
      });
      return {
        status: res.status,
        json: (await res.json().catch(() => ({}))) as { statusCode?: string },
      };
    }
    const name = (org: string, n: number) => `${org}/logo-${n.toString(16).padStart(32, '0')}.png`;
    const bytes = () => new Uint8Array(png(21));

    it('denied even for the aal2 owner of the path org (writes are server-only)', async () => {
      const token = await signIn(PERSONAS.ownerA, 'aal2');
      const res = await put(token, name(ORGS.A.id, Date.now() % 1e9), 'image/png', bytes());
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(res.json.statusCode).toBe('403');
    });

    it('denied: psychologist, owner of another org, aal1 owner, anon', async () => {
      const path = name(ORGS.A.id, 0xdead01);
      expect(
        (await put(await signIn(PERSONAS.psyA, 'aal2'), path, 'image/png', bytes())).json
          .statusCode,
      ).toBe('403');
      expect(
        (await put(await signIn(PERSONAS.ownerB, 'aal2'), path, 'image/png', bytes())).json
          .statusCode,
      ).toBe('403');
      expect(
        (await put(await signIn(PERSONAS.ownerA, 'aal1'), path, 'image/png', bytes())).json
          .statusCode,
      ).toBe('403');
      expect((await put(anon, path, 'image/png', bytes())).status).toBeGreaterThanOrEqual(400);
    });

    it('denied: paths outside the convention, other buckets, SVG mime, oversize', async () => {
      const token = await signIn(PERSONAS.ownerA, 'aal2');
      for (const bad of [
        'evil.png',
        `${ORGS.A.id}/logo.png`,
        `${ORGS.A.id}/../${ORGS.B.id}/logo-${'a'.repeat(32)}.png`,
        `${ORGS.A.id}/logo-${'a'.repeat(32)}.svg`,
        `${ORGS.A.id}/sub/logo-${'a'.repeat(32)}.png`,
      ]) {
        const res = await put(token, bad, 'image/png', bytes());
        expect(res.status, bad).toBeGreaterThanOrEqual(400);
      }
      const svg = await put(
        token,
        `${ORGS.A.id}/logo-${'b'.repeat(32)}.png`,
        'image/svg+xml',
        new TextEncoder().encode('<svg/>'),
      );
      expect(svg.status).toBeGreaterThanOrEqual(400);
      const big = await put(
        token,
        `${ORGS.A.id}/logo-${'c'.repeat(32)}.png`,
        'image/png',
        new Uint8Array(600 * 1024),
      );
      expect(big.status).toBeGreaterThanOrEqual(400);
    });

    it('objects cannot be listed, overwritten or deleted by owners or anon', async () => {
      const token = await signIn(PERSONAS.ownerA, 'aal2');
      const list = await fetch(`${supabaseUrl}/storage/v1/object/list/branding`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          apikey: anon,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ prefix: ORGS.A.id, limit: 100 }),
      });
      expect(((await list.json()) as unknown[]).length).toBe(0);
      const anonList = await fetch(`${supabaseUrl}/storage/v1/object/list/branding`, {
        method: 'POST',
        headers: { apikey: anon, 'content-type': 'application/json' },
        body: JSON.stringify({ prefix: '', limit: 100 }),
      });
      const anonBody = (await anonList.json()) as unknown;
      expect(Array.isArray(anonBody) ? anonBody.length : 0).toBe(0);
      const sql = await admin<{ name: string }[]>`
        select name from storage.objects where bucket_id = 'branding' limit 1`;
      const target = sql[0]?.name as string;
      const del = await fetch(`${supabaseUrl}/storage/v1/object/branding/${target}`, {
        method: 'DELETE',
        headers: { authorization: `Bearer ${token}`, apikey: anon },
      });
      const after =
        await admin`select 1 from storage.objects where bucket_id = 'branding' and name = ${target}`;
      expect(after).toHaveLength(1);
      expect(
        del.status === 200 ? ((await del.json()) as { message?: string }).message : '',
      ).not.toBe('Successfully deleted');
    });
  });

  it('P1-18: removing the logo clears logo_path, deletes the objects and is audited', async () => {
    const { outcome } = await contextFor(PERSONAS.ownerA);
    if (!outcome.ok) throw new Error('no context');
    const saved = await service.saveLogo(outcome.data, png(16));
    if (!saved.ok) throw new Error('upload failed');
    const psy = await contextFor(PERSONAS.psyA);
    if (!psy.outcome.ok) throw new Error('no context');
    const denied = await service.clearLogo(psy.outcome.data);
    expect(denied.ok).toBe(false);
    expect((await fetch(saved.data.logoUrl as string)).status).toBe(200);

    const removed = await service.clearLogo(outcome.data);
    expect(removed.ok).toBe(true);
    expect((await fetch(saved.data.logoUrl as string)).status).not.toBe(200);
    const [row] = await admin<{ logo_path: string | null }[]>`
      select logo_path from public.organization_branding where organization_id = ${ORGS.A.id}`;
    expect(row?.logo_path).toBeNull();
    const left = await admin`
      select 1 from storage.objects where bucket_id = 'branding' and name like ${`${ORGS.A.id}/%`}`;
    expect(left).toHaveLength(0);
    const [audit] = await admin<{ metadata: Record<string, unknown> }[]>`
      select metadata from public.audit_logs
      where event_type = 'organization_branding.logo_removed' and organization_id = ${ORGS.A.id}
      order by occurred_at desc limit 1`;
    expect(audit?.metadata).toEqual({ had_logo: true });
  });

  it('the theming pipeline resolves each organization from its own row (A != B)', async () => {
    const tenancy = await import('@/server/tenancy');
    const a = queries.toTenantBrand((await tenancy.getPublicBranding(ORGS.A.id)) as never);
    const b = queries.toTenantBrand((await tenancy.getPublicBranding(ORGS.B.id)) as never);
    expect(a.isDefault).toBe(false);
    expect(b.isDefault).toBe(false);
    expect(b.brand).toMatchObject({
      slug: 'demo-b',
      brandColor: '#5b4b8a',
      displayName: 'Centro Demo B (ficticio)',
    });
    expect(a.brand.slug).toBe('demo-a');
    expect(a.brand.brandColor).not.toBe(b.brand.brandColor);
  });
});
