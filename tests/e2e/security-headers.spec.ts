import { expect, test, type Page, type Response } from '@playwright/test';
import { STORAGE_OWNER_PSY_A } from './support/auth';

/**
 * HTTP hardening (SECURITY.md §14 P1-10/P1-11): per-request nonce CSP, static headers,
 * no-store for authenticated documents and /api, and the app still renders and works under the
 * CSP (scripts hydrate, fonts load, tenant theme applies). Any CSP violation fails the test.
 */

function collectCspViolations(page: Page): string[] {
  const violations: string[] = [];
  page.on('console', (msg) => {
    if (/Content Security Policy|Refused to (load|execute|apply)/i.test(msg.text())) {
      violations.push(msg.text());
    }
  });
  return violations;
}

function nonceOf(response: { headers(): Record<string, string> } | null): string {
  const csp = response?.headers()['content-security-policy'] ?? '';
  const match = csp.match(/'nonce-([A-Za-z0-9+/=]+)'/);
  expect(match, `nonce in CSP: ${csp}`).not.toBeNull();
  return match![1] as string;
}

function expectStaticHeaders(response: Response | null) {
  const h = response?.headers() ?? {};
  expect(h['x-content-type-options']).toBe('nosniff');
  expect(h['cross-origin-opener-policy']).toBe('same-origin');
  expect(h['x-frame-options']).toBe('DENY');
  expect(h['permissions-policy']).toContain('camera=()');
  // `pnpm start` is a production build: HSTS is sent (browsers ignore it over http).
  expect(h['strict-transport-security']).toMatch(/^max-age=\d+; includeSubDomains$/);
}

test.describe('anonymous documents', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('sign-in page: nonce CSP, nonce on every script, hydrated form, fonts, no violations', async ({
    page,
  }) => {
    const violations = collectCspViolations(page);
    const response = await page.goto('/es/sign-in');
    expect(response?.status()).toBe(200);
    const h = response!.headers();
    const csp = h['content-security-policy'] ?? '';
    for (const directive of [
      "default-src 'self'",
      "'strict-dynamic'",
      "object-src 'none'",
      "base-uri 'self'",
      "frame-ancestors 'none'",
      "form-action 'self'",
    ]) {
      expect(csp).toContain(directive);
    }
    expect(csp).not.toContain('unsafe-eval');
    expect(h['referrer-policy']).toBe('strict-origin-when-cross-origin');
    expectStaticHeaders(response);

    const nonce = nonceOf(response);
    const scripts = await page
      .locator('script')
      .evaluateAll((els) => els.map((el) => (el as HTMLScriptElement).nonce));
    expect(scripts.length).toBeGreaterThan(0);
    for (const value of scripts) expect(value).toBe(nonce);

    // A second request gets a different nonce.
    expect(nonceOf(await page.request.get('/es/sign-in'))).not.toBe(nonce);

    // React hydrated the form (its scripts ran under the CSP) and fonts loaded.
    await page.waitForFunction(() =>
      Object.keys(document.querySelector('form') ?? {}).some((k) => k.startsWith('__react')),
    );
    await page.evaluate(() => document.fonts.ready);
    expect(await page.evaluate(() => document.fonts.size)).toBeGreaterThan(0);
    expect(violations).toEqual([]);
  });

  test('tenant host: theme variables apply under the CSP', async ({ page }) => {
    const violations = collectCspViolations(page);
    const response = await page.goto('http://demo-b.localhost:3000/es/sign-in');
    expect(response?.status()).toBe(200);
    await expect(page.locator('html')).toHaveAttribute('data-tenant', 'demo-b');
    expect(violations).toEqual([]);
  });

  test('/api: header hygiene, strict CSP, no-store; route-level Referrer-Policy kept', async ({
    request,
  }) => {
    const response = await request.get('/api/auth/confirm/es?type=recovery&token_hash=bogus', {
      maxRedirects: 0,
      headers: { 'x-request-id': 'client-chosen-id-123', 'x-next-intl-locale': 'en' },
    });
    expect(response.status()).toBe(303);
    const h = response.headers();
    expect(h['location']).toContain('/es/forgot-password?error=link');
    expect(h['content-security-policy']).toContain("default-src 'none'");
    expect(h['cache-control']).toContain('no-store');
    expect(h['referrer-policy']).toBe('no-referrer');
    expect(h['x-content-type-options']).toBe('nosniff');
  });

  test('static assets carry nosniff', async ({ page, request }) => {
    await page.goto('/es/sign-in');
    const src = await page.locator('script[src^="/_next/static/"]').first().getAttribute('src');
    expect(src).toBeTruthy();
    const asset = await request.get(src!);
    expect(asset.status()).toBe(200);
    expect(asset.headers()['x-content-type-options']).toBe('nosniff');
  });
});

test.describe('authenticated documents', () => {
  test.use({ storageState: STORAGE_OWNER_PSY_A });

  test('dashboard: no-store, nonce CSP, signed activity cookie, no violations', async ({
    page,
  }) => {
    const violations = collectCspViolations(page);
    const response = await page.goto('/es/dashboard');
    expect(response?.status()).toBe(200);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Inicio de la consulta');
    expect(response!.headers()['cache-control']).toContain('no-store');
    nonceOf(response);
    expectStaticHeaders(response);
    const activity = (await page.context().cookies()).find((c) => c.name === 'psi_activity');
    expect(activity?.value).toMatch(/^v1\./);
    expect(violations).toEqual([]);
  });
});
