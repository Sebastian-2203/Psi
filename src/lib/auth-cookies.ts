/**
 * Supabase SSR cookie options (SECURITY.md §3.5, ADR-017/F-16). No secrets here.
 * - httpOnly: there is NO browser Supabase client; every auth call runs on the server.
 * - host-only: no `domain` attribute, so a session never spans tenant subdomains.
 * - Secure in production; SameSite=Lax; lifetime capped at the absolute session limit.
 */
import { SESSION_POLICY } from './session-policy';

export const AUTH_COOKIE_OPTIONS = {
  path: '/',
  sameSite: 'lax',
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  maxAge: SESSION_POLICY.staff.absoluteSeconds,
} as const;

/** Supabase SSR session cookies are `sb-<ref>-auth-token` (optionally chunked `.0`, `.1`, ...). */
export function isAuthCookieName(name: string): boolean {
  return name.startsWith('sb-') && name.includes('-auth-token');
}
