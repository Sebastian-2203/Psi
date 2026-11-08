import { contrastRatio } from '@/styles/contrast';
import {
  derivePrimary,
  PRIMARY_BACKGROUNDS,
  resolveBrandTokens,
  type BrandTokens,
} from '@/styles/branding';

/**
 * Isomorphic contrast guard for the branding form (ADR-010, BRD-03, DESIGN_SYSTEM §7). The same
 * function runs in the browser (live feedback) and in the server action (the authority).
 *
 * - `brandColor` is decorative: it is never rejected for contrast; the accessible `--primary`
 *   is derived from it (auto-adjusted, reported to the owner).
 * - `functionalColor` is an explicit override used for text/buttons: below 4.5:1 on white or on
 *   a context canvas it is REJECTED with the nearest passing shade (same hue, darker).
 * - `secondaryColor` is used only as an auto-lightened tint with charcoal text.
 */

export type BrandColorsInput = {
  brandColor: string;
  functionalColor?: string | null;
  secondaryColor?: string | null;
};

export type ColorReport = {
  brandColor: string;
  functionalColor: string;
  ratio: number;
  adjusted: boolean;
  secondaryTint: string | null;
};

export type ColorIssue = {
  field: 'functionalColor' | 'brandColor';
  /** Lowest contrast ratio the offending colour reaches on white and the context canvases. */
  ratio: number;
  /** Nearest passing shade (same hue); null when none exists. */
  suggestion: string | null;
};

export type GuardResult =
  { ok: true; report: ColorReport; tokens: BrandTokens } | { ok: false; issues: ColorIssue[] };

export function lowestRatio(hex: string): number {
  return Math.min(
    contrastRatio('#ffffff', hex),
    ...PRIMARY_BACKGROUNDS.map((bg) => contrastRatio(hex, bg)),
  );
}

export function evaluateBrandColors(input: BrandColorsInput): GuardResult {
  const resolved = resolveBrandTokens({
    slug: 'preview',
    displayName: 'Preview',
    brandColor: input.brandColor,
    ...(input.functionalColor ? { functionalColor: input.functionalColor } : {}),
    ...(input.secondaryColor ? { secondaryColor: input.secondaryColor } : {}),
    childModeEnabled: true,
  });
  if (resolved.ok) {
    return {
      ok: true,
      tokens: resolved.value.tokens,
      report: {
        ...resolved.value.report,
        secondaryTint: resolved.value.tokens['--secondary'] ?? null,
      },
    };
  }
  const field = input.functionalColor ? 'functionalColor' : 'brandColor';
  const offending = input.functionalColor ?? input.brandColor;
  return {
    ok: false,
    issues: [
      {
        field,
        ratio: lowestRatio(offending),
        suggestion: derivePrimary(offending)?.primary ?? null,
      },
    ],
  };
}

/** Wire format of a contrast issue inside `fieldErrors` (keys only travel from server to client). */
export function encodeContrastIssue(issue: ColorIssue): string {
  return `contrast:${issue.suggestion ?? '-'}:${issue.ratio.toFixed(2)}`;
}

export function decodeContrastIssue(
  value: string,
): { suggestion: string | null; ratio: string } | null {
  const match = /^contrast:(#[0-9a-f]{6}|-):(\d{1,2}\.\d{2})$/.exec(value);
  if (!match) return null;
  return { suggestion: match[1] === '-' ? null : (match[1] ?? null), ratio: match[2] ?? '' };
}
