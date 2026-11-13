import { expect, test, type Browser, type Page } from '@playwright/test';
import { FICTIONAL_PASSWORD, PERSONAS, SEED } from '../fixtures/personas';
import { clearMailbox, waitForEmail } from '../fixtures/mailpit';
import { signInWithMfa, STORAGE_OWNER_PSY_A } from './support/auth';

/** Phase 2 UI. FICTIONAL data only; unique names per run keep the duplicate check quiet. */

const run = Date.now().toString(36);
const yearsAgo = (years: number) => {
  const d = new Date();
  d.setFullYear(d.getFullYear() - years);
  return d.toISOString().slice(0, 10);
};

async function createPatient(
  page: Page,
  data: { first: string; last: string; dob: string; email?: string },
) {
  await page.goto('/es/patients/new');
  // Streaming keeps a hidden copy of the page until the swap: wait for the visible heading first.
  await expect(page.getByRole('heading', { level: 1, name: 'Nuevo paciente' })).toBeVisible();
  await page.getByLabel('Nombres').fill(data.first);
  await page.getByLabel('Apellidos').fill(data.last);
  await page.getByLabel('Fecha de nacimiento').fill(data.dob);
  if (data.email) await page.getByLabel('Correo electrónico').fill(data.email);
  await page.getByRole('button', { name: 'Crear paciente' }).click();
  await expect(page).toHaveURL(/\/es\/patients\/[0-9a-f-]{36}$/);
  await expect(page.getByRole('heading', { level: 1 })).toContainText(data.first);
}

async function inviteLink(address: string): Promise<string> {
  const mail = await waitForEmail(address);
  const link = /https?:\/\/\S+\/invitation#token=\S+/.exec(mail.Text)?.[0];
  expect(link, 'invitation link in the email').toBeTruthy();
  return link!;
}

async function acceptInvitation(browser: Browser, link: string, name: string) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(link);
  await page.getByLabel('Tu nombre').fill(name);
  await page.getByLabel('Contraseña').fill(FICTIONAL_PASSWORD);
  await page.getByRole('button', { name: 'Crear mi acceso' }).click();
  await expect(page).toHaveURL(/\/es\/portal$/);
  return { context, page };
}

