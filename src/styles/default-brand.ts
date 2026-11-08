import type { Branding } from './branding';

/**
 * Default brand = provisional Daniela Ortega tokens (BRAND_GUIDELINES, DESIGN_SYSTEM §2.1).
 * The values equal tokens.css, so ThemeVariables emits nothing for it.
 * TODO(branding): replaced by `organization_branding` once the tenant/branding workstream lands.
 * Display name decided by the client on 2026-11-08.
 */
export const DEFAULT_BRAND: Branding = {
  slug: 'daniela-ortega',
  displayName: 'Psicóloga Daniela Ortega',
  brandColor: '#d94a43', // decorative; fails 4.5:1 as text (4.19)
  functionalColor: '#a73c37', // logo ink, 6.28:1 on white
  childModeEnabled: true,
};
