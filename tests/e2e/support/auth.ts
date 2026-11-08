import { expect, type Page } from '@playwright/test';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { FICTIONAL_PASSWORD, FICTIONAL_TOTP_SECRET, type Persona } from '../../fixtures/personas';
import { totp } from '../../fixtures/totp';

/** E2E auth helpers. FICTIONAL personas only (supabase/seed.sql), local stack only. */

if (
  existsSync('.env.local') &&
  typeof process.loadEnvFile === 'function' &&
  !process.env.DATABASE_URL
) {
  process.loadEnvFile('.env.local');
}

export const STORAGE_OWNER_PSY_A = path.resolve('node_modules/.cache/psi-e2e/owner-psy-a.json');

/** TOTP for `secret`, waiting out the last seconds of a window so the code does not expire in flight. */
export async function freshTotp(secret: string = FICTIONAL_TOTP_SECRET): Promise<string> {
  const remaining = 30_000 - (Date.now() % 30_000);
  if (remaining < 4_000) await new Promise((r) => setTimeout(r, remaining + 250));
  return totp(secret);
}

export async function submitSignIn(
  page: Page,
  email: string,
  password: string = FICTIONAL_PASSWORD,
  origin = '',
): Promise<void> {
  await page.goto(`${origin}/es/sign-in`);
  await page.getByLabel('Correo electrónico').fill(email);
  await page.getByLabel('Contraseña').fill(password);
  await page.getByRole('button', { name: 'Iniciar sesión' }).click();
}

export async function submitTotp(
  page: Page,
  secret: string = FICTIONAL_TOTP_SECRET,
): Promise<void> {
  await expect(page).toHaveURL(/\/es\/mfa(\?|$)/);
  await page.getByLabel('Código de verificación').fill(await freshTotp(secret));
  await page.getByRole('button', { name: 'Verificar' }).click();
}

/** Password + TOTP for a seeded persona; ends on the dashboard. */
export async function signInWithMfa(page: Page, persona: Persona, origin = ''): Promise<void> {
  await submitSignIn(page, persona.email, FICTIONAL_PASSWORD, origin);
  await submitTotp(page);
  await expect(page).toHaveURL(/\/es\/dashboard$/);
}
