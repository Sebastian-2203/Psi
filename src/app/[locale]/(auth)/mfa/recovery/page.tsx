import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Alert } from '@/components/ui/alert';
import { Card } from '@/components/ui/card';
import { getRouteLocale } from '@/i18n/route-locale';
import { Link, redirect } from '@/i18n/navigation';
import { RecoveryCodeForm } from '@/modules/auth';
import { redeemRecoveryCodeAction } from '@/modules/auth/server/actions';
import { getAuthPageState } from '@/server/auth/session';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const locale = await getRouteLocale(params);
  const t = await getTranslations({ locale, namespace: 'auth.mfa' });
  return { title: t('recoveryTitle') };
}

/** ADR-021: password verified (aal1) + one recovery code -> factors reset -> sign in + enroll. */
export default async function MfaRecoveryPage({ params }: { params: Promise<{ locale: string }> }) {
  const locale = await getRouteLocale(params);
  setRequestLocale(locale);
  const state = await getAuthPageState();
  if (!state.signedIn) redirect({ href: '/sign-in', locale });
  if (state.signedIn && !state.factors.verifiedFactorId) redirect({ href: '/mfa/enroll', locale });
  if (state.signedIn && state.claims.aal === 'aal2') redirect({ href: '/dashboard', locale });
  const t = await getTranslations('auth.mfa');
  return (
    <Card className="w-full">
      <div className="flex flex-col gap-1">
        <h1>{t('recoveryTitle')}</h1>
        <p className="text-sm text-muted-foreground">{t('recoveryDescription')}</p>
      </div>
      <Alert variant="warning">{t('recoveryWarning')}</Alert>
      <RecoveryCodeForm action={redeemRecoveryCodeAction} />
      <Link
        href="/mfa"
        className="self-center text-sm font-semibold text-primary underline underline-offset-4"
      >
        {t('backToChallenge')}
      </Link>
    </Card>
  );
}