test.describe('professional: patients (owner + psychologist A)', () => {
  test.use({ storageState: STORAGE_OWNER_PSY_A });

  test('creates a minor with a guardian with limited permissions; the guardian sees only that', async ({
    page,
    browser,
  }) => {
    const guardianEmail = `acudiente.${run}@example.test`;
    await clearMailbox(guardianEmail);
    await createPatient(page, { first: 'Nico', last: `Prueba${run}`, dob: yearsAgo(10) });
    await expect(page.getByText('Menor de edad').first()).toBeVisible();

    await page.getByRole('tab', { name: 'Personas responsables' }).click();
    await page.getByRole('button', { name: 'Agregar persona responsable' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Nombres').fill('Mara');
    await dialog.getByLabel('Apellidos').fill(`Prueba${run}`);
    await dialog.getByLabel('Correo electrónico').fill(guardianEmail);
    await dialog.getByRole('checkbox', { name: 'Es representante legal' }).click();
    await dialog.getByLabel('Fundamento legal').selectOption('parental_authority');
    await dialog.getByRole('button', { name: 'Crear persona responsable' }).click();

    const card = page.getByTestId(/^guardian-/);
    await expect(card).toContainText('Mara');
    await expect(card).toContainText('Por verificar');

    // Verify the relationship (and the legal basis), then grant ONE permission.
    await card.getByRole('button', { name: 'Verificar relación' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Verificar', exact: true }).click();
    await expect(card).toContainText('Activa');
    await expect(card.getByRole('checkbox', { name: 'Firmar consentimientos' })).toBeChecked({
      checked: false,
    });
    await card.getByRole('checkbox', { name: 'Ver actividades asignadas' }).click();
    await card.getByRole('button', { name: 'Guardar permisos' }).click();
    await expect(card.getByText('Permisos guardados.')).toBeVisible();

    await card.getByRole('button', { name: 'Invitar al portal' }).click();
    await page.getByRole('dialog').getByLabel('Correo electrónico').fill(guardianEmail);
    await page.getByRole('dialog').getByRole('button', { name: 'Enviar invitación' }).click();
    await expect(page.getByText('Invitación enviada.')).toBeVisible();

    const link = await inviteLink(guardianEmail);
    expect(link).toContain('kind=guardian');
    const guardian = await acceptInvitation(browser, link, `Mara Prueba${run}`);
    const g = guardian.page;
    await expect(g.getByText('Acompañando a Nico')).toBeVisible();
    await expect(g.getByText('Ver las actividades asignadas')).toBeVisible();
    // Not granted -> not shown, and no signing section at all.
    await expect(g.getByText('Firmar consentimientos')).toHaveCount(0);
    await expect(g.getByText('Ver el calendario de sesiones')).toHaveCount(0);
    await expect(g.getByRole('heading', { name: 'Documentos por firmar' })).toHaveCount(0);
    await expect(g.getByRole('link', { name: 'Ver mi privacidad' })).toHaveCount(0);
    await guardian.context.close();
  });

  test('an invited adult patient signs a consent in the portal', async ({ page, browser }) => {
    const email = `paciente.${run}@example.test`;
    await clearMailbox(email);
    await createPatient(page, { first: 'Lucas', last: `Firma${run}`, dob: '1991-04-12', email });
    await page.getByRole('button', { name: 'Invitar al portal' }).click();
    await expect(page.getByRole('dialog').getByLabel('Correo electrónico')).toHaveValue(email);
    await page.getByRole('dialog').getByRole('button', { name: 'Enviar invitación' }).click();
    await expect(page.getByText('Invitación enviada.')).toBeVisible();

    const link = await inviteLink(email);
    expect(link).toContain('kind=patient');
    const patient = await acceptInvitation(browser, link, `Lucas Firma${run}`);
    const p = patient.page;
    const card = p.getByTestId('consent-tratamiento');
    await expect(card).toContainText('Consentimiento informado (texto ficticio) v2');
    await expect(card).toContainText('Por firmar');

    // Both evidence fields are required before anything is sent.
    await card.getByRole('button', { name: 'Acepto', exact: true }).click();
    await expect(card.getByText('Este campo es obligatorio.')).toHaveCount(2);
    await card.getByLabel('Escribe tu nombre completo').fill(`Lucas Firma${run}`);
    await card.getByRole('checkbox').click();
    await card.getByRole('button', { name: 'Acepto', exact: true }).click();
    await expect(card.getByText('Aceptado')).toBeVisible();
    await expect(card.getByText(/registramos que aceptaste/i)).toBeVisible();

    // The care team sees the decision on the consents tab.
    await page.reload();
    await page.getByRole('tab', { name: 'Consentimientos' }).click();
    await expect(page.getByTestId('consent-records')).toContainText('Aceptado');
    await expect(page.getByTestId('consent-records')).toContainText('Firma en el portal');
    await patient.context.close();
  });

  test('390px: list and profile fit the viewport', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    for (const path of ['/es/patients', `/es/patients/${SEED.patients.adultA}`]) {
      await page.goto(path);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow, `${path} horizontal overflow`).toBeLessThanOrEqual(0);
    }
  });
});

test.describe('owner off the care team', () => {
  test('sees the directory only: no links, no create, no record', async ({ page }) => {
    await signInWithMfa(page, PERSONAS.ownerA);
    await page.goto('/es/patients');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Pacientes');
    const directory = page.locator('[data-testid=directory-patients]:visible');
    await expect(directory).toContainText('Ana Ficticia');
    await expect(directory.getByRole('link')).toHaveCount(0);
    await expect(page.locator('[data-testid=my-patients]:visible')).toHaveCount(0);
    await expect(page.getByRole('link', { name: /Nuevo paciente/ })).toHaveCount(0);
    await page.goto(`/es/patients/${SEED.patients.adultA}`);
    await expect(
      page.getByText('Esta ficha no está disponible').locator('visible=true'),
    ).toBeVisible();
    await expect(page.getByText('FICT-1001').locator('visible=true')).toHaveCount(0);
  });
});

test.describe('seeded portal personas', () => {
  test('a seeded guardian sees only the permissions she was granted', async ({ browser }) => {
    // Seeded guardian Marta: only what she was granted (sign_consents, view_assignments, complete_assignments).
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto('/es/sign-in');
    await page.getByLabel('Correo electrónico').fill(PERSONAS.guardianA.email);
    await page.getByLabel('Contraseña').fill(FICTIONAL_PASSWORD);
    await page.getByRole('button', { name: 'Iniciar sesión' }).click();
    await expect(page).toHaveURL(/\/es\/portal/);
    await expect(page.getByText('Acompañando a')).toBeVisible();
    await expect(page.getByText('Ver el calendario de sesiones')).toHaveCount(0);
    await expect(page.getByText('Ver las respuestas a las actividades')).toHaveCount(0);
    await context.close();
  });
});

test.describe('screenshot', () => {
  test.skip(!process.env.PHASE2_SCREENSHOT, 'set PHASE2_SCREENSHOT=1 to refresh the screenshot');

  test('patient profile (es, 2x)', async ({ browser }) => {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 1000 },
      deviceScaleFactor: 2,
    });
    const page = await context.newPage();
    await signInWithMfa(page, PERSONAS.psyA);
    await page.goto(`/es/patients/${SEED.patients.minorA}`);
    await page.getByRole('tab', { name: 'Personas responsables' }).click();
    await expect(page.getByTestId(/^guardian-/).first()).toBeVisible();
    await page.screenshot({
      path: 'docs/screenshots/phase2/patient-profile-es.png',
      fullPage: true,
    });
    await context.close();
  });
});
