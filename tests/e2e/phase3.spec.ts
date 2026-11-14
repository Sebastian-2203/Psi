import { expect, test, type Page } from '@playwright/test';
import { FICTIONAL_PASSWORD, PERSONAS, SEED } from '../fixtures/personas';
import { signInWithMfa, STORAGE_OWNER_PSY_A } from './support/auth';

/** Phase 3 UI (clinical record, notes, plan, documents, portal). FICTIONAL data only. */

const run = Date.now().toString(36);

async function createPatient(page: Page, first: string, last: string) {
  await page.goto('/es/patients/new');
  await expect(page.getByRole('heading', { level: 1, name: 'Nuevo paciente' })).toBeVisible();
  const form = page.locator('form:visible').first();
  await form.getByLabel('Nombres').fill(first);
  await form.getByLabel('Apellidos').fill(last);
  await form.getByLabel('Fecha de nacimiento').fill('1990-03-04');
  await form.getByRole('button', { name: 'Crear paciente' }).click();
  await expect(page).toHaveURL(/\/es\/patients\/[0-9a-f-]{36}$/);
  await expect(page.getByRole('heading', { level: 1 })).toContainText(first);
}

async function openRecord(page: Page) {
  await page.getByRole('tab', { name: 'Historia clínica' }).click();
  await page.getByRole('button', { name: 'Abrir historia clínica' }).click();
  await expect(page.getByText('Abierta', { exact: true })).toBeVisible();
}

test.describe('psychologist: notes (owner + psychologist A)', () => {
  test.use({ storageState: STORAGE_OWNER_PSY_A });

  test('writes and finalizes a note, adds an addendum, and cannot edit the finalized note', async ({
    page,
  }) => {
    await createPatient(page, 'Nota', `Clinica${run}`);
    await openRecord(page);
    await page.getByRole('tab', { name: 'Notas' }).click();
    await page.getByRole('button', { name: 'Nueva nota' }).click();
    await page.getByRole('button', { name: 'Crear borrador' }).click();

    // Draft editor with autosave.
    const editor = page.getByTestId('note-editor');
    await expect(editor).toBeVisible();
    await editor.getByLabel('Contenido de la nota').fill('Contenido ficticio de la sesión.');
    await expect(page.getByTestId('save-indicator')).toContainText('Guardado a las', {
      timeout: 15_000,
    });

    // Finalizing needs an explicit confirmation.
    await editor.getByRole('button', { name: 'Finalizar nota' }).click();
    const confirm = page.getByRole('dialog');
    await expect(confirm).toContainText('no se puede editar');
    await confirm.getByRole('button', { name: 'Sí, finalizar nota' }).click();

    // Locked view: stripe, no editor, no edit controls.
    await expect(page.getByTestId('note-locked-stripe')).toContainText('No editable');
    await expect(page.getByTestId('note-body')).toContainText('Contenido ficticio de la sesión.');
    await expect(page.getByTestId('note-editor')).toHaveCount(0);
    await expect(page.getByRole('textbox')).toHaveCount(0);

    // Addendum with a reason.
    await page.getByRole('button', { name: 'Agregar adenda' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: 'Guardar adenda' }).click();
    await expect(dialog.getByText('Este campo es obligatorio.')).toBeVisible();
    await dialog.getByLabel('Motivo de la adenda').selectOption('correction');
    await dialog.getByLabel('Texto de la adenda').fill('Corrección ficticia posterior.');
    await dialog.getByRole('button', { name: 'Guardar adenda' }).click();
    const addendum = page.getByTestId('addendum');
    await expect(addendum).toContainText('Corrección ficticia posterior.');
    await expect(addendum).toContainText('Corrección');
    // The original body is untouched.
    await expect(page.getByTestId('note-body')).toContainText('Contenido ficticio de la sesión.');

    // After a reload the note is still locked (list shows Finalizada, opens without editor).
    await page.reload();
    await page.getByRole('tab', { name: 'Notas' }).click();
    const item = page.getByTestId('note-finalized');
    await expect(item).toContainText('Finalizada');
    await expect(item).toContainText('1 adenda');
    await item.getByRole('button', { name: 'Abrir' }).click();
    await expect(page.getByTestId('note-locked-stripe')).toBeVisible();
    await expect(page.getByTestId('note-editor')).toHaveCount(0);
  });

  test('an unlinked draft appears on the dashboard "drafts to finalize" card', async ({ page }) => {
    const last = `Borrador${run}`;
    await createPatient(page, 'Pendiente', last);
    await openRecord(page);
    await page.getByRole('tab', { name: 'Notas' }).click();
    await page.getByRole('button', { name: 'Nueva nota' }).click();
    await page.getByRole('button', { name: 'Crear borrador' }).click();
    await expect(page.getByTestId('note-editor')).toBeVisible();
    await page.goto('/es/dashboard');
    await expect(page.getByTestId('drafts-list')).toContainText(last);
  });

  test('psychologist off the care team is denied the clinical record', async ({ page }) => {
    // ownerPsyA is NOT on the care team of the seeded adult patient (care team: psychologist A).
    await page.goto(`/es/patients/${SEED.patients.adultA}?tab=notes`);
    await expect(
      page.getByText('Esta ficha no está disponible').locator('visible=true'),
    ).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Notas' })).toHaveCount(0);
    await expect(page.getByText('Nota de ejemplo ficticia').locator('visible=true')).toHaveCount(0);
  });

  test('390px: record and notes fit the viewport', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await createPatient(page, 'Movil', `Clinica${run}`);
    await openRecord(page);
    const overflow = () =>
      page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
    expect(await overflow(), 'record tab overflow').toBeLessThanOrEqual(0);
    await page.getByRole('tab', { name: 'Notas' }).click();
    await page.getByRole('button', { name: 'Nueva nota' }).click();
    await page.getByRole('button', { name: 'Crear borrador' }).click();
    await expect(page.getByTestId('note-editor')).toBeVisible();
    expect(await overflow(), 'note editor overflow').toBeLessThanOrEqual(0);
  });

  test('owner configures a note type in clinical settings', async ({ page }) => {
    await page.goto('/es/settings/clinical');
    await expect(
      page.getByRole('heading', { level: 1, name: 'Configuración clínica' }),
    ).toBeVisible();
    await expect(page.getByTestId('config-section')).toContainText('Motivo de consulta');
    await expect(page.getByTestId('config-noteType')).toContainText('SOAP');
  });
});

