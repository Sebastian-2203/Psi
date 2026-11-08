/**
 * Local Mailpit (Supabase CLI `inbucket` service) helpers for auth tests. LOCAL ONLY: every
 * mailbox is a fictional @example.test address.
 */
const LOCAL = new Set(['127.0.0.1', 'localhost']);

function baseUrl(): string {
  const url = process.env.MAIL_DEV_HTTP_URL ?? 'http://127.0.0.1:54324';
  if (!LOCAL.has(new URL(url).hostname)) throw new Error('Mailpit helpers are local-only');
  return url;
}

type MailSummary = { ID: string; Created: string; Subject: string };
export type MailMessage = { ID: string; Subject: string; Text: string; HTML: string };

export async function mailpitAvailable(): Promise<boolean> {
  try {
    const res = await fetch(`${baseUrl()}/api/v1/info`, { signal: AbortSignal.timeout(2000) });
    return res.ok;
  } catch {
    return false;
  }
}

export async function clearMailbox(address: string): Promise<void> {
  await fetch(`${baseUrl()}/api/v1/search?query=${encodeURIComponent(`to:"${address}"`)}`, {
    method: 'DELETE',
  });
}

/** Newest message to `address`, polling up to `timeoutMs`. */
export async function waitForEmail(address: string, timeoutMs = 10_000): Promise<MailMessage> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = await fetch(
      `${baseUrl()}/api/v1/search?query=${encodeURIComponent(`to:"${address}"`)}`,
    );
    const body = (await res.json()) as { messages?: MailSummary[] };
    const first = body.messages?.[0];
    if (first) {
      const msg = await fetch(`${baseUrl()}/api/v1/message/${first.ID}`);
      return (await msg.json()) as MailMessage;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`no email for ${address} within ${timeoutMs} ms`);
}

export async function countEmails(address: string): Promise<number> {
  const res = await fetch(
    `${baseUrl()}/api/v1/search?query=${encodeURIComponent(`to:"${address}"`)}`,
  );
  const body = (await res.json()) as { messages_count?: number; messages?: unknown[] };
  return body.messages?.length ?? 0;
}

/** First URL in a message (HTML href or plain text). */
export function firstLink(message: MailMessage): string {
  const href = message.HTML?.match(/href="([^"]+)"/)?.[1]?.replace(/&amp;/g, '&');
  const text = message.Text?.match(/https?:\/\/\S+/)?.[0];
  const link = href ?? text;
  if (!link) throw new Error('no link in email');
  return link;
}
