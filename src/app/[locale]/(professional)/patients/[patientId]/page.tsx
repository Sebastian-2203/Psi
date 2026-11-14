import { getTranslations, setRequestLocale } from 'next-intl/server';
import { z } from 'zod';
import { ErrorState } from '@/components/shared/error-state';
import { Card } from '@/components/ui/card';
import { Link } from '@/i18n/navigation';
import { getRouteLocale } from '@/i18n/route-locale';
import { getStaffPageContext } from '@/modules/auth/server/guards';
import { PatientConsentsTab } from '@/modules/consents/components/patient-consents-tab';
import { recordConsentAction, withdrawConsentAction } from '@/modules/consents/server/actions';
import { getPatientConsentStatus, listRecordableConsents } from '@/modules/consents/server/queries';
import { GuardiansTab } from '@/modules/guardians/components/guardians-tab';
import {
  createGuardianAction,
  endGuardianCaveatAction,
  inviteGuardianToPortalAction,
  reactivateGuardianRelationshipAction,
  revokeGuardianRelationshipAction,
  setGuardianCaveatAction,
  setGuardianPermissionsAction,
  suspendGuardianRelationshipAction,
  verifyGuardianRelationshipAction,
} from '@/modules/guardians/server/actions';
import { listGuardiansForPatient } from '@/modules/guardians/server/queries';
import { PatientProfile } from '@/modules/patients/components/patient-profile';
import {
  assignCareTeamMemberAction,
  changePatientStatusAction,
  endCareTeamMemberAction,
  invitePatientToPortalAction,
  updatePatientAction,
  updatePatientPreferencesAction,
} from '@/modules/patients/server/actions';
import { getPatient } from '@/modules/patients/server/queries';
import {
  PatientClinicalPanel,
  isClinicalTab,
} from '@/modules/clinical-records/panels/patient-clinical-panel';
import { evaluatePermission } from '@/server/authz';

export const metadata = { robots: { index: false } };

/**
 * Care-team patient profile. Off the care team the query answers NOT_FOUND (same as a missing
 * id): the page then shows a neutral "not available" card. Private clinical notes do not exist
 * in this phase and are never rendered here.
 */
export default async function PatientProfilePage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; patientId: string }>;
  searchParams: Promise<{ tab?: string | string[]; session?: string | string[] }>;
}) {
  const { patientId } = await params;
  const query = await searchParams;
  const tabParam = typeof query.tab === 'string' ? query.tab : undefined;
  const sessionParam =
    typeof query.session === 'string' && z.uuid().safeParse(query.session).success
      ? query.session
      : undefined;
  const locale = await getRouteLocale(params);
  setRequestLocale(locale);
  const ctx = await getStaffPageContext(locale, `/patients/${patientId}`);
  if (!ctx) return null;
  const t = await getTranslations('patients');
  const back = (
    <Link
      href="/patients"
      className="text-sm font-semibold text-primary underline underline-offset-4"
    >
      {t('back')}
    </Link>
  );
  const unavailable = (
    <div className="flex flex-col gap-4">
      {back}
      <Card>
        <h1>{t('unavailableTitle')}</h1>
        <p className="text-muted-foreground">{t('unavailableDescription')}</p>
      </Card>
    </div>
  );
  if (!z.uuid().safeParse(patientId).success) return unavailable;

  const patient = await getPatient(ctx, patientId);
  if (!patient.ok) {
    if (['NOT_FOUND', 'FORBIDDEN'].includes(patient.error.code)) return unavailable;
    return (
      <div className="flex flex-col gap-4">
        {back}
        <ErrorState title={t('loadErrorTitle')} description={t('loadErrorDescription')} />
      </div>
    );
  }
  const [guardians, consents, recordable] = await Promise.all([
    patient.data.isMinor === false ? null : listGuardiansForPatient(ctx, patientId),
    getPatientConsentStatus(ctx, patientId),
    listRecordableConsents(ctx, patientId),
  ]);
  const readOnly = patient.data.status === 'archived' || patient.data.status === 'discharged';
  const guardianList = guardians?.ok ? guardians.data : [];

  // Phase 3: clinical tabs for the care team only (RLS re-checks every read). Only the tab named in
  // the URL is loaded, so the other tabs trigger no clinical read.
  const showClinical = evaluatePermission(ctx, 'clinical.record.read').allowed;
  const clinicalTab = showClinical && isClinicalTab(tabParam) ? tabParam : null;
  const clinicalNode = clinicalTab
    ? await PatientClinicalPanel({ ctx, tab: clinicalTab, patientId, sessionId: sessionParam })
    : null;

  return (
    <PatientProfile
      patient={patient.data}
      clinical={showClinical ? { loadedTab: clinicalTab, node: clinicalNode } : undefined}
      myMembershipId={ctx.membership?.id ?? ''}
      actions={{
        update: updatePatientAction,
        changeStatus: changePatientStatusAction,
        assign: assignCareTeamMemberAction,
        endCareTeam: endCareTeamMemberAction,
        preferences: updatePatientPreferencesAction,
        invite: invitePatientToPortalAction,
      }}
      guardiansTab={
        <GuardiansTab
          patientId={patientId}
          relationships={guardianList}
          readOnly={readOnly}
          loadFailed={guardians ? !guardians.ok : false}
          actions={{
            create: createGuardianAction,
            verify: verifyGuardianRelationshipAction,
            suspend: suspendGuardianRelationshipAction,
            reactivate: reactivateGuardianRelationshipAction,
            revoke: revokeGuardianRelationshipAction,
            setCaveat: setGuardianCaveatAction,
            endCaveat: endGuardianCaveatAction,
            setPermissions: setGuardianPermissionsAction,
            invite: inviteGuardianToPortalAction,
          }}
        />
      }
      consentsTab={
        <PatientConsentsTab
          patientId={patientId}
          records={consents.ok ? consents.data.records : []}
          activationMissing={consents.ok ? consents.data.activationMissing : []}
          loadFailed={!consents.ok || !recordable.ok}
          recordable={recordable.ok ? recordable.data : []}
          readOnly={readOnly}
          guardians={guardianList
            .filter((g) => g.status === 'active')
            .map((g) => ({
              patientGuardianId: g.patientGuardianId,
              name: `${g.firstName} ${g.lastName}`,
            }))}
          actions={{ record: recordConsentAction, withdraw: withdrawConsentAction }}
        />
      }
    />
  );
}
