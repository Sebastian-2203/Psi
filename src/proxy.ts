import createMiddleware from 'next-intl/middleware';
import type { NextRequest } from 'next/server';
import { routing } from '@/i18n/routing';

const handleI18nRouting = createMiddleware(routing);

/**
 * Next 16 `proxy` (formerly `middleware`). Request pipeline, in order:
 *
 *   1. [NEXT, auth workstream] strip inbound `x-org-*` headers, refresh the Supabase session cookies.
 *   2. [NEXT, tenancy workstream] resolve host -> organization hint (ADR-017); set the hint header.
 *   3. next-intl locale routing (this step, implemented now).
 *
 * COMPOSITION POINT: steps 1-2 must run before `handleI18nRouting` and forward their cookie/header
 * mutations onto the response it returns. Do not add them here without the security review.
 */
export function proxy(request: NextRequest) {
  return handleI18nRouting(request);
}

export const config = {
  // Skip API routes, Next internals and files with an extension.
  matcher: ['/((?!api|trpc|_next|_vercel|.*\\..*).*)'],
};
