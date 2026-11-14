import { Target } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { EmptyState } from '@/components/shared/empty-state';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { RichTextView } from '@/modules/clinical-records/components/rich-text';
import type { PortalGoalDto } from '@/modules/clinical-records/components/types';

/**
 * Portal "Mis objetivos": ONLY the patient-facing wording and the status of the active plan. The
 * clinical goal description, the plan and every note are never part of this DTO.
 */
export function PortalGoals({ goals }: { goals: PortalGoalDto[] }) {
  const t = useTranslations('clinical.portal.goals');
  const ts = useTranslations('clinical.plan.goal.statuses');
  if (goals.length === 0) {
    return (
      <Card>
        <EmptyState icon={Target} title={t('empty')} />
      </Card>
    );
  }
  return (
    <ul className="flex flex-col gap-3" data-testid="portal-goals">
      {goals.map((g) => (
        <li key={g.goalId} className="flex flex-col gap-2 rounded-lg border bg-card p-4">
          <RichTextView body={g.patientFacingText} className="flex flex-col gap-2 text-body-lg" />
          <div>
            <Badge variant={g.status === 'achieved' ? 'success' : 'neutral'}>{ts(g.status)}</Badge>
          </div>
        </li>
      ))}
    </ul>
  );
}
