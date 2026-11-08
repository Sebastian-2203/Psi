'use server';

import { z } from 'zod';
import { routing } from '@/i18n/routing';
import { getVerifiedClaims } from '@/server/auth/claims';
import { setPreferredLocale } from './locale';

const rememberLocaleSchema = z.object({ locale: z.enum(routing.locales) });

/**
 * Called by the locale switcher. Signed-out visitors are ignored (the URL alone decides);
 * for signed-in users the choice is stored on their profile (I18N-02).
 */
export async function rememberLocaleAction(input: unknown): Promise<void> {
  const parsed = rememberLocaleSchema.safeParse(input);
  if (!parsed.success) return;
  const claims = await getVerifiedClaims();
  if (!claims) return;
  await setPreferredLocale(claims, parsed.data.locale);
}
