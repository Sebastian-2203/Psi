import {
  brandingSchema,
  buildTenantCss,
  resolveBrandTokens,
  type BrandingInput,
} from '@/styles/branding';
import { DEFAULT_BRAND } from '@/styles/default-brand';

/**
 * Server component: emits `[data-tenant="slug"]{...}` CSS variable overrides for a validated
 * branding object (ADR-010, DESIGN_SYSTEM §7). The default brand matches tokens.css, so nothing is
 * emitted for it. Invalid branding is rejected (no output) rather than rendered.
 *
 * TODO(branding): feed with `organization_branding` of the resolved tenant; pass the CSP nonce.
 */
export function ThemeVariables({
  brand = DEFAULT_BRAND,
  nonce,
}: {
  brand?: BrandingInput;
  nonce?: string;
}) {
  const parsed = brandingSchema.safeParse(brand);
  if (!parsed.success) return null;
  const defaults = brandingSchema.parse(DEFAULT_BRAND);
  if (JSON.stringify(parsed.data) === JSON.stringify(defaults)) return null;
  const resolved = resolveBrandTokens(parsed.data);
  if (!resolved.ok) return null;
  const css = buildTenantCss(parsed.data.slug, resolved.value.tokens);
  return <style nonce={nonce}>{css}</style>;
}
