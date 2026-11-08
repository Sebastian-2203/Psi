import { expect, test, type Browser, type Page } from '@playwright/test';
import { ORGS, PERSONAS } from '../fixtures/personas';
import { derivePrimary } from '../../src/styles/branding';
import postgres from 'postgres';
import { signInWithMfa } from './support/auth';

/**
 * Workstream 1.7 — organization branding. FICTIONAL tenants only: org A carries the provisional
 * Daniela brand, org B a different fictional brand (supabase/seed.sql).
 */

// Every test shares org A's branding row: run the file serially and start from the seeded state.
test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  // LOCAL ONLY (like auth.setup.ts): restore the seeded fictional brand of org A.
  const sql = postgres('postgresql://postgres:postgres@127.0.0.1:54322/postgres', {
    max: 1,
    onnotice: () => {},
  });
  try {
    await sql`
      update public.organization_branding set
        display_name = 'Psicóloga Daniela Ortega', brand_color = '#d94a43',
        functional_color = '#a73c37', secondary_color = null, logo_path = null
      where organization_id = ${ORGS.A.id}`;
  } finally {
    await sql.end();
  }
});

const A = `http://${ORGS.A.host}:3000`;
const B = `http://${ORGS.B.host}:3000`;

/** React attaches its props to DOM nodes on hydration; typing before that is lost. */
const hydrated = (page: Page) =>
  page.waitForFunction(() =>
    Object.keys(document.querySelector('#main-content form input') ?? {}).some((k) =>
      k.startsWith('__reactProps$'),
    ),
  );

/** Primary colour a signed-out visitor gets on the tenant's sign-in page. */
async function publicPrimary(browser: Browser, origin: string): Promise<string> {
  const visitor = await browser.newPage();
  try {
    await visitor.goto(`${origin}/es/sign-in`);
    return await primaryOf(visitor);
  } finally {
    await visitor.close();
  }
}

const primaryOf = (page: Page) =>
  page.evaluate(() =>
    getComputedStyle(document.querySelector('[data-context]') as Element)
      .getPropertyValue('--primary')
      .trim(),
  );

test.describe('tenant theming by host', () => {
  test('demo-a renders the Daniela brand, demo-b a different fictional brand', async ({
    browser,
  }) => {
    const a = await browser.newPage();
    await a.goto(`${A}/es/sign-in`);
    await expect(a.locator('html')).toHaveAttribute('data-tenant', 'demo-a');
    await expect(a.getByText('Psicóloga Daniela Ortega')).toBeVisible();
    expect(await primaryOf(a)).toBe('#a73c37');
    await a.close();

    const b = await browser.newPage();
    await b.goto(`${B}/es/sign-in`);
    await expect(b.locator('html')).toHaveAttribute('data-tenant', 'demo-b');
    await expect(b.getByText('Centro Demo B (ficticio)')).toBeVisible();
    await expect(b.getByText('Psicóloga Daniela Ortega')).toHaveCount(0);
    const expected = derivePrimary('#5b4b8a')?.primary;
    expect(expected).toBeTruthy();
    expect(await primaryOf(b)).toBe(expected);
    await b.close();
  });

  test('the app host (no tenant) keeps the default Daniela tokens', async ({ page }) => {
    await page.goto('/es/sign-in');
    await expect(page.locator('html')).toHaveAttribute('data-tenant', 'daniela-ortega');
    await expect(page.getByText('Psicóloga Daniela Ortega')).toBeVisible();
  });
});

