import { createServerClient } from '@supabase/ssr';
import createMiddleware from 'next-intl/middleware';
import { NextResponse, type NextRequest } from 'next/server';
import { routing } from '@/i18n/routing';
import { AUTH_COOKIE_OPTIONS, isAuthCookieName } from '@/lib/auth-cookies';
import { publicEnv } from '@/lib/env.public';
import {
  ACTIVITY_COOKIE,
  evaluateSessionExpiry,
  sessionStartedAt,
  type SessionExpiry,
} from '@/lib/session-policy';

const handleI18nRouting = createMiddleware(routing);

/** Inbound headers the server treats as internal: always removed from the client request. */
function isInternalHeader(name: string): boolean {
  return name.startsWith('x-org-') || name === 'x-request-id' || name === 'x-next-intl-locale';
}

type PendingCookie = { name: string; value: string; options: Record<string, unknown> };

/**
 * Next 16 `proxy` (Node.js runtime). Kept light: no database access.
 *
 *   1. Header hygiene (F-16): delete inbound `x-org-*`, `x-request-id`, `x-next-intl-locale`;
 *      set a fresh `x-request-id`. The tenant is NOT forwarded in a header: the server resolves
 *      the Host itself (src/server/tenancy/request.ts), next to the authorization check.
 *   2. Session (only when a Supabase auth cookie is present): `getClaims()` verifies the JWT
 *      locally (JWKS) and refreshes it when expired; refreshed cookies are written onto the
 *      forwarded request (so Server Components see the new token and never refresh again) and
 *      onto the response. Then the session lifetime policy (SECURITY.md §3.5): absolute 12 h
 *      from sign-in (`amr`), idle 15 min (httpOnly activity cookie). Expired -> the session is
 *      revoked at Supabase Auth and GET requests are redirected to sign-in.
 *      Full verification (`getUser`, revocation) happens server-side in src/server/auth/claims.ts.
 *   3. next-intl locale routing; its response receives the cookie/header mutations of step 2.
 */
export async function proxy(request: NextRequest) {
  for (const name of Array.from(request.headers.keys())) {
    if (isInternalHeader(name)) request.headers.delete(name);
  }
  request.headers.set('x-request-id', crypto.randomUUID());

  const pending: PendingCookie[] = [];
  const pendingHeaders: Record<string, string> = {};
  let hasSession = false;
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
      const lastRaw = Number(request.cookies.get(ACTIVITY_COOKIE)?.value);
      const last = Number.isInteger(lastRaw) && lastRaw > 0 && lastRaw <= now + 60 ? lastRaw : null;
      expiry = evaluateSessionExpiry(sessionStartedAt(claims), last, now);
      if (expiry === 'active') {
        hasSession = true;
      } else {
        // Revokes this session's refresh token; setAll() clears the cookies on both sides.
        await supabase.auth.signOut({ scope: 'local' });
      }
    }
  }

  let response: NextResponse;
  const segment = request.nextUrl.pathname.split('/')[1] ?? '';
  const locale = routing.locales.find((l) => l === segment) ?? routing.defaultLocale;
  if (expiry !== 'active' && request.method === 'GET') {
    const url = request.nextUrl.clone();
    url.pathname = `/${locale}/sign-in`;
    url.search = `?expired=${expiry}`;
    response = NextResponse.redirect(url, 303);
  } else {
    response = handleI18nRouting(request);
  }

  for (const { name, value, options } of pending) response.cookies.set(name, value, options);
  for (const [key, value] of Object.entries(pendingHeaders)) response.headers.set(key, value);
  if (hasSession) {
    response.cookies.set(ACTIVITY_COOKIE, String(Math.floor(Date.now() / 1000)), {
      ...AUTH_COOKIE_OPTIONS,
    });
    response.headers.set('Cache-Control', 'private, no-store');
  } else if (request.cookies.has(ACTIVITY_COOKIE)) {
    response.cookies.delete(ACTIVITY_COOKIE);
  }
  return response;
}

export const config = {
  // Skip API routes, Next internals and files with an extension.
  matcher: ['/((?!api|trpc|_next|_vercel|.*\\..*).*)'],
};
