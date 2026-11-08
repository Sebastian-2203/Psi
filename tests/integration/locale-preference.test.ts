import type postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PERSONAS } from '../fixtures/personas';
import { adminSql, detectLocalStack, signIn, skipMessage } from '../fixtures/local-stack';

/** I18N-02: the user's interface language is stored on their own profile (RLS-bound). */
const stack = await detectLocalStack();
skipMessage('locale-preference', stack);

describe.skipIf(!stack.available)('locale preference (I18N-02)', () => {
  let admin: postgres.Sql;
  let locale: typeof import('@/modules/profiles/server/locale');
  let verify: (typeof import('@/server/auth/claims'))['verifyAccessToken'];
  const ids = [PERSONAS.psyA.id, PERSONAS.ownerB.id];

  beforeAll(async () => {
    admin = adminSql();
    locale = await import('@/modules/profiles/server/locale');
    verify = (await import('@/server/auth/claims')).verifyAccessToken;
    await admin`update public.profiles set locale = null where id = any(${ids}::uuid[])`;
  });

  afterAll(async () => {
    await admin`update public.profiles set locale = null where id = any(${ids}::uuid[])`;
    await admin?.end();
  });

  async function claimsFor(persona: (typeof PERSONAS)[keyof typeof PERSONAS]) {
    const claims = await verify(await signIn(persona, 'aal1'));
    if (!claims) throw new Error('verification failed');
    return claims;
  }

  it('returns null until the user chooses, then the stored choice (works at aal1)', async () => {
    const claims = await claimsFor(PERSONAS.psyA);
    expect(await locale.getPreferredLocale(claims)).toBeNull();
    await locale.setPreferredLocale(claims, 'en');
    expect(await locale.getPreferredLocale(claims)).toBe('en');
  });

  it('only ever updates the caller’s own profile', async () => {
    const claims = await claimsFor(PERSONAS.ownerB);
    await locale.setPreferredLocale(claims, 'es');
    const rows = await admin<{ id: string; locale: string | null }[]>`
      select id::text, locale from public.profiles where id = any(${ids}::uuid[]) order by id`;
    const byId = Object.fromEntries(rows.map((r) => [r.id, r.locale]));
    expect(byId[PERSONAS.ownerB.id]).toBe('es');
    expect(byId[PERSONAS.psyA.id]).toBe('en');
  });
});
