import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { deleteFictionalUser, serviceClient } from '../fixtures/local-stack';
import { clearMailbox, firstLink, waitForEmail } from '../fixtures/mailpit';
import { signActivity } from '../../src/lib/session-activity';
import { FICTIONAL_PASSWORD, ORGS, PERSONAS } from '../fixtures/personas';
import {
  freshTotp,
  signInWithMfa,
  STORAGE_OWNER_PSY_A,
  submitSignIn,
  submitTotp,
} from './support/auth';

/**
 * Auth E2E (workstream 1.3) against the local stack with FICTIONAL personas. Serial: the flows
 * share Supabase Auth per-IP limits and seeded TOTP factors.
 */
test.describe.configure({ mode: 'serial' });

const ADMIN_DB = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const created: string[] = [];

test.afterAll(async () => {
  for (const id of created) await deleteFictionalUser(id).catch(() => undefined);
});

async function throwawayUser(options: { staffInOrgA?: boolean } = {}) {
  const email = `e2e-${randomUUID()}@example.test`;
  const password = `Fictional-${randomUUID()}`;
  const { data, error } = await serviceClient().auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { display_name: 'Fictional E2E user', locale: 'es', fictional: true },
  });
  if (error || !data.user) throw new Error(`createUser failed: ${error?.message}`);
  created.push(data.user.id);
  if (options.staffInOrgA) {
    const sql = postgres(ADMIN_DB, { max: 1, onnotice: () => {} });
    try {
      const membershipId = randomUUID();
      await sql`insert into public.memberships (id, organization_id, profile_id) values (${membershipId}, ${ORGS.A.id}, ${data.user.id})`;
      await sql`insert into public.professional_profiles (organization_id, membership_id, professional_title, license_number, license_issuer)
                values (${ORGS.A.id}, ${membershipId}, 'Psicóloga (ficticia)', ${`TP-E2E-${randomUUID().slice(0, 8)}`}, 'Colegio Ficticio')`;
      await sql`insert into public.membership_roles (organization_id, membership_id, role) values (${ORGS.A.id}, ${membershipId}, 'psychologist')`;
    } finally {
      await sql.end();
    }
  }
  return { id: data.user.id, email, password };
}

test('wrong password shows one generic error and keeps the user signed out', async ({ page }) => {
  await submitSignIn(page, PERSONAS.psyB.email, 'definitely-not-the-password');
  const alert = page.locator('[data-slot="alert"][role="alert"]');
  await expect(alert).toContainText('El correo o la contraseña no son correctos.');
  await expect(alert.locator('..')).toBeFocused();
  await expect(page).toHaveURL(/\/es\/sign-in$/);
  // Unknown email: identical message (no enumeration).
  await submitSignIn(page, `nobody-${randomUUID()}@example.test`, 'definitely-not-the-password');
  await expect(page.locator('[data-slot="alert"][role="alert"]')).toContainText(
    'El correo o la contraseña no son correctos.',
  );
  await page.goto('/es/dashboard');
  await expect(page).toHaveURL(/\/es\/sign-in$/);
});

test('client-side validation is announced on the fields', async ({ page }) => {
  await page.goto('/en/sign-in');
  await page.getByRole('button', { name: 'Sign in' }).click();
  const email = page.getByLabel('Email');
  await expect(email).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByText('Enter a valid email address.')).toBeVisible();
  await expect(email).toBeFocused();
});

test('aal1 staff are held at MFA: no professional route is reachable', async ({ page }) => {
  await submitSignIn(page, PERSONAS.psyA.email);
  await expect(page).toHaveURL(/\/es\/mfa$/);
  for (const path of ['/es/dashboard', '/es/settings', '/en/dashboard']) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/(es|en)\/mfa(\?|$)/);
  }
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  // A wrong code does not upgrade the session.
  await page.getByLabel('Verification code').fill('000000');
  await page.getByRole('button', { name: 'Verify' }).click();
  await expect(page.locator('[data-slot="alert"][role="alert"]')).toContainText(
    'The code is not correct',
  );
  await page.goto('/es/dashboard');
  await expect(page).toHaveURL(/\/es\/mfa$/);
});

test('staff without a factor can only reach MFA enrollment', async ({ page }) => {
  await submitSignIn(page, PERSONAS.psyNoMfaA.email);
  await expect(page).toHaveURL(/\/es\/mfa\/enroll$/);
  await page.goto('/es/dashboard');
  await expect(page).toHaveURL(/\/es\/mfa\/enroll$/);
  await page.goto('/es/mfa/recovery-codes');
  await expect(page).toHaveURL(/\/es\/mfa\/enroll$/);
});

