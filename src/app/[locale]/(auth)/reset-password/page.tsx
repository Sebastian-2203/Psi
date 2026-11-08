import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { getRouteLocale } from '@/i18n/route-locale';
import { Link, redirect } from '@/i18n/navigation';
import { ResetPasswordForm } from '@/modules/auth';
import { resetPasswordAction } from '@/modules/auth/server/actions';
import { getAuthPageState } from '@/server/auth/session';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const locale = await getRouteLocale(params);
  const t = await getTranslations({ locale, namespace: 'auth.resetPassword' });
  return { title: t('title') };
}

/**
 * Reached through /api/auth/confirm/<locale> (recovery token -> session). Users with MFA must
 * reach aal2 first: Supabase Auth refuses password changes at aal1 when a factor exists.
 */
export default async function ResetPasswordPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const locale = await getRouteLocale(params);
  setRequestLocale(locale);
  const t = await getTranslations('auth.resetPassword');
  const state = await getAuthPageState();

  if (!state.signedIn) {
    return (
      <Card className="w-full">
        <h1>{t('linkInvalidTitle')}</h1>
        <Alert variant="warning">{t('linkInvalidBody')}</Alert>
        <Button asChild>
          <Link href="/forgot-password">{t('requestNewLink')}</Link>
        </Button>
      </Card>
    );
  }
  if (state.factors.verifiedFactorId && state.claims.aal !== 'aal2') {
    redirect({ href: '/mfa?next=%2Freset-password', locale });
  }
  return (
    <Card className="w-full">
      <div className="flex flex-col gap-1">
        <h1>{t('title')}</h1>
        <p className="text-sm text-muted-foreground">{t('description')}</p>
      </div>
      <ResetPasswordForm action={resetPasswordAction} />
    </Card>
  );
}
