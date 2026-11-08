import { describe, expect, it } from 'vitest';
import {
  brandingSchema,
  buildTenantCss,
  derivePrimary,
  resolveBrandTokens,
  PRIMARY_BACKGROUNDS,
} from '@/styles/branding';
import { contrastRatio } from '@/styles/contrast';
import { DEFAULT_BRAND } from '@/styles/default-brand';

describe('branding schema', () => {
  it('accepts the default brand and normalises HEX case', () => {
    const parsed = brandingSchema.parse({ ...DEFAULT_BRAND, brandColor: '#D94A43' });
    expect(parsed.brandColor).toBe('#d94a43');
  });

  it('rejects CSS-injection attempts in slug and colours', () => {
    expect(brandingSchema.safeParse({ ...DEFAULT_BRAND, slug: 'x"]{}' }).success).toBe(false);
    expect(brandingSchema.safeParse({ ...DEFAULT_BRAND, brandColor: 'red;}' }).success).toBe(false);
    expect(brandingSchema.safeParse({ ...DEFAULT_BRAND, displayName: '' }).success).toBe(false);
  });
});

describe('primary derivation (DESIGN_SYSTEM §7)', () => {
  it('darkens the Daniela brand colour until it passes on white and both canvases', () => {
    const res = derivePrimary('#d94a43');
    expect(res).not.toBeNull();
    expect(res?.adjusted).toBe(true);
    expect(res?.primaryForeground).toBe('#ffffff');
    expect(contrastRatio('#ffffff', res!.primary)).toBeGreaterThanOrEqual(4.5);
    for (const bg of PRIMARY_BACKGROUNDS) {
      expect(contrastRatio(res!.primary, bg)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('keeps a brand colour that already passes', () => {
    const res = derivePrimary('#a73c37');
    expect(res?.primary).toBe('#a73c37');
    expect(res?.adjusted).toBe(false);
  });

  it('always yields an accessible primary, even for very light brand colours', () => {
    for (const color of ['#ffff00', '#f8d9a7', '#aab7c7', '#00ffff', '#ffffff']) {
      const res = derivePrimary(color);
      expect(res, color).not.toBeNull();
      expect(res!.minRatio).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('rejects an explicit functional colour that fails the guard', () => {
    const result = resolveBrandTokens(
      brandingSchema.parse({ ...DEFAULT_BRAND, functionalColor: '#d94a43' }),
    );
    expect(result.ok).toBe(false);
  });

  it('resolves the default brand to the provisional tokens', () => {
    const result = resolveBrandTokens(brandingSchema.parse(DEFAULT_BRAND));
    expect(result.ok && result.value.tokens['--primary']).toBe('#a73c37');
    expect(result.ok && result.value.report.ratio).toBeGreaterThan(5.9);
  });
});

describe('buildTenantCss', () => {
  it('emits tenant + nested-context selectors with validated values only', () => {
    const css = buildTenantCss('acme', { '--primary': '#112233' });
    expect(css).toBe(
      '[data-tenant="acme"],[data-tenant="acme"] [data-context]{--primary:#112233;}',
    );
  });

  it('throws on an unsafe slug or token value', () => {
    expect(() => buildTenantCss('a"b', { '--primary': '#112233' })).toThrow();
    expect(() => buildTenantCss('acme', { '--primary': 'red;}' })).toThrow();
  });
});