test.describe('patient portal sees shared content only', () => {
  test('a shared document and the goal text, never notes', async ({ browser }) => {
    const title = `Informe ficticio ${run}`;
    // Care team (psychologist A) uploads and shares a document for the seeded adult patient.
    const staff = await browser.newContext();
    const sp = await staff.newPage();
    await signInWithMfa(sp, PERSONAS.psyA);
    await sp.goto(`/es/patients/${SEED.patients.adultA}?tab=documents`);
    await sp.getByRole('button', { name: 'Subir documento' }).click();
    const upload = sp.getByRole('dialog');
    await upload.getByLabel('Nombre del documento').fill(title);
    await upload.getByLabel('Archivo').setInputFiles({
      name: 'informe.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('%PDF-1.4\n% fictional test file\n%%EOF\n'),
    });
    await upload.getByRole('button', { name: 'Subir' }).click();
    const row = sp.getByTestId('document-active').filter({ hasText: title });
    await expect(row).toBeVisible();
    await row.getByRole('button', { name: 'Compartir' }).click();
    await sp.getByRole('dialog').getByRole('button', { name: 'Compartir', exact: true }).click();
    await expect(row).toContainText('Compartido con el paciente');
    // The care team opens it through a short-lived signed URL (the browser would download it).
    await sp.evaluate(() => {
      const w = window as unknown as { __opened?: string };
      window.open = ((url: string) => {
        w.__opened = url;
        return {} as Window;
      }) as typeof window.open;
    });
    await row.getByRole('button', { name: 'Abrir' }).click();
    await expect
      .poll(() => sp.evaluate(() => (window as unknown as { __opened?: string }).__opened))
      .toContain('/storage/');
    const signed = await sp.evaluate(() => (window as unknown as { __opened: string }).__opened);
    const fetched = await sp.request.get(signed);
    expect(fetched.status()).toBe(200);
    expect(await fetched.body()).toEqual(Buffer.from('%PDF-1.4\n% fictional test file\n%%EOF\n'));

    // A replacement upload links to the earlier document (supersedes).
    await sp.getByRole('button', { name: 'Subir documento' }).click();
    const second = sp.getByRole('dialog');
    await second.getByLabel('Nombre del documento').fill(`${title} v2`);
    await second
      .getByLabel('Reemplaza un documento anterior (opcional)')
      .selectOption({ label: title });
    await second.getByLabel('Archivo').setInputFiles({
      name: 'informe2.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('%PDF-1.4\n% fictional replacement\n%%EOF\n'),
    });
    await second.getByRole('button', { name: 'Subir' }).click();
    await expect(
      sp
        .getByTestId('document-active')
        .filter({ hasText: `${title} v2` })
        .getByTestId('document-supersedes'),
    ).toContainText(`Reemplaza: ${title}`);

    // The patient sees the document and the patient-facing goal text, and nothing from the notes.
    const ctx = await browser.newContext();
    const p = await ctx.newPage();
    await p.goto('/es/sign-in');
    await p.getByLabel('Correo electrónico').fill(PERSONAS.patientA.email);
    await p.getByLabel('Contraseña').fill(FICTIONAL_PASSWORD);
    await p.getByRole('button', { name: 'Iniciar sesión' }).click();
    await expect(p).toHaveURL(/\/es\/portal/);
    await expect(p.getByRole('heading', { name: 'Documentos compartidos' })).toBeVisible();
    await expect(p.getByTestId('portal-documents')).toContainText(title);
    await expect(p.getByRole('heading', { name: 'Mis objetivos' })).toBeVisible();
    await expect(p.getByTestId('portal-goals')).toContainText('Mi objetivo de ejemplo.');
    await expect(p.getByTestId('portal-goals')).not.toContainText('Redacción clínica');
    await expect(p.getByRole('heading', { name: 'Próximas sesiones' })).toBeVisible();
    const body = await p.locator('body').innerText();
    expect(body).not.toContain('Nota de ejemplo ficticia');
    expect(body).not.toContain('Borrador ficticio');
    expect(body).not.toContain('Adenda ficticia');
    // No route exposes notes to the patient.
    await p.goto(`/es/patients/${SEED.patients.adultA}?tab=notes`);
    await expect(p).not.toHaveURL(/\/es\/patients\//);
    await ctx.close();
    await staff.close();
  });
});

test.describe('screenshot', () => {
  test.skip(!process.env.PHASE3_SCREENSHOT, 'set PHASE3_SCREENSHOT=1 to refresh the screenshot');

  test('note editor (es, 2x)', async ({ browser }) => {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 1250 },
      deviceScaleFactor: 2,
    });
    const page = await context.newPage();
    await signInWithMfa(page, PERSONAS.psyA);
    await page.goto(`/es/patients/${SEED.patients.adultA}?tab=notes`);
    await page.getByTestId('note-draft').getByRole('button', { name: 'Continuar' }).click();
    await expect(page.getByTestId('note-editor')).toBeVisible();
    await page.screenshot({ path: 'docs/screenshots/phase3/note-editor-es.png' });
    await context.close();
  });
});
