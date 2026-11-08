import 'server-only';
import { AppError } from '@/server/errors';
import { env } from '@/server/env';

/**
 * App-sent transactional email (staff invitations, MFA-reset notices). Supabase Auth sends
 * its own emails (password recovery) through its SMTP settings.
 *
 * Transport: LOCAL/TEST ONLY — the Mailpit HTTP send API of the Supabase CLI stack
 * (`MAIL_DEV_HTTP_URL`, loopback hosts only; production builds only with E2E_LOCAL_MAIL=1 for the
 * local Playwright run). A production provider
 * is a new subprocessor (SECURITY.md §3.1 SMTP) and needs an architect decision; until then
 * `sendEmail` fails closed with PRECONDITION_FAILED so no invitation is created without a
 * delivered link.
 *
 * Content rules: no clinical content, no PHI; links carry only opaque tokens.
 */

export type Email = { to: string; subject: string; text: string };

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

function devTransportUrl(): URL | null {
  // Production builds only with the explicit local-E2E flag (playwright.config.ts); loopback only.
  const allowed = env.NODE_ENV !== 'production' || process.env.E2E_LOCAL_MAIL === '1';
  if (!allowed || !env.MAIL_DEV_HTTP_URL) return null;
  const url = new URL(env.MAIL_DEV_HTTP_URL);
  return LOOPBACK.has(url.hostname) ? url : null;
}

export function isEmailDeliveryConfigured(): boolean {
  return devTransportUrl() !== null;
}

export async function sendEmail(email: Email): Promise<void> {
  const base = devTransportUrl();
  if (!base) {
    throw new AppError('PRECONDITION_FAILED', {
      messageKey: 'errors.emailUnavailable',
      detail: 'mail_transport_not_configured',
    });
  }
  const response = await fetch(new URL('/api/v1/send', base), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      From: { Email: env.MAIL_FROM },
      To: [{ Email: email.to }],
      Subject: email.subject,
      Text: email.text,
    }),
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) {
    throw new AppError('INTERNAL', { detail: `mail_send_${response.status}` });
  }
}
