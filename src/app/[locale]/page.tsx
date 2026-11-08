import { ArrowRight } from 'lucide-react';
import { setRequestLocale } from 'next-intl/server';
import { getTranslations } from 'next-intl/server';
import { getRouteLocale } from '@/i18n/route-locale';
import { CenteredPage } from '@/components/shared/centered-page';
import { LocaleSwitcher } from '@/components/shared/locale-switcher';
import { PracticeName } from '@/components/shared/practice-name';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Link } from '@/i18n/navigation';

// Provisional chooser until auth decides the destination by role (auth workstream).
export default async function LocaleHomePage({ params }: { params: Promise<{ locale: string }> }) {
  const locale = await getRouteLocale(params);
  setRequestLocale(locale);
  const t = await getTranslations('home');
  return (
    <CenteredPage header={<LocaleSwitcher />} className="max-w-md">
      <PracticeName display />
      <Card className="w-full">
        <h1>{t('title')}</h1>
        <p className="text-sm text-muted-foreground">{t('description')}</p>
        <nav className="flex flex-col gap-3">
          <Button asChild>
            <Link href="/sign-in">
              {t('signIn')}
              <ArrowRight aria-hidden />
            </Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/dashboard">{t('professional')}</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/portal">{t('portal')}</Link>
          </Button>
        </nav>
      </Card>
    </CenteredPage>
  );
}
