import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  assertTextContrast,
  contrastRatio,
  deriveForeground,
  hexToRgb,
  meetsTextContrast,
  relativeLuminance,
} from '@/styles/contrast';

/** Reads the primitives straight from tokens.css so the doc table (DESIGN_SYSTEM §3.3) stays enforced. */
const css = readFileSync('src/styles/tokens.css', 'utf8');
const token = (name: string): string => {
  const m = new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`).exec(css);
  if (!m?.[1]) throw new Error(`token --${name} not found`);
  return m[1];
};

describe('contrast helpers', () => {
  it('computes luminance and ratio extremes', () => {
    expect(relativeLuminance('#ffffff')).toBeCloseTo(1, 5);
    expect(relativeLuminance('#000000')).toBeCloseTo(0, 5);
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 1);
    expect(contrastRatio('#ffffff', '#000000')).toBeCloseTo(21, 1);
  });

  it('expands shorthand and rejects invalid HEX', () => {
    expect(hexToRgb('#fff')).toEqual([255, 255, 255]);
    expect(() => hexToRgb('red')).toThrow();
  });

  it('rejects text pairs below 4.5:1 and accepts the rest', () => {
    expect(() => assertTextContrast('#d94a43', '#ffffff')).toThrow(/below 4.5/);
    expect(assertTextContrast('#a73c37', '#ffffff')).toBeGreaterThan(6);
    expect(meetsTextContrast('#d94a43', '#ffffff')).toBe(false);
  });

  it('derives a readable foreground, preferring white, or null', () => {
    expect(deriveForeground('#a73c37')).toBe('#ffffff');
    expect(deriveForeground('#f8d9a7')).toBe('#292522');
    expect(deriveForeground('#808080')).toBeNull();
  });
});

describe('DESIGN_SYSTEM §3.3 token contrast (from tokens.css)', () => {
  const white = token('neutral-0');
  const cream = token('cream-100');
  const rows: [string, string, string, number][] = [
    ['charcoal on cream', token('charcoal-900'), cream, 14.33],
    ['white on coral-700 (primary button)', white, token('coral-700'), 6.28],
    ['white on coral-600 (child button)', white, token('coral-600'), 5.2],
    ['coral-700 on cream (links)', token('coral-700'), cream, 5.92],
    ['white on destructive', white, token('crimson-700'), 8.01],
    ['brand coral-500 on white (fails text)', token('coral-500'), white, 4.19],
    ['muted text on white', token('neutral-600'), white, 6.2],
    ['input border on cream (UI >= 3)', token('neutral-500'), cream, 3.77],
  ];
  it.each(rows)('%s ≈ %s', (_name, fg, bg, expected) => {
    expect(contrastRatio(fg, bg)).toBeCloseTo(expected, 1);
  });

  it('keeps every functional text pair at >= 4.5:1', () => {
    const textPairs: [string, string][] = [
      [white, token('coral-700')],
      [white, token('coral-600')],
      [white, token('coral-800')],
      [token('coral-700'), token('neutral-50')],
      [token('coral-900'), token('coral-50')],
      [token('crimson-800'), token('crimson-50')],
      [token('green-800'), token('green-50')],
      [token('amber-800'), token('amber-50')],
      [token('bluegray-800'), token('bluegray-100')],
      [token('charcoal-900'), token('pink-300')],
      [token('charcoal-900'), token('peach-300')],
      [token('charcoal-900'), token('bluegray-300')],
    ];
    for (const [fg, bg] of textPairs)
      expect(meetsTextContrast(fg, bg), `${fg} on ${bg}`).toBe(true);
  });
});
