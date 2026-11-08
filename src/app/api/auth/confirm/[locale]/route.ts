import { NextResponse, type NextRequest } from 'next/server';
import { isLocale } from '@/i18n/routing';
import { confirmRecoveryToken } from '@/server/auth/password';
import { createRequestAuthClient } from '@/server/auth/supabase';

export const dynamic = 'force-dynamic';

/**
 * Email link handler (password recovery only; sign-ups are disabled). Exchanges the single-use
 * token_hash for a session on the server (httpOnly cookies) and redirects within this host.
 * The token never reaches client JavaScript; the response is not cacheable and sends no Referer.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ locale: string }> },
) {
  const { locale: raw } = await params;
  const locale = isLocale(raw) ? raw : 'es';
  const tokenHash = request.nextUrl.searchParams.get('token_hash') ?? '';
  const type = request.nextUrl.searchParams.get('type');

  const ok =
    type === 'recovery' && (await confirmRecoveryToken(await createRequestAuthClient(), tokenHash));
  const target = new URL(
    ok ? `/${locale}/reset-password` : `/${locale}/forgot-password?error=link`,
    request.nextUrl.origin,
  );
  const response = NextResponse.redirect(target, 303);
  response.headers.set('Cache-Control', 'private, no-store');
  response.headers.set('Referrer-Policy', 'no-referrer');
  return response;
}
