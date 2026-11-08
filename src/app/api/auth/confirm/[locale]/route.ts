import { NextResponse, type NextRequest } from 'next/server';
import { isLocale } from '@/i18n/routing';

export const dynamic = 'force-dynamic';

const TOKEN_SHAPE = /^[A-Za-z0-9_-]{16,128}$/;

/**
 * Email link entry point (password recovery only; sign-ups are disabled). P1-12: a GET must NOT
 * consume the single-use token (email security scanners and link previews prefetch URLs). This
 * handler only validates the shape and redirects within this host to the interstitial page
 * (/<locale>/confirm), where the user presses a button; that POST (a server action) exchanges the
 * token for a session in httpOnly cookies. Not cacheable; sends no Referer.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ locale: string }> },
) {
  const { locale: raw } = await params;
  const locale = isLocale(raw) ? raw : 'es';
  const tokenHash = request.nextUrl.searchParams.get('token_hash') ?? '';
  const type = request.nextUrl.searchParams.get('type');

  const valid = type === 'recovery' && TOKEN_SHAPE.test(tokenHash);
  const target = new URL(
    valid ? `/${locale}/confirm` : `/${locale}/forgot-password?error=link`,
    request.nextUrl.origin,
  );
  if (valid) {
    target.searchParams.set('token_hash', tokenHash);
    target.searchParams.set('type', 'recovery');
  }
  const response = NextResponse.redirect(target, 303);
  response.headers.set('Cache-Control', 'private, no-store');
  response.headers.set('Referrer-Policy', 'no-referrer');
  return response;
}
