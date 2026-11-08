import { describe, expect, it } from 'vitest';
import {
  decodeContrastIssue,
  encodeContrastIssue,
  evaluateBrandColors,
} from '@/modules/branding/lib/contrast-guard';
import { updateBrandingSchema } from '@/modules/branding/schemas';
import { contrastRatio } from '@/styles/contrast';

describe('evaluateBrandColors (contrast guard, BRD-03)', () => {
  it('Daniela brand: decorative #d94a43 is adjusted to the functional #a73c37', () => {
    const result = evaluateBrandColors({ brandColor: '#d94a43' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.report.adjusted).toBe(true);
    expect(contrastRatio('#ffffff', result.report.functionalColor)).toBeGreaterThanOrEqual(4.5);
    expect(result.tokens['--brand']).toBe('#d94a43');
  });

  it('accepts an explicit functional colour that passes', () => {
    const result = evaluateBrandColors({ brandColor: '#d94a43', functionalColor: '#a73c37' });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.tokens['--primary']).toBe('#a73c37');
  });

  it('rejects a low-contrast functional colour and suggests a passing shade', () => {
    const result = evaluateBrandColors({ brandColor: '#d94a43', functionalColor: '#ffcc00' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const [issue] = result.issues;
    expect(issue?.field).toBe('functionalColor');
    expect(issue?.ratio).toBeLessThan(4.5);
    expect(issue?.suggestion).toMatch(/^#[0-9a-f]{6}$/);
    // The suggestion itself passes the guard.
    const retry = evaluateBrandColors({
      brandColor: '#d94a43',
      functionalColor: issue?.suggestion ?? '',
    });
    expect(retry.ok).toBe(true);
  });

  it('suggestions are pure: white as functional colour is rejected with a grey that passes', () => {
    const result = evaluateBrandColors({ brandColor: '#2f7d6d', functionalColor: '#ffffff' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues[0]?.suggestion).toBeTruthy();
  });

  it('turns a secondary colour into a tint with charcoal text', () => {
    const result = evaluateBrandColors({ brandColor: '#5b4b8a', secondaryColor: '#e8c46b' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.report.secondaryTint).toBe(result.tokens['--secondary']);
    expect(
      contrastRatio('#292522', result.tokens['--secondary'] ?? '#000000'),
    ).toBeGreaterThanOrEqual(4.5);
  });
});

describe('contrast issue wire format', () => {
  it('round-trips and rejects anything else', () => {
    const encoded = encodeContrastIssue({
      field: 'functionalColor',
      ratio: 1.6789,
      suggestion: '#a73c37',
    });
    expect(encoded).toBe('contrast:#a73c37:1.68');
    expect(decodeContrastIssue(encoded)).toEqual({ suggestion: '#a73c37', ratio: '1.68' });
    expect(decodeContrastIssue('contrast:-:3.00')).toEqual({ suggestion: null, ratio: '3.00' });
    expect(decodeContrastIssue('contrast:javascript:1')).toBeNull();
    expect(decodeContrastIssue('colorInvalid')).toBeNull();
  });
});

describe('updateBrandingSchema', () => {
  const base = {
    displayName: '  Consultorio Demo  ',
    brandColor: '#D94A43',
    functionalColor: '',
    secondaryColor: '',
    expectedUpdatedAt: '2026-11-08 10:00:00.123456+00',
  };

  it('trims, lowercases hex and maps empty optionals to null', () => {
    const parsed = updateBrandingSchema.parse(base);
    expect(parsed).toMatchObject({
      displayName: 'Consultorio Demo',
      brandColor: '#d94a43',
      functionalColor: null,
      secondaryColor: null,
    });
  });

  it('rejects bad colours, long names, unknown keys and a missing version', () => {
    expect(updateBrandingSchema.safeParse({ ...base, brandColor: 'red' }).success).toBe(false);
    expect(
      updateBrandingSchema.safeParse({ ...base, brandColor: 'url(javascript:1)' }).success,
    ).toBe(false);
    expect(updateBrandingSchema.safeParse({ ...base, secondaryColor: '#12345' }).success).toBe(
      false,
    );
    expect(updateBrandingSchema.safeParse({ ...base, displayName: 'x'.repeat(81) }).success).toBe(
      false,
    );
    expect(updateBrandingSchema.safeParse({ ...base, displayName: '   ' }).success).toBe(false);
    expect(updateBrandingSchema.safeParse({ ...base, expectedUpdatedAt: '' }).success).toBe(false);
    expect(updateBrandingSchema.safeParse({ ...base, organizationId: 'x' }).success).toBe(false);
  });
});
