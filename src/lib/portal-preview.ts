/**
 * DEV-ONLY static portal preview (no session, no data): on outside production, or with
 * PORTAL_MODE_PREVIEW=1 (Playwright/screenshots on a production build). Phase 1 has no
 * patient/guardian identities, so this preview is the ONLY way to render the portal shell.
 * Remove when portal identities arrive (Phase 2).
 */
export function isPortalPreviewEnabled(): boolean {
  return process.env.NODE_ENV !== 'production' || process.env.PORTAL_MODE_PREVIEW === '1';
}
