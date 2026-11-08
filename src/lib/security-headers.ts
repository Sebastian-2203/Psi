/**
 * HTTP security headers (SECURITY.md §14 P1-10). Pure and dependency-free: used by
 * next.config.ts (static headers, every response incl. /_next assets) and src/proxy.ts
 * (per-request nonce CSP for documents; strict CSP for /api).
 *
 * Next 16 nonce mechanism (node_modules/next/dist/docs/01-app/02-guides/content-security-policy.md):
 * the proxy puts the CSP on the REQUEST headers; during dynamic rendering Next parses
 * `'nonce-…'` from it and applies the nonce to its framework/page scripts. Every page here is
 * dynamically rendered (see src/app/[locale]/layout.tsx), which nonces require.
 */

export type CspInput = {
  nonce: string;
  /** NEXT_PUBLIC_SUPABASE_URL: Storage (public tenant logos) and Auth origin. */
  supabaseUrl: string;
  /** React dev tooling needs eval in development only. */
  development: boolean;
};

function originOf(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

/** Fresh 128-bit nonce, base64 (Web Crypto; proxy runtime safe). */
export function generateNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/**
 * Document CSP. Styles: `'unsafe-inline'` (no nonce) is a deliberate, documented exception:
 * - React `style={…}` props (Radix positioning, progress bars) render as style ATTRIBUTES,
 *   which a nonce can never allow;
 * - the tenant theme `<style>` (src/components/shared/theme-variables.tsx) is not yet given the
 *   nonce by src/app/[locale]/layout.tsx (branding workstream). Once it is, tighten to
 *   `style-src-elem 'self' 'nonce-…'; style-src-attr 'unsafe-inline'`.
 * CSS cannot execute script; img-src/connect-src/font-src bound what injected CSS could load.
 */
export function buildContentSecurityPolicy({ nonce, supabaseUrl, development }: CspInput): string {
  const supabase = originOf(supabaseUrl);
  const extra = supabase ? ` ${supabase}` : '';
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${development ? " 'unsafe-eval'" : ''}`,
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: blob:${extra}`,
    "font-src 'self'",
    `connect-src 'self'${extra}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "frame-src 'none'",
    "worker-src 'self'",
    "manifest-src 'self'",
  ].join('; ');
}

/** /api responses are never documents to render. */
export const API_CONTENT_SECURITY_POLICY =
  "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'";

export const PERMISSIONS_POLICY = [
  'camera=()',
  'microphone=()',
  'geolocation=()',
  'payment=()',
  'usb=()',
  'serial=()',
  'bluetooth=()',
  'browsing-topics=()',
].join(', ');

/** Two years; no `preload` (a commitment for every subdomain — decide per domain). */
export const HSTS_VALUE = 'max-age=63072000; includeSubDomains';

/**
 * Referrer-Policy per path group. next.config `headers()` OVERRIDES headers set by route
 * handlers (verified in E2E), so /api gets `no-referrer` here (its links can carry one-time
 * tokens) and documents `strict-origin-when-cross-origin`.
 */
export const REFERRER_POLICY = {
  documents: 'strict-origin-when-cross-origin',
  api: 'no-referrer',
} as const;

/** Headers for EVERY response (next.config.ts `headers()`); HSTS only in production. */
export function staticSecurityHeaders(production: boolean): { key: string; value: string }[] {
  const headers = [
    { key: 'X-Content-Type-Options', value: 'nosniff' },
    { key: 'Permissions-Policy', value: PERMISSIONS_POLICY },
    { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
    { key: 'X-Frame-Options', value: 'DENY' },
  ];
  if (production) headers.push({ key: 'Strict-Transport-Security', value: HSTS_VALUE });
  return headers;
}