test('enrollment: QR + manual secret -> TOTP -> recovery codes shown once -> dashboard', async ({
  page,
}) => {
  const user = await throwawayUser({ staffInOrgA: true });
  await submitSignIn(page, user.email, user.password);
  await expect(page).toHaveURL(/\/es\/mfa\/enroll$/);
  await page.getByRole('button', { name: 'Comenzar la configuración' }).click();
  await expect(
    page.getByRole('img', { name: 'Código QR para agregar la cuenta a tu app de autenticación' }),
  ).toBeVisible();
  const secret = (await page.getByTestId('totp-secret').textContent())?.trim() ?? '';
  expect(secret).toMatch(/^[A-Z2-7]{16,}$/);
  await page.getByLabel('Código de verificación').fill(await freshTotp(secret));
  await page.getByRole('button', { name: 'Activar la verificación' }).click();
  await expect(page).toHaveURL(/\/es\/mfa\/recovery-codes\?enrolled=1$/);
  await expect(page.getByText('La verificación en dos pasos quedó activada.')).toBeVisible();
  await page.getByRole('button', { name: 'Generar códigos' }).click();
  const list = page.getByTestId('recovery-codes');
  await expect(list.getByRole('listitem')).toHaveCount(10);
  await expect(list).toBeFocused();
  await page.reload();
  await expect(page.getByTestId('recovery-codes')).toHaveCount(0); // shown once
  await expect(page.getByText('Te quedan 10 de 10 códigos.')).toBeVisible();
  await page.getByRole('link', { name: 'Continuar' }).click();
  await expect(page).toHaveURL(/\/es\/dashboard$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Inicio de la consulta');
});

test('locale switch on auth pages keeps the page', async ({ page }) => {
  await page.goto('/es/forgot-password');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Restablece tu contraseña');
  await page.getByRole('link', { name: /Cambiar el idioma a English/ }).click();
  await expect(page).toHaveURL(/\/en\/forgot-password$/);
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Reset your password');
  await page.goto('/en/sign-in');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Welcome');
});

test('sign-out revokes the session and returns to sign-in', async ({ page }) => {
  await signInWithMfa(page, PERSONAS.ownerB);
  await page.getByRole('button', { name: 'Menú de usuario' }).click();
  await page.getByRole('menuitem', { name: 'Cerrar sesión' }).click();
  await expect(page).toHaveURL(/\/es\/sign-in\?signedOut=1$/);
  await expect(page.getByText('Cerraste sesión correctamente.')).toBeVisible();
  await page.goto('/es/dashboard');
  await expect(page).toHaveURL(/\/es\/sign-in$/);
});

test('cross-tenant host: an org A owner is denied on demo-b, allowed on demo-a', async ({
  browser,
}) => {
  const b = await browser.newPage();
  await submitSignIn(b, PERSONAS.ownerA.email, FICTIONAL_PASSWORD, `http://${ORGS.B.host}:3000`);
  // Staff always step up to aal2; the tenant check then denies (no capacity in org B).
  await submitTotp(b);
  await expect(b).toHaveURL(new RegExp(`${ORGS.B.host}:3000/es/dashboard$`));
  await expect(b.getByTestId('access-denied')).toBeVisible();
  await expect(b.getByRole('navigation', { name: 'Navegación principal' })).toHaveCount(0);
  await b.goto(`http://${ORGS.B.host}:3000/es/settings`);
  await expect(b.getByTestId('access-denied')).toBeVisible();
  await b.close();

  const a = await browser.newPage();
  await signInWithMfa(a, PERSONAS.ownerA, `http://${ORGS.A.host}:3000`);
  await expect(a.getByRole('navigation', { name: 'Navegación principal' })).toBeVisible();
  // Session cookies are host-only: the demo-a session does not exist on demo-b.
  await a.goto(`http://${ORGS.B.host}:3000/es/dashboard`);
  await expect(a).toHaveURL(/\/es\/sign-in$/);
  await a.close();
});

test('platform_admin has no professional access by role alone', async ({ page }) => {
  await submitSignIn(page, PERSONAS.platform.email);
  await submitTotp(page);
  await expect(page.getByTestId('access-denied')).toBeVisible();
  await page.goto('/es/portal');
  await expect(page.getByTestId('access-denied')).toBeVisible();
});

test('password recovery: same message for any email; email link -> new password', async ({
  page,
}) => {
  const user = await throwawayUser();
  await clearMailbox(user.email);
  await page.goto('/es/forgot-password');
  await page.getByLabel('Correo electrónico').fill(user.email);
  await page.getByRole('button', { name: 'Enviar enlace' }).click();
  const sent = page.getByText('Si existe una cuenta con ese correo');
  await expect(sent).toBeVisible();

  const link = firstLink(await waitForEmail(user.email));
  expect(new URL(link).pathname).toBe('/api/auth/confirm/es');
  // P1-12: GETs (link scanners, previews) must not consume the token; only the button does.
  await page.request.get(link);
  await page.goto(link);
  await expect(page).toHaveURL(/\/es\/confirm\?/);
  await page.getByRole('button', { name: 'Continuar' }).click();
  await expect(page).toHaveURL(/\/es\/reset-password$/);
  const newPassword = `Fictional-new-${randomUUID()}`;
  await page.getByLabel('Nueva contraseña', { exact: true }).fill(newPassword);
  await page.getByLabel('Confirma la nueva contraseña').fill(newPassword);
  await page.getByRole('button', { name: 'Guardar contraseña' }).click();
  await expect(page).toHaveURL(/\/es\/dashboard$/);
  await expect(page.getByTestId('access-denied')).toBeVisible(); // no staff role: no access

  // The link is single use.
  await page.context().clearCookies();
  await page.goto(link);
  await page.getByRole('button', { name: 'Continuar' }).click();
  await expect(page).toHaveURL(/\/es\/forgot-password\?error=link$/);
});

test('idle timeout (15 min) ends and revokes the session server-side', async ({ page }) => {
  const user = await throwawayUser();
  await submitSignIn(page, user.email, user.password);
  await expect(page.getByTestId('access-denied')).toBeVisible(); // signed in, no staff role
  const cookies = await page.context().cookies();
  const session = cookies.find((c) => c.name.startsWith('sb-') && c.name.includes('-auth-token'));
  expect(session?.httpOnly).toBe(true);
  expect(session?.sameSite).toBe('Lax');
  const activity = cookies.find((c) => c.name === 'psi_activity');
  expect(activity?.httpOnly).toBe(true);
  // P1-02: the cookie is HMAC-signed and bound to the session id.
  expect(activity?.value).toMatch(/^v1\.[0-9a-f-]{36}\.\d+\.[A-Za-z0-9_-]{43}$/);
  const sessionId = activity!.value.split('.')[1] as string;
  const secret = process.env.SESSION_ACTIVITY_SECRET;
  if (!secret) throw new Error('SESSION_ACTIVITY_SECRET must be available to the E2E process');
  // Simulate 16 minutes without requests (validly signed, as the server would have issued it).
  const stale = await signActivity(secret, sessionId, Math.floor(Date.now() / 1000) - 16 * 60);
  await page.context().addCookies([{ ...activity!, value: stale }]);
  await page.goto('/es/dashboard');
  await expect(page).toHaveURL(/\/es\/sign-in\?expired=idle$/);
  await expect(page.getByText('Cerramos tu sesión por inactividad.')).toBeVisible();
  const after = await page.context().cookies();
  expect(after.some((c) => c.name.startsWith('sb-') && c.value !== '')).toBe(false);
});

test.describe('invitations', () => {
  test.use({ storageState: STORAGE_OWNER_PSY_A });

  test('owner invites by email; the invitee accepts once and must enroll MFA', async ({
    page,
    browser,
  }) => {
    const email = `e2e-invitee-${randomUUID()}@example.test`;
    await clearMailbox(email);
    await page.goto('/es/settings');
    await page.getByLabel('Correo electrónico').fill(email);
    await page.getByRole('button', { name: 'Enviar invitación' }).click();
    await expect(page.getByText('Enviamos la invitación.')).toBeVisible();
    await expect(page.getByTestId('invitation-list')).toContainText(email);

    const link = firstLink(await waitForEmail(email));
    expect(link).toContain('/es/invitation#token=');

    const context = await browser.newContext({ storageState: undefined });
    const invitee = await context.newPage();
    await invitee.goto(link);
    await expect(invitee).toHaveURL(/\/es\/invitation$/); // token removed from the address bar
    await expect(invitee.getByText(/te invitó a unirte como psicóloga o psicólogo/)).toBeVisible();
    await invitee.getByLabel('Tu nombre').fill('Fictional Invitee');
    await invitee.getByLabel('Contraseña').fill(`Fictional-${randomUUID()}`);
    await invitee.getByLabel('Título profesional').fill('Psicóloga (ficticia)');
    await invitee
      .getByLabel('Número de tarjeta profesional')
      .fill(`TP-E2E-${randomUUID().slice(0, 8)}`);
    await invitee.getByLabel('Entidad que la expide').fill('Colegio Ficticio');
    await invitee.getByRole('button', { name: 'Aceptar la invitación' }).click();
    await expect(invitee).toHaveURL(/\/es\/mfa\/enroll$/);

    const { data } = await serviceClient().auth.admin.listUsers({ perPage: 200 });
    const user = data.users.find((u) => u.email === email);
    if (user) created.push(user.id);

    // Reusing the link fails generically.
    const again = await (await browser.newContext()).newPage();
    await again.goto(link);
    await expect(again.getByText('No pudimos usar esta invitación')).toBeVisible();
    await context.close();
  });
});
