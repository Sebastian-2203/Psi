import { z } from 'zod';
import {
  AA_NORMAL_TEXT,
  contrastRatio,
  deriveForeground,
  hexToRgb,
  meetsTextContrast,
  rgbToHex,
} from './contrast';

/**
 * White-label branding (DESIGN_SYSTEM §7, ADR-010). Pure TS: validates the branding object,
 * derives accessible functional shades from the brand colour and returns CSS variable values.
 * The database/table behind it arrives with the tenancy workstream.
 */

/** Backgrounds the functional primary must reach 4.5:1 on (cream portal canvas, professional canvas). */
export const PRIMARY_BACKGROUNDS = ['#fff9d9', '#faf8f3', '#ffffff'] as const;
const CHARCOAL = '#292522';

const hex = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, 'Expected a #RRGGBB colour')
  .transform((v) => v.toLowerCase());

export const brandingSchema = z.object({
  /** Tenant slug used in `[data-tenant="slug"]`. Restricted charset: no CSS injection. */
  slug: z.string().regex(/^[a-z0-9](?:[a-z0-9-]{0,40}[a-z0-9])?$/),
  displayName: z.string().trim().min(1).max(80),
  /** Decorative brand colour (used like coral-500). */
  brandColor: hex,
  /** Optional explicit functional colour (e.g. logo ink); still contrast-checked. */
  functionalColor: hex.optional(),
  secondaryColor: hex.optional(),
  accentColor: hex.optional(),
  childModeEnabled: z.boolean().default(true),
});

export type Branding = z.infer<typeof brandingSchema>;
export type BrandingInput = z.input<typeof brandingSchema>;

/* ---------------------------------- OKLCH helpers ---------------------------------- */

type Oklch = { l: number; c: number; h: number };

const toLinear = (c: number) => {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};
const fromLinear = (v: number) => {
  const c = Math.min(1, Math.max(0, v));
  return 255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);
};

function hexToOklch(value: string): Oklch {
  const [r, g, b] = hexToRgb(value).map(toLinear) as [number, number, number];
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return { l: L, c: Math.hypot(A, B), h: (Math.atan2(B, A) * 180) / Math.PI };
}

