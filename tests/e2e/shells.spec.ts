import { expect, test } from '@playwright/test';

test.describe('i18n', () => {
  test('es and en render with the right lang and copy', async ({ page }) => {
    await page.goto('/es/sign-in');
    await expect(page.locator('html')).toHaveAttribute('lang', 'es');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Te damos la bienvenida');
    await page.goto('/en/sign-in');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Welcome');
  });

  test('locale switcher keeps the current page', async ({ page }) => {
    await page.goto('/es/dashboard');
    await page.getByRole('link', { name: /Cambiar el idioma a English/ }).click();
    await expect(page).toHaveURL(/\/en\/dashboard$/);
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Practice home');
  });

  test('unknown paths render the localized not-found page', async ({ page }) => {
    await page.goto('/en/does-not-exist');
    await expect(page.getByText('We could not find this page')).toBeVisible();
    await page.goto('/es/no-existe');
    await expect(page.getByText('No encontramos esta página')).toBeVisible();
  });
});

test.describe('auth placeholder', () => {
  test('sign-in has disabled fields, the practice name and the SyV footer', async ({ page }) => {
    await page.goto('/es/sign-in');
    await expect(page.getByLabel('Correo electrónico')).toBeDisabled();
    await expect(page.getByLabel('Contraseña')).toBeDisabled();
    await expect(page.getByText('Psicóloga Daniela Ortega')).toBeVisible();
    await expect(page.getByText('Con tecnología de SyV Solutions')).toBeVisible();
    await expect(page.locator('[data-context="portal-adult"]')).toHaveCount(1);
  });
});

test.describe('professional shell', () => {
  test('desktop: sidebar visible, context professional, skip link first', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/es/dashboard');
    await expect(page.locator('[data-context="professional"]')).toHaveCount(1);
    await expect(page.getByRole('navigation', { name: 'Navegación principal' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Abrir menú' })).toBeHidden();
    await page.keyboard.press('Tab');
    await expect(page.getByRole('link', { name: 'Saltar al contenido' })).toBeFocused();
    await expect(page.getByRole('main')).toBeVisible();
  });

  test('desktop: sidebar can be collapsed', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/en/dashboard');
    const aside = page.locator('aside');
    await expect(aside).toHaveCSS('width', '264px');
    await page.getByRole('button', { name: 'Collapse the sidebar' }).click();
    await expect(aside).toHaveCSS('width', '72px');
  });

  test('mobile: sidebar hidden, menu opens a sheet with navigation', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/es/dashboard');
    await expect(page.locator('aside')).toBeHidden();
    await page.getByRole('button', { name: 'Abrir menú' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('link', { name: 'Inicio' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    // no horizontal scroll
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    );
    expect(overflow).toBe(false);
  });
});

test.describe('portal contexts', () => {
  test('adult is the default and uses portal-adult', async ({ page }) => {
    await page.goto('/es/portal');
    await expect(page.locator('[data-context="portal-adult"]')).toHaveCount(1);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Te damos la bienvenida');
  });

  test('?mode=child switches to portal-child with a mobile bottom nav of 3 items', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/es/portal?mode=child');
    await expect(page.locator('[data-context="portal-child"]')).toHaveCount(1);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('¡Hola! Qué bueno verte');
    const bottomNav = page.getByRole('navigation', { name: 'Navegación del portal' }).last();
    await expect(bottomNav.getByRole('listitem')).toHaveCount(3);
    const radius = await page
      .locator('[data-context="portal-child"]')
      .evaluate((el) => getComputedStyle(el).getPropertyValue('--radius').trim());
    expect(radius).toBe('1.125rem');
  });
});
