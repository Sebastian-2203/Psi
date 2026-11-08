import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { getRouteLocale } from '@/i18n/route-locale';
import { Link, redirect } from '@/i18n/navigation';
import { RecoveryCodesPanel } from '@/modules/auth';
import { generateRecoveryCodesAction } from '@/modules/auth/server/actions';
import { getRecoveryCodesStatus, hasRecentMfa } from '@/server/auth/recovery-codes';
import { getAuthPageState } from '@/server/auth/session';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const locale = await getRouteLocale(params);
  const t = await getTranslations({ locale, namespace: 'auth.mfa' });
  return { title: t('codesTitle') };
}

/** ADR-021: generate/regenerate (aal2 + MFA within 15 min). Codes are shown once. */
export default async function RecoveryCodesPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ enrolled?: string }>;
}) {
  const locale = await getRouteLocale(params);
  setRequestLocale(locale);
  const { enrolled } = await searchParams;
  const state = await getAuthPageState();
  if (!state.signedIn) return redirect({ href: '/sign-in', locale });
  if (state.claims.aal !== 'aal2') return redirect({ href: '/mfa', locale });

  const t = await getTranslations('auth.mfa');
  const status = await getRecoveryCodesStatus(state.claims);
  const recent = hasRecentMfa(state.claims);

  return (
    <Card className="w-full">
      <div className="flex flex-col gap-1">
        <h1>{t('codesTitle')}</h1>
        <p className="text-sm text-muted-foreground">{t('codesDescription')}</p>
      </div>
      {enrolled === '1' ? <Alert variant="success">{t('codesEnrolled')}</Alert> : null}
      <p>
        {status
          ? t('codesStatus', { remaining: status.remaining, total: status.total })
          : t('codesNone')}
      </p>
      {recent ? (
        <RecoveryCodesPanel action={generateRecoveryCodesAction} hasCodes={status !== null} />
      ) : (
        <Alert variant="info">
          <p>{t('codesReverify')}</p>
          <Link
            href="/mfa?reverify=1&next=%2Fmfa%2Frecovery-codes"
            className="font-semibold underline underline-offset-4"
          >
            {t('codesReverifyLink')}
          </Link>
        </Alert>
      )}
      <Button asChild variant="outline">
        <Link href="/dashboard">{t('continue')}</Link>
      </Button>
    </Card>
  );
}
