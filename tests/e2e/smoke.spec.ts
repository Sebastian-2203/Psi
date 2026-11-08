import { expect, test } from '@playwright/test';

// Accept-Language drives the first redirect (ADR-009); es-CO -> /es.
test.use({ locale: 'es-CO' });

test('root redirects to the default locale (es) and responds 200', async ({ page }) => {
  const response = await page.goto('/');
  expect(response?.status()).toBe(200);
  await expect(page).toHaveURL(/\/es$/);
  await expect(page.locator('html')).toHaveAttribute('lang', 'es');
});
