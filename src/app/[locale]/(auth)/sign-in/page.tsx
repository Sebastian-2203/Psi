import { getTranslations, setRequestLocale } from 'next-intl/server';
import { PracticeName } from '@/components/shared/practice-name';
import { Alert } from '@/components/ui/alert';
import { Card } from '@/components/ui/card';
import { getRouteLocale } from '@/i18n/route-locale';
import { redirect } from '@/i18n/navigation';
import { SignInForm } from '@/modules/auth';
import { safeNextPath } from '@/modules/auth/schemas';
import { signInAction } from '@/modules/auth/server/actions';
import { getVerifiedClaims } from '@/server/auth/claims';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const locale = await getRouteLocale(params);
  const t = await getTranslations({ locale, namespace: 'auth.signIn' });
  return { title: t('submit') };
}

type Search = Record<string, string | string[] | undefined>;

export default async function SignInPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Search>;
}) {
  const locale = await getRouteLocale(params);
  setRequestLocale(locale);
  const search = await searchParams;
  const next = safeNextPath(search.next) ?? undefined;
  // Already signed in: the professional guard decides (MFA step-up, access or denial).
  if (await getVerifiedClaims()) redirect({ href: next ?? '/dashboard', locale });

  const t = await getTranslations('auth.signIn');
  const notice =
    search.expired === 'idle'
      ? t('expiredIdle')
      : search.expired === 'absolute'
        ? t('expiredAbsolute')
        : search.mfaReset === '1'
          ? t('mfaReset')
          : search.signedOut === '1'
            ? t('signedOut')
            : null;

  return (
    <div className="flex w-full flex-col items-center gap-6">
      <PracticeName display className="text-center" />
      <Card className="w-full">
        <div className="flex flex-col gap-1">
          <h1>{t('title')}</h1>
          <p className="text-sm text-muted-foreground">{t('description')}</p>
        </div>
        {notice ? <Alert variant="info">{notice}</Alert> : null}
        <SignInForm action={signInAction} {...(next ? { next } : {})} />
      </Card>
    </div>
  );
}
