'use client';

import { ArrowLeft, TriangleAlert } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import type { ReactNode } from 'react';
import { InviteDialog } from '@/components/shared/invite-dialog';
import { ReasonDialog } from '@/components/shared/reason-dialog';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { LoadingState } from '@/components/shared/loading-state';
import { Link, usePathname, useRouter } from '@/i18n/navigation';
import { CareTeamTab } from './care-team-tab';
import type { UpdatePatientInput } from '@/modules/patients/schemas';
import { DetailsTab } from './details-tab';
import { MajoritySoonBadge, MinorBadge, PatientStatusBadge } from './patient-status-badge';
import { PreferencesTab, type PreferencesInput } from './preferences-tab';
import type { Action, PatientDetailDto, PatientStatus } from './types';

const CLINICAL_TAB_KEYS = ['record', 'sessions', 'notes', 'plan', 'documents'] as const;

const TRANSITIONS: Record<PatientStatus, PatientStatus[]> = {
  intake: ['active', 'archived'],
  active: ['paused', 'discharged'],
  paused: ['active', 'discharged'],
  discharged: ['active', 'archived'],
  archived: [],
};

export type PatientProfileActions = {
  update: Action<UpdatePatientInput, { updatedAt: string }>;
  changeStatus: Action<{ patientId: string; status: Exclude<PatientStatus, 'intake'> }, unknown>;
  assign: Action<
    {
      patientId: string;
      membershipId: string;
      careRole: 'primary' | 'secondary' | 'supervisor';
      reason?: string;
    },
    unknown
  >;
  endCareTeam: Action<{ careTeamMemberId: string; reason: string }, unknown>;
  preferences: Action<PreferencesInput, unknown>;
  invite: Action<{ patientId: string; email: string; emailLocale: 'es' | 'en' }, unknown>;
};

/**
 * Patient profile shell: header (name, badges, status change, invite) and tabs. The guardians and
 * consents tabs are slots composed by the page (they belong to their own modules).
 */
export function PatientProfile({
  patient,
  myMembershipId,
  actions,
  guardiansTab,
  consentsTab,
  clinical,
}: {
  patient: PatientDetailDto;
  myMembershipId: string;
  actions: PatientProfileActions;
  guardiansTab: ReactNode;
  consentsTab: ReactNode;
  /**
   * Phase 3 clinical tabs (care team only; omitted otherwise). Only the tab named in `?tab=` is
   * loaded by the server page (`node`); the other clinical tabs show a loading state until the
   * URL changes and the page re-renders with their data.
   */
  clinical?: { loadedTab: string | null; node: ReactNode };
}) {
  const t = useTranslations('patients');
  const tcl = useTranslations('clinical.tabs');
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const requested = params.get('tab') ?? 'details';
  const available = [
    'details',
    'careTeam',
    'preferences',
    ...(patient.isMinor !== false ? ['guardians'] : []),
    'consents',
    ...(clinical ? CLINICAL_TAB_KEYS : []),
  ];
  const tab = available.includes(requested) ? requested : 'details';
  const readOnly = patient.status === 'archived' || patient.status === 'discharged';
  const targets = TRANSITIONS[patient.status];
  const name = `${patient.firstName} ${patient.lastName}`;
  const showMissing = patient.status === 'intake' && patient.activationMissing.length > 0;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link
          href="/patients"
          className="inline-flex min-h-(--target-min) items-center gap-1 text-sm font-semibold text-primary underline underline-offset-4"
        >
          <ArrowLeft className="size-4" aria-hidden />
          {t('back')}
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1>{name}</h1>
          <PatientStatusBadge status={patient.status} />
          <MinorBadge isMinor={patient.isMinor} />
          <MajoritySoonBadge days={patient.majorityInDays} />
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          {targets.length > 0 ? (
            <ReasonDialog
              trigger={<Button variant="outline">{t('status.change')}</Button>}
              title={t('status.changeTitle', { name })}
              description={t('status.changeDescription')}
              confirmLabel={t('status.confirm')}
              reasonLabel={t('status.newStatus')}
              options={targets.map((s) => ({ value: s, label: t(`status.${s}`) }))}
              action={(status) =>
                actions.changeStatus({
                  patientId: patient.patientId,
                  status: status as Exclude<PatientStatus, 'intake'>,
                })
              }
              onDone={() => router.refresh()}
            />
          ) : null}
          {!patient.hasPortalLogin && !readOnly ? (
            <InviteDialog
              title={t('invite.title', { name })}
              description={t('invite.description')}
              triggerLabel={t('invite.trigger')}
              defaultEmail={patient.email}
              action={(v) => actions.invite({ patientId: patient.patientId, ...v })}
            />
          ) : null}
        </div>
        {patient.hasPortalLogin ? (
          <p className="mt-2 text-sm text-muted-foreground">{t('invite.hasLogin')}</p>
        ) : null}
      </div>

      {showMissing ? (
        <Alert variant="warning">
          <AlertTitle className="flex items-center gap-2">
            <TriangleAlert className="size-4" aria-hidden />
            {t('activation.title')}
          </AlertTitle>
          <AlertDescription>
            <ul className="list-disc pl-5">
              {patient.activationMissing.map((k) => (
                <li key={k}>
                  {t.has(`activation.${k}` as never) ? t(`activation.${k}` as never) : k}
                </li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      ) : null}

      <Tabs
        value={tab}
        onValueChange={(next) => router.replace(`${pathname}?tab=${next}`, { scroll: false })}
      >
        <TabsList aria-label={t('tabs.label')}>
          <TabsTrigger value="details">{t('tabs.details')}</TabsTrigger>
          <TabsTrigger value="careTeam">{t('tabs.careTeam')}</TabsTrigger>
          <TabsTrigger value="preferences">{t('tabs.preferences')}</TabsTrigger>
          {patient.isMinor !== false ? (
            <TabsTrigger value="guardians">{t('tabs.guardians')}</TabsTrigger>
          ) : null}
          <TabsTrigger value="consents">{t('tabs.consents')}</TabsTrigger>
          {clinical
            ? CLINICAL_TAB_KEYS.map((k) => (
                <TabsTrigger key={k} value={k}>
                  {tcl(k)}
                </TabsTrigger>
              ))
            : null}
        </TabsList>
        <TabsContent value="details">
          <DetailsTab
            key={patient.updatedAt}
            patient={patient}
            action={actions.update}
            readOnly={readOnly}
          />
        </TabsContent>
        <TabsContent value="careTeam">
          <CareTeamTab
            patient={patient}
            myMembershipId={myMembershipId}
            assignAction={actions.assign}
            endAction={actions.endCareTeam}
            readOnly={readOnly}
          />
        </TabsContent>
        <TabsContent value="preferences">
          <PreferencesTab patient={patient} action={actions.preferences} readOnly={readOnly} />
        </TabsContent>
        {patient.isMinor !== false ? (
          <TabsContent value="guardians">{guardiansTab}</TabsContent>
        ) : null}
        <TabsContent value="consents">{consentsTab}</TabsContent>
        {clinical
          ? CLINICAL_TAB_KEYS.map((k) => (
              <TabsContent key={k} value={k}>
                {clinical.loadedTab === k ? clinical.node : <LoadingState />}
              </TabsContent>
            ))
          : null}
      </Tabs>
    </div>
  );
}
