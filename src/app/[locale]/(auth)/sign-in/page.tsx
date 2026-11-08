import { getTranslations, setRequestLocale } from 'next-intl/server';
import { getRouteLocale } from '@/i18n/route-locale';
import { PracticeName } from '@/components/shared/practice-name';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const locale = await getRouteLocale(params);
  const t = await getTranslations({ locale, namespace: 'auth.signIn' });
  return { title: t('submit') };
}

/** PLACEHOLDER: no behaviour. The auth workstream replaces the fieldset with the real form + server action. */
export default async function SignInPage({ params }: { params: Promise<{ locale: string }> }) {
  const locale = await getRouteLocale(params);
  setRequestLocale(locale);
  const t = await getTranslations('auth.signIn');
  return (
    <div className="flex w-full flex-col items-center gap-6">
      <PracticeName display className="text-center" />
      <Card className="w-full">
        <div className="flex flex-col gap-1">
          <h1>{t('title')}</h1>
          <p className="text-sm text-muted-foreground">{t('description')}</p>
        </div>
        <Alert variant="info">{t('pending')}</Alert>
        <fieldset disabled className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="email">{t('email')}</Label>
            <Input id="email" type="email" autoComplete="username" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="password">{t('password')}</Label>
            <Input id="password" type="password" autoComplete="current-password" />
          </div>
          <Button type="button" className="w-full" aria-disabled>
            {t('submit')}
          </Button>
        </fieldset>
      </Card>
    </div>
  );
}
