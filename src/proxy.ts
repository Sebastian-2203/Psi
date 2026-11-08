import { createServerClient } from '@supabase/ssr';
import createMiddleware from 'next-intl/middleware';
import { NextResponse, type NextRequest } from 'next/server';
import { routing } from '@/i18n/routing';
import { AUTH_COOKIE_OPTIONS, isAuthCookieName } from '@/lib/auth-cookies';
import { publicEnv } from '@/lib/env.public';
import {
  API_CONTENT_SECURITY_POLICY,
  buildContentSecurityPolicy,
  generateNonce,
} from '@/lib/security-headers';
import {
  ACTIVITY_COOKIE,
  evaluateActivityCookie,
  signActivity,
  usableActivitySecret,
} from '@/lib/session-activity';
import type { SessionExpiry } from '@/lib/session-policy';

const handleI18nRouting = createMiddleware(routing);

/** Inbound headers the server treats as internal: always removed from the client request. */
function isInternalHeader(name: string): boolean {
  return (
    name.startsWith('x-org-') ||
    name === 'x-request-id' ||
    name === 'x-next-intl-locale' ||
    name === 'x-nonce' ||
    name === 'content-security-policy'
  );
}

function isApiPath(pathname: string): boolean {
  return pathname === '/api' || pathname.startsWith('/api/');
}

type PendingCookie = { name: string; value: string; options: Record<string, unknown> };

/**
 * Next 16 `proxy` (Node.js runtime). Kept light: no database access. Runs for pages AND
 * `/api/*` (P1-11); next-intl routing only for pages.
 *
 *   1. Header hygiene (F-16): delete inbound `x-org-*`, `x-request-id`, `x-next-intl-locale`,
 *      `x-nonce`, `content-security-policy`; set a fresh `x-request-id`. The tenant is NOT
 *      forwarded in a header: the server resolves the Host itself (src/server/tenancy/request.ts).
 *   2. CSP (P1-10): documents get a per-request nonce CSP, also set on the forwarded REQUEST so
 *      Next applies the nonce to its scripts (src/lib/security-headers.ts); /api gets a strict
 *      no-content CSP. Static headers (nosniff, HSTS, ...) come from next.config.ts.
 *   3. Session (only when a Supabase auth cookie is present): `getClaims()` verifies the JWT
 *      locally (JWKS) and refreshes it when expired; refreshed cookies are written onto the
 *      forwarded request and the response. Then the lifetime policy (SECURITY.md §3.5, P1-02):
 *      absolute 12 h from sign-in (`amr`), idle 15 min from the HMAC-signed, session-bound
 *      activity cookie; a missing/invalid cookie counts as idle except right after an
 *      authentication (src/lib/session-activity.ts). Expired -> the session is revoked at
 *      Supabase Auth and page GETs are redirected to sign-in; other requests continue without
 *      a session. getVerifiedClaims() re-applies the same check server-side.
 *      Full verification (`getUser`, revocation) happens in src/server/auth/claims.ts.
 *   4. Authenticated and /api responses: `Cache-Control: private, no-store`.
 */
export async function proxy(request: NextRequest) {
  for (const name of Array.from(request.headers.keys())) {
    if (isInternalHeader(name)) request.headers.delete(name);
  }
  request.headers.set('x-request-id', crypto.randomUUID());

  const api = isApiPath(request.nextUrl.pathname);
  let csp = API_CONTENT_SECURITY_POLICY;
  if (!api) {
    const nonce = generateNonce();
    csp = buildContentSecurityPolicy({
      nonce,
      supabaseUrl: publicEnv.NEXT_PUBLIC_SUPABASE_URL,
      development: process.env.NODE_ENV === 'development',
    });
    request.headers.set('x-nonce', nonce);
    request.headers.set('content-security-policy', csp);
  }

  const pending: PendingCookie[] = [];
  const pendingHeaders: Record<string, string> = {};
  let activityCookie: string | null = null;
  let authenticated = false;
  let expiry: SessionExpiry = 'active';

  if (request.cookies.getAll().some((c) => isAuthCookieName(c.name))) {
    const supabase = createServerClient(
      publicEnv.NEXT_PUBLIC_SUPABASE_URL,
      publicEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      {
        cookieOptions: AUTH_COOKIE_OPTIONS,
        cookies: {
          getAll: () => request.cookies.getAll(),
          setAll: (toSet, headers) => {
            for (const { name, value } of toSet) request.cookies.set(name, value);
            pending.push(...toSet);
            Object.assign(pendingHeaders, headers);
          },
        },
      },
    );
    const { data } = await supabase.auth.getClaims();
    const claims = data?.claims;
    if (claims) {
      const now = Math.floor(Date.now() / 1000);
      // Missing/short secret -> null -> only the fresh-auth grace applies (fail closed).
      const secret = usableActivitySecret(process.env.SESSION_ACTIVITY_SECRET);
      expiry = await evaluateActivityCookie({
        secret,
        cookieValue: request.cookies.get(ACTIVITY_COOKIE)?.value,
        claims,
        now,
      });
      if (expiry === 'active') {
        authenticated = true;
        if (secret && typeof claims.session_id === 'string') {
          activityCookie = await signActivity(secret, claims.session_id, now);
          // Server code in this request (getVerifiedClaims) sees the refreshed value.
          request.cookies.set(ACTIVITY_COOKIE, activityCookie);
        }
      } else {
        // Revokes this session's refresh token; setAll() clears the cookies on both sides.
        await supabase.auth.signOut({ scope: 'local' });
        request.cookies.delete(ACTIVITY_COOKIE);
      }
    }
  }

  let response: NextResponse;
  const segment = request.nextUrl.pathname.split('/')[1] ?? '';
  const locale = routing.locales.find((l) => l === segment) ?? routing.defaultLocale;
  if (!api && expiry !== 'active' && request.method === 'GET') {
    const url = request.nextUrl.clone();
    url.pathname = `/${locale}/sign-in`;
    url.search = `?expired=${expiry}`;
    response = NextResponse.redirect(url, 303);
  } else if (api) {
    response = NextResponse.next({ request: { headers: request.headers } });
  } else {
    response = handleI18nRouting(request);
  }

  for (const { name, value, options } of pending) response.cookies.set(name, value, options);
  for (const [key, value] of Object.entries(pendingHeaders)) response.headers.set(key, value);
  if (activityCookie) {
    response.cookies.set(ACTIVITY_COOKIE, activityCookie, { ...AUTH_COOKIE_OPTIONS });
  } else if (!authenticated && (request.cookies.has(ACTIVITY_COOKIE) || expiry !== 'active')) {
    response.cookies.delete(ACTIVITY_COOKIE);
  }
  response.headers.set('Content-Security-Policy', csp);
  if (authenticated || api) response.headers.set('Cache-Control', 'private, no-store');
  return response;
}

export const config = {
  // Pages and /api (P1-11); skips Next internals and files with an extension.
  matcher: ['/((?!trpc|_next|_vercel|.*\\..*).*)'],
};