function oklchToHex({ l, c, h }: Oklch): string {
  const rad = (h * Math.PI) / 180;
  const A = c * Math.cos(rad);
  const B = c * Math.sin(rad);
  const lp = (l + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const mp = (l - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const sp = (l - 0.0894841775 * A - 1.291485548 * B) ** 3;
  const r = 4.0767416621 * lp - 3.3077115913 * mp + 0.2309699292 * sp;
  const g = -1.2684380046 * lp + 2.6097574011 * mp - 0.3413193965 * sp;
  const b = -0.0041960863 * lp - 0.7034186147 * mp + 1.707614701 * sp;
  return rgbToHex([fromLinear(r), fromLinear(g), fromLinear(b)]);
}

/* ---------------------------------- Guard + derivation ---------------------------------- */

export type PrimaryResolution = {
  primary: string;
  primaryHover: string;
  primaryForeground: string;
  /** Lowest ratio of the primary against white and the context canvases. */
  minRatio: number;
  /** True when the tenant colour had to be darkened to pass. */
  adjusted: boolean;
};

function passesAsPrimary(candidate: string): boolean {
  return (
    meetsTextContrast('#ffffff', candidate) &&
    PRIMARY_BACKGROUNDS.every((bg) => meetsTextContrast(candidate, bg))
  );
}

function minRatio(candidate: string): number {
  return Math.min(
    contrastRatio('#ffffff', candidate),
    ...PRIMARY_BACKGROUNDS.map((bg) => contrastRatio(candidate, bg)),
  );
}

/** Darkens a colour in OKLCH (same hue) by `delta` lightness. */
function darken(value: string, delta: number): string {
  const { l, c, h } = hexToOklch(value);
  return oklchToHex({ l: Math.max(0, l - delta), c, h });
}

/**
 * DESIGN_SYSTEM §7 step 3: the lightest step S (starting from the brand colour itself) such that
 * white-on-S >= 4.5 and S on each canvas >= 4.5. Returns null when nothing in the ramp passes
 * (cannot happen for sane inputs since the ramp reaches near-black).
 */
export function derivePrimary(brandColor: string): PrimaryResolution | null {
  const start = hexToOklch(brandColor);
  for (let i = 0; i <= 60; i++) {
    const candidate = i === 0 ? brandColor : oklchToHex({ ...start, l: start.l - i * 0.01 });
    if (!passesAsPrimary(candidate)) continue;
    const primaryForeground = deriveForeground(candidate, { dark: CHARCOAL });
    if (!primaryForeground) return null;
    return {
      primary: candidate,
      primaryHover: darken(candidate, 0.07),
      primaryForeground,
      minRatio: minRatio(candidate),
      adjusted: i > 0,
    };
  }
  return null;
}

/** Lightens a colour toward a tint until charcoal text on it is >= 4.5:1 (step 6). */
export function deriveTint(value: string): string {
  const base = hexToOklch(value);
  let tint = oklchToHex({ l: Math.max(base.l, 0.93), c: base.c * 0.25, h: base.h });
  for (let l = 0.93; l <= 0.99 && !meetsTextContrast(CHARCOAL, tint); l += 0.01) {
    tint = oklchToHex({ l, c: base.c * 0.2, h: base.h });
  }
  return tint;
}

export type BrandTokens = Record<`--${string}`, string>;

export type ResolvedBrand = {
  tokens: BrandTokens;
  /** Values for the branding settings UI ("Color funcional #A73C37 · contraste 6.3:1"). */
  report: { brandColor: string; functionalColor: string; ratio: number; adjusted: boolean };
};

/**
 * Resolves branding into CSS variable overrides. Tenants override only the primary family,
 * secondary, accent and brand (status colours, foreground, input are platform-controlled).
 * Returns an error string when an explicit functionalColor fails the guard (reject, never render).
 */
export function resolveBrandTokens(
  brand: Branding,
): { ok: true; value: ResolvedBrand } | { ok: false; error: string } {
  if (brand.functionalColor && !passesAsPrimary(brand.functionalColor)) {
    return {
      ok: false,
      error: `functionalColor ${brand.functionalColor} is below ${AA_NORMAL_TEXT}:1 on a required surface`,
    };
  }
  const resolved = brand.functionalColor
    ? {
        primary: brand.functionalColor,
        primaryHover: darken(brand.functionalColor, 0.07),
        primaryForeground: deriveForeground(brand.functionalColor, { dark: CHARCOAL }) ?? '#ffffff',
        minRatio: minRatio(brand.functionalColor),
        adjusted: false,
      }
    : derivePrimary(brand.brandColor);
  if (!resolved) return { ok: false, error: 'No accessible primary could be derived' };

  const tokens: BrandTokens = {
    '--brand': brand.brandColor,
    '--primary': resolved.primary,
    '--primary-hover': resolved.primaryHover,
    '--primary-foreground': resolved.primaryForeground,
    '--ring': resolved.primary,
  };
  if (brand.secondaryColor) {
    tokens['--secondary'] = deriveTint(brand.secondaryColor);
    tokens['--secondary-foreground'] = CHARCOAL;
  }
  if (brand.accentColor) {
    tokens['--accent'] = deriveTint(brand.accentColor);
    tokens['--accent-foreground'] = CHARCOAL;
  }
  return {
    ok: true,
    value: {
      tokens,
      report: {
        brandColor: brand.brandColor,
        functionalColor: resolved.primary,
        ratio: resolved.minRatio,
        adjusted: resolved.adjusted,
      },
    },
  };
}

/**
 * Builds the tenant stylesheet. Only validated token values are interpolated (slug and HEX are
 * regex-constrained), so no arbitrary CSS can enter. The second selector out-specifies
 * `[data-context]` blocks so tenant values win inside any context.
 */
export function buildTenantCss(slug: string, tokens: BrandTokens): string {
  if (!/^[a-z0-9](?:[a-z0-9-]{0,40}[a-z0-9])?$/.test(slug)) throw new Error('Invalid tenant slug');
  const body = Object.entries(tokens)
    .map(([k, v]) => {
      if (!/^#[0-9a-f]{6}$/.test(v)) throw new Error(`Invalid token value for ${k}`);
      return `${k}:${v};`;
    })
    .join('');
  return `[data-tenant="${slug}"],[data-tenant="${slug}"] [data-context]{${body}}`;
}
