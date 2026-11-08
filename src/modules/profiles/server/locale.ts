import 'server-only';

import { routing, type Locale } from '@/i18n/routing';
import type { VerifiedClaims } from '@/server/auth/claims';
import { withUserTransaction } from '@/server/db/server';

function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (routing.locales as readonly string[]).includes(value);
}

/**
 * The signed-in user's stored interface language (I18N-02), read as the user (RLS: own profile
 * only, available at aal1). Returns null when the user never chose one, so callers keep the
 * locale of the current URL.
 */
export async function getPreferredLocale(claims: VerifiedClaims): Promise<Locale | null> {
  const [row] = await withUserTransaction(
    claims,
    (tx) => tx<{ locale: string | null }[]>`
      select locale from public.profiles where id = ${claims.sub}::uuid
    `,
  );
  return isLocale(row?.locale) ? row.locale : null;
}

/** Persists the user's interface language. RLS allows updating only the caller's own row. */
export async function setPreferredLocale(claims: VerifiedClaims, locale: Locale): Promise<void> {
  await withUserTransaction(
    claims,
    (tx) => tx`
      update public.profiles set locale = ${locale} where id = ${claims.sub}::uuid
    `,
  );
}
