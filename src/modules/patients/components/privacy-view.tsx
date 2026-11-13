import { ShieldCheck } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { EmptyState } from '@/components/shared/empty-state';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { PermissionList } from '@/modules/guardians/components/permission-list';

export type PrivacyEntry = {
  patientGuardianId: string;
  guardianFirstName: string;
  relationship: string;
  permissions: string[];
};

/** GRD-07: what each active guardian can see of the patient's portal (live). Patient-facing. */
export function PrivacyView({ entries }: { entries: PrivacyEntry[] }) {
  const t = useTranslations('portal.privacy');
  const tr = useTranslations('guardians.relationships');
  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-3">
        <h1 className="font-display text-display">{t('title')}</h1>
        <p className="max-w-[60ch] text-body-lg">{t('intro')}</p>
        <p className="max-w-[60ch]">{t('privateNote')}</p>
      </section>
      {entries.length === 0 ? (
        <Card>
          <EmptyState
            icon={ShieldCheck}
            title={t('emptyTitle')}
            description={t('emptyDescription')}
          />
        </Card>
      ) : (
        <ul className="flex flex-col gap-4" data-testid="privacy-list">
          {entries.map((e) => (
            <li key={e.patientGuardianId}>
              <Card>
                <CardHeader>
                  <CardTitle>{e.guardianFirstName}</CardTitle>
                  <CardDescription>
                    {tr.has(e.relationship as never) ? tr(e.relationship as never) : e.relationship}
                  </CardDescription>
                </CardHeader>
                <p className="font-bold">{t('canSee')}</p>
                <PermissionList permissions={e.permissions} label={t('canSee')} />
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