test.describe('branding settings (owner, aal2)', () => {
  test('owner changes the primary colour and sees it applied everywhere', async ({ browser }) => {
    const page = await browser.newPage();
    await signInWithMfa(page, PERSONAS.ownerA, A);
    await page.goto(`${A}/es/settings/branding`);
    await hydrated(page);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Marca de tu consulta');

    // Org A stores an explicit functional colour (Daniela's logo ink); clear it so the primary is
    // derived from the new main colour. The live preview in the three contexts follows the draft.
    await page.getByLabel(/^Color para texto y botones/).fill('');
    await page.getByLabel('Color principal de la marca', { exact: true }).fill('#1d6fa5');
    await expect(page.getByTestId('functional-report')).toContainText('contraste');
    const draft = derivePrimary('#1d6fa5')?.primary as string;
    for (const context of ['professional', 'portal-adult', 'portal-child']) {
      await expect
        .poll(() =>
          page
            .getByTestId(`preview-${context}`)
            .evaluate((el) => getComputedStyle(el).getPropertyValue('--primary').trim()),
        )
        .toBe(draft);
    }

    await page.getByRole('button', { name: 'Guardar cambios' }).click();
    await expect(page.getByText('Guardamos la marca de tu consulta.')).toBeVisible();

    // Applied on the server-rendered page after a reload and on other pages of the tenant.
    await page.goto(`${A}/es/dashboard`);
    expect(await primaryOf(page)).toBe(draft);
    // Public pages of the tenant too (fresh, signed-out browser).
    expect(await publicPrimary(browser, A)).toBe(draft);

    // Restore the seeded brand.
    await page.goto(`${A}/es/settings/branding`);
    await hydrated(page);
    await page.getByLabel('Color principal de la marca', { exact: true }).fill('#d94a43');
    await page.getByLabel(/^Color para texto y botones/).fill('#a73c37');
    await page.getByRole('button', { name: 'Guardar cambios' }).click();
    await expect(page.getByText('Guardamos la marca de tu consulta.')).toBeVisible();
    expect(await publicPrimary(browser, A)).toBe('#a73c37');
    await page.close();
  });

  test('a low-contrast functional colour is rejected inline with a suggested shade', async ({
    browser,
  }) => {
    const page = await browser.newPage();
    await signInWithMfa(page, PERSONAS.ownerA, A);
    await page.goto(`${A}/es/settings/branding`);
    await hydrated(page);
    const field = page.getByLabel(/^Color para texto y botones/);
    await field.fill('#ffcc00');
    await expect(field).toHaveAttribute('aria-invalid', 'true');
    await expect(page.getByText(/no tiene suficiente contraste/)).toBeVisible();
    const suggestion = derivePrimary('#ffcc00')?.primary as string;
    await expect(page.getByText(new RegExp(`Prueba con ${suggestion}`))).toBeVisible();

    await page.getByRole('button', { name: 'Guardar cambios' }).click();
    await expect(page.getByText('Guardamos la marca de tu consulta.')).toHaveCount(0);
    // Not stored: another page still renders the seeded primary.
    expect(await publicPrimary(browser, A)).toBe('#a73c37');

    // One click applies the suggestion and clears the error.
    await page.goto(`${A}/es/settings/branding`);
    await hydrated(page);
    await field.fill('#ffcc00');
    await page.getByRole('button', { name: `Usar ${suggestion}` }).click();
    await expect(field).toHaveValue(suggestion);
    await expect(page.getByText(/no tiene suficiente contraste/)).toHaveCount(0);
    await page.close();
  });

  test('logo upload: SVG is refused, a PNG is accepted and shown with alt text', async ({
    browser,
  }) => {
    const page = await browser.newPage();
    await signInWithMfa(page, PERSONAS.ownerA, A);
    await page.goto(`${A}/es/settings/branding`);
    await hydrated(page);
    const file = page.getByLabel('Archivo del logo');

    await file.setInputFiles({
      name: 'logo.svg',
      mimeType: 'image/svg+xml',
      buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'),
    });
    await page.getByRole('button', { name: 'Subir logo' }).click();
    await expect(page.getByText(/Solo se admiten imágenes PNG, JPEG o WebP/)).toBeVisible();

    // Spoofed MIME: an SVG sent as image/png is refused by magic bytes on the server.
    await file.setInputFiles({
      name: 'logo.png',
      mimeType: 'image/png',
      buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'),
    });
    await page.getByRole('button', { name: 'Subir logo' }).click();
    await expect(page.getByText(/Solo se admiten imágenes PNG, JPEG o WebP/)).toBeVisible();

    await file.setInputFiles({ name: 'logo.png', mimeType: 'image/png', buffer: tinyPng() });
    await page.getByRole('button', { name: 'Subir logo' }).click();
    await expect(page.getByText('Subimos tu logo.')).toBeVisible();
    await page.goto(`${A}/es/dashboard`);
    const logo = page.getByRole('img', { name: 'Logo de Psicóloga Daniela Ortega' }).first();
    await expect(logo).toHaveAttribute('src', /\/storage\/v1\/object\/public\/branding\//);
    await expect
      .poll(() => logo.evaluate((el: HTMLImageElement) => el.naturalWidth))
      .toBeGreaterThan(0);

    // Remove it again (restores the seeded state).
    await page.goto(`${A}/es/settings/branding`);
    await hydrated(page);
    await page.getByRole('button', { name: 'Quitar logo' }).click();
    await expect(page.getByText('Quitamos tu logo.')).toBeVisible();
    await page.close();
  });

  test('a psychologist (not owner) sees the owner-only message and no form', async ({
    browser,
  }) => {
    const page = await browser.newPage();
    await signInWithMfa(page, PERSONAS.psyA, A);
    await page.goto(`${A}/es/settings/branding`);
    await expect(
      page.getByText('Solo la titular o el titular de la consulta puede cambiar la marca.'),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Guardar cambios' })).toHaveCount(0);
    await page.close();
  });
});

/** 32x32 solid FICTIONAL PNG, built without dependencies. */
function tinyPng(): Buffer {
  // Pre-computed: 32x32 RGB, all pixels #d94a43.
  return Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAIAAAD8GO2jAAAAKklEQVR4nGO46eVMU8QwasGoBaMWjFowasGoBaMWjFowasGoBaMWDBULAOEDmEyi7UeCAAAAAElFTkSuQmCC',
    'base64',
  );
}
