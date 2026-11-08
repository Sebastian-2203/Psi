import { CalendarClock, FilePenLine, Activity } from 'lucide-react';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { getRouteLocale } from '@/i18n/route-locale';
import { EmptyState } from '@/components/shared/empty-state';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { getStaffPageContext } from '@/modules/auth/server/guards';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const locale = await getRouteLocale(params);
  const t = await getTranslations({ locale, namespace: 'nav' });
  return { title: t('dashboard') };
}

export default async function DashboardPage({ params }: { params: Promise<{ locale: string }> }) {
  const locale = await getRouteLocale(params);
  setRequestLocale(locale);
  if (!(await getStaffPageContext(locale))) return null;
  const t = await getTranslations('shell.professional.dashboard');

  const cards = [
    { key: 'sessions', icon: CalendarClock, title: t('sessionsTitle'), empty: t('sessionsEmpty') },
    { key: 'drafts', icon: FilePenLine, title: t('draftsTitle'), empty: t('draftsEmpty') },
    { key: 'activity', icon: Activity, title: t('activityTitle'), empty: t('activityEmpty') },
  ];

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1>{t('title')}</h1>
        <p className="mt-1 text-muted-foreground">{t('subtitle')}</p>
      </div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {cards.map(({ key, icon, title, empty }) => (
          <Card key={key} className="p-4 sm:p-5">
            <CardHeader>
              <CardTitle>{title}</CardTitle>
            </CardHeader>
            <EmptyState icon={icon} title={empty} />
          </Card>
        ))}
      </div>
    </div>
  );
}
