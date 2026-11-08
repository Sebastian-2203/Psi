import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Card } from '@/components/ui/card';
import { getRouteLocale } from '@/i18n/route-locale';
import { redirect } from '@/i18n/navigation';
import { MfaEnroll, SignOutButton } from '@/modules/auth';
import {
  signOutAction,
  startMfaEnrollmentAction,
  verifyMfaEnrollmentAction,
} from '@/modules/auth/server/actions';
import { getAuthPageState } from '@/server/auth/session';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const locale = await getRouteLocale(params);
  const t = await getTranslations({ locale, namespace: 'auth.mfa' });
  return { title: t('enrollTitle') };
}

/**
 * Enrollment gate (SECURITY.md §3.2): a staff user without a verified factor can reach only
 * this screen. With a verified factor, enrolling again would need aal2 -> challenge instead.
 */
export default async function MfaEnrollPage({ params }: { params: Promise<{ locale: string }> }) {
  const locale = await getRouteLocale(params);
  setRequestLocale(locale);
  const state = await getAuthPageState();
  if (!state.signedIn) redirect({ href: '/sign-in', locale });
  if (state.signedIn && state.factors.verifiedFactorId) {
    redirect({ href: state.claims.aal === 'aal2' ? '/mfa/recovery-codes' : '/mfa', locale });
  }
  const t = await getTranslations('auth.mfa');
  return (
    <Card className="w-full">
      <div className="flex flex-col gap-1">
        <h1>{t('enrollTitle')}</h1>
        <p className="text-sm text-muted-foreground">{t('enrollDescription')}</p>
      </div>
      <MfaEnroll startAction={startMfaEnrollmentAction} verifyAction={verifyMfaEnrollmentAction} />
      <div className="flex justify-center">
        <SignOutButton action={signOutAction} label={t('signOut')} variant="ghost" />
      </div>
    </Card>
  );
}
