import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Card } from '@/components/ui/card';
import { getRouteLocale } from '@/i18n/route-locale';
import { Link, redirect } from '@/i18n/navigation';
import { MfaChallengeForm, SignOutButton } from '@/modules/auth';
import { safeNextPath } from '@/modules/auth/schemas';
import { signOutAction, verifyMfaAction } from '@/modules/auth/server/actions';
import { getAuthPageState } from '@/server/auth/session';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const locale = await getRouteLocale(params);
  const t = await getTranslations({ locale, namespace: 'auth.mfa' });
  return { title: t('challengeTitle') };
}

/** aal1 -> aal2 step-up. `?reverify=1` re-challenges an aal2 session (recent-MFA actions). */
export default async function MfaChallengePage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ next?: string; reverify?: string }>;
}) {
  const locale = await getRouteLocale(params);
  setRequestLocale(locale);
  const search = await searchParams;
  const next = safeNextPath(search.next) ?? undefined;
  const state = await getAuthPageState();
  if (!state.signedIn) redirect({ href: '/sign-in', locale });
  if (state.signedIn && !state.factors.verifiedFactorId) redirect({ href: '/mfa/enroll', locale });
  if (state.signedIn && state.claims.aal === 'aal2' && search.reverify !== '1') {
    redirect({ href: next ?? '/dashboard', locale });
  }

  const t = await getTranslations('auth.mfa');
  return (
    <Card className="w-full">
      <div className="flex flex-col gap-1">
        <h1>{t('challengeTitle')}</h1>
        <p className="text-sm text-muted-foreground">{t('challengeDescription')}</p>
      </div>
      <MfaChallengeForm action={verifyMfaAction} {...(next ? { next } : {})} />
      <Link
        href="/mfa/recovery"
        className="self-center text-center text-sm font-semibold text-primary underline underline-offset-4"
      >
        {t('useRecoveryCode')}
      </Link>
      <div className="flex justify-center">
        <SignOutButton action={signOutAction} label={t('signOut')} variant="ghost" />
      </div>
    </Card>
  );
}
