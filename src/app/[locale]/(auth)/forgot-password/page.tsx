import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Alert } from '@/components/ui/alert';
import { Card } from '@/components/ui/card';
import { getRouteLocale } from '@/i18n/route-locale';
import { Link } from '@/i18n/navigation';
import { ForgotPasswordForm } from '@/modules/auth';
import { requestPasswordResetAction } from '@/modules/auth/server/actions';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const locale = await getRouteLocale(params);
  const t = await getTranslations({ locale, namespace: 'auth.forgotPassword' });
  return { title: t('title') };
}

export default async function ForgotPasswordPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const locale = await getRouteLocale(params);
  setRequestLocale(locale);
  const { error } = await searchParams;
  const t = await getTranslations('auth.forgotPassword');
  return (
    <Card className="w-full">
      <div className="flex flex-col gap-1">
        <h1>{t('title')}</h1>
        <p className="text-sm text-muted-foreground">{t('description')}</p>
      </div>
      {error === 'link' ? <Alert variant="warning">{t('linkInvalid')}</Alert> : null}
      <ForgotPasswordForm action={requestPasswordResetAction} />
      <Link
        href="/sign-in"
        className="self-center text-sm font-semibold text-primary underline underline-offset-4"
      >
        {t('backToSignIn')}
      </Link>
    </Card>
  );
}
