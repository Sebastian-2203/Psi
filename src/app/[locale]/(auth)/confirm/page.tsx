import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { getRouteLocale } from '@/i18n/route-locale';
import { redirect } from '@/i18n/navigation';
import { confirmRecoveryLinkAction } from '@/modules/auth/server/actions';
import { confirmRecoveryLinkSchema } from '@/modules/auth/schemas';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const locale = await getRouteLocale(params);
  const t = await getTranslations({ locale, namespace: 'auth.confirmLink' });
  return { title: t('title') };
}

/**
 * Interstitial for emailed recovery links (P1-12). Rendering this page never consumes the token;
 * only the button (POST to a server action) does, so URL prefetchers/scanners cannot burn it.
 */
export default async function ConfirmLinkPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ token_hash?: string; type?: string }>;
}) {
  const locale = await getRouteLocale(params);
  setRequestLocale(locale);
  const query = await searchParams;
  const parsed = confirmRecoveryLinkSchema.safeParse({
    token_hash: query.token_hash,
    type: query.type,
  });
  if (!parsed.success) redirect({ href: '/forgot-password?error=link', locale });
  const t = await getTranslations('auth.confirmLink');
  return (
    <Card className="w-full">
      <div className="flex flex-col gap-1">
        <h1>{t('title')}</h1>
        <p className="text-sm text-muted-foreground">{t('description')}</p>
      </div>
      <form action={confirmRecoveryLinkAction} className="flex flex-col gap-3">
        <input
          type="hidden"
          name="token_hash"
          value={parsed.success ? parsed.data.token_hash : ''}
        />
        <input type="hidden" name="type" value="recovery" />
        <Button type="submit">{t('submit')}</Button>
      </form>
    </Card>
  );
}
