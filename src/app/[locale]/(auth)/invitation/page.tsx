import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Card } from '@/components/ui/card';
import { getRouteLocale } from '@/i18n/route-locale';
import { AcceptInvitation } from '@/modules/auth';
import { acceptInvitationAction, previewInvitationAction } from '@/modules/auth/server/actions';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const locale = await getRouteLocale(params);
  const t = await getTranslations({ locale, namespace: 'auth.invitation' });
  // SECURITY.md §3.8 point 5: no Referer from this page.
  return { title: t('title'), referrer: 'no-referrer' as const };
}

/** The token lives in the URL fragment; the client component moves it into POST bodies. */
export default async function InvitationPage({ params }: { params: Promise<{ locale: string }> }) {
  const locale = await getRouteLocale(params);
  setRequestLocale(locale);
  const t = await getTranslations('auth.invitation');
  return (
    <Card className="w-full">
      <h1>{t('title')}</h1>
      <AcceptInvitation
        previewAction={previewInvitationAction}
        acceptAction={acceptInvitationAction}
      />
    </Card>
  );
}
