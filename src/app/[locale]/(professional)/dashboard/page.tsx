import { Activity } from 'lucide-react';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { getRouteLocale } from '@/i18n/route-locale';
import { EmptyState } from '@/components/shared/empty-state';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { getStaffPageContext } from '@/modules/auth/server/guards';
import { evaluatePermission } from '@/server/authz';
import { PendingNotesCards } from '@/modules/sessions/panels/pending-notes-cards';
import { MajorityNoticeCard } from '@/modules/patients/components/majority-notice-card';
import { listUpcomingMajority } from '@/modules/patients/server/queries';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const locale = await getRouteLocale(params);
  const t = await getTranslations({ locale, namespace: 'nav' });
  return { title: t('dashboard') };
}

export default async function DashboardPage({ params }: { params: Promise<{ locale: string }> }) {
  const locale = await getRouteLocale(params);
  setRequestLocale(locale);
  const ctx = await getStaffPageContext(locale);
  if (!ctx) return null;
  // PAT-06: care-team only. Owners without the psychologist role get FORBIDDEN -> no card.
  const majority = evaluatePermission(ctx, 'patient.read').allowed
    ? await listUpcomingMajority(ctx)
    : null;
  const t = await getTranslations('shell.professional.dashboard');

  // Phase 3: pending-note sessions and drafts to finalize (care team / psychologist only).
  const showClinical = evaluatePermission(ctx, 'clinical.session.read').allowed;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1>{t('title')}</h1>
        <p className="mt-1 text-muted-foreground">{t('subtitle')}</p>
      </div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {majority?.ok ? <MajorityNoticeCard {...majority.data} /> : null}
        {showClinical ? <PendingNotesCards ctx={ctx} /> : null}
        <Card className="p-4 sm:p-5">
          <CardHeader>
            <CardTitle>{t('activityTitle')}</CardTitle>
          </CardHeader>
          <EmptyState icon={Activity} title={t('activityEmpty')} />
        </Card>
      </div>
    </div>
  );
}
