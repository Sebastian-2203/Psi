import { expect, test as setup } from '@playwright/test';
import postgres from 'postgres';
import { PERSONAS } from '../fixtures/personas';
import { signInWithMfa, STORAGE_OWNER_PSY_A } from './support/auth';

// LOCAL ONLY: repeated local runs would otherwise hit the ADR-020 per-email sign-in limits.
setup.beforeAll(async () => {
  const sql = postgres('postgresql://postgres:postgres@127.0.0.1:54322/postgres', {
    max: 1,
    onnotice: () => {},
  });
  try {
    await sql`truncate public.rate_limit_counters`;
  } finally {
    await sql.end();
  }
});

// Sign-in -> MFA verify (TOTP computed from the fictional secret) -> dashboard, once per run.
setup('owner+psychologist A signs in with password and TOTP', async ({ page }) => {
  await signInWithMfa(page, PERSONAS.ownerPsyA);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Inicio de la consulta');
  await page.context().storageState({ path: STORAGE_OWNER_PSY_A });
});
