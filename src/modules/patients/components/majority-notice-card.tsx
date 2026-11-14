import { Cake } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { EmptyState } from '@/components/shared/empty-state';
import { Badge } from '@/components/ui/badge';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Link } from '@/i18n/navigation';

type MajorityNoticeEntry = {
  patientId: string;
  firstName: string;
  lastName: string;
  majorityDate: string;
  daysLeft: number;
};

/**
 * PAT-06 dashboard card: minors of MY care team reaching the age of majority inside the notice
 * window. It is a prompt to review consent and guardian access, not a decision. Names come from
 * RLS-bound rows (care team only).
 */
export async function MajorityNoticeCard({
  windowDays,
  entries,
}: {
  windowDays: number;
  entries: MajorityNoticeEntry[];
}) {
  const t = await getTranslations('patients.majority');
  return (
    <Card className="p-4 sm:p-5" data-testid="majority-notice-card">
      <CardHeader>
        <CardTitle>{t('title')}</CardTitle>
        <CardDescription>{t('description', { count: windowDays })}</CardDescription>
      </CardHeader>
      {entries.length === 0 ? (
        <EmptyState icon={Cake} title={t('empty', { count: windowDays })} />
      ) : (
        <ul className="flex flex-col divide-y">
          {entries.map((e) => (
            <li key={e.patientId}>
              <Link
                href={`/patients/${e.patientId}`}
                className="flex min-h-12 flex-wrap items-center gap-x-3 gap-y-1 rounded-md px-2 py-3 hover:bg-accent"
              >
                <span className="font-semibold">
                  {e.firstName} {e.lastName}
                </span>
                <span className="ml-auto flex items-center gap-2">
                  <span className="text-sm text-muted-foreground">{e.majorityDate}</span>
                  <Badge variant="warning">{t('badge', { count: e.daysLeft })}</Badge>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
