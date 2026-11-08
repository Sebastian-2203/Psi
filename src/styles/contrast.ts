/**
 * WCAG 2.x colour helpers (pure, no I/O). Used by the white-label contrast guard
 * (DESIGN_SYSTEM §7) and by the token contrast tests (§9).
 */

export type Rgb = readonly [number, number, number];

const HEX_RE = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

export function isHexColor(value: string): boolean {
  return HEX_RE.test(value);
}

/** Parses #rgb / #rrggbb into 0-255 channels. Throws on invalid input. */
export function hexToRgb(hex: string): Rgb {
  if (!isHexColor(hex)) throw new Error(`Invalid HEX colour: ${hex}`);
  let h = hex.slice(1);
  if (h.length === 3) h = [...h].map((c) => c + c).join('');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

export function rgbToHex([r, g, b]: Rgb): string {
  const to = (n: number) =>
    Math.round(Math.min(255, Math.max(0, n)))
      .toString(16)
      .padStart(2, '0');
  return `#${to(r)}${to(g)}${to(b)}`;
}

/** WCAG relative luminance of an sRGB colour. */
export function relativeLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio, 1..21. Symmetric. */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

export const AA_NORMAL_TEXT = 4.5;
export const AA_LARGE_TEXT_OR_UI = 3;

/** True when a text pair meets WCAG AA for normal text (>= 4.5:1). */
export function meetsTextContrast(fg: string, bg: string): boolean {
  return contrastRatio(fg, bg) >= AA_NORMAL_TEXT;
}

/**
 * Guard for a text/background pair. Rejects (throws) below 4.5:1 so an invalid palette is never
 * rendered or saved (ADR-010).
 */
export function assertTextContrast(fg: string, bg: string): number {
  const ratio = contrastRatio(fg, bg);
  if (ratio < AA_NORMAL_TEXT) {
    throw new Error(
      `Contrast ${ratio.toFixed(2)}:1 for ${fg} on ${bg} is below ${AA_NORMAL_TEXT}:1`,
    );
  }
  return ratio;
}

/**
 * Picks the foreground (white or charcoal) that reaches >= 4.5:1 on `bg`, preferring white.
 * Returns null when neither passes.
 */
export function deriveForeground(
  bg: string,
  options: { light?: string; dark?: string } = {},
): string | null {
  const { light = '#ffffff', dark = '#292522' } = options;
  if (meetsTextContrast(light, bg)) return light;
  if (meetsTextContrast(dark, bg)) return dark;
  return null;
}
