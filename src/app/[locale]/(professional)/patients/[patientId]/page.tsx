import { getTranslations, setRequestLocale } from 'next-intl/server';
import { z } from 'zod';
import { ErrorState } from '@/components/shared/error-state';
import { Card } from '@/components/ui/card';
import { Link } from '@/i18n/navigation';
import { getRouteLocale } from '@/i18n/route-locale';
import { getStaffPageContext } from '@/modules/auth/server/guards';
import { PatientConsentsTab } from '@/modules/consents/components/patient-consents-tab';
import { recordConsentAction, withdrawConsentAction } from '@/modules/consents/server/actions';
import { getPatientConsentStatus } from '@/modules/consents/server/queries';
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

export const metadata = { robots: { index: false } };

/**
 * Care-team patient profile. Off the care team the query answers NOT_FOUND (same as a missing
 * id): the page then shows a neutral "not available" card. Private clinical notes do not exist
 * in this phase and are never rendered here.
 */
export default async function PatientProfilePage({
  params,
}: {
  params: Promise<{ locale: string; patientId: string }>;
}) {
  const { patientId } = await params;
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
  const [guardians, consents] = await Promise.all([
    patient.data.isMinor === false ? null : listGuardiansForPatient(ctx, patientId),
    getPatientConsentStatus(ctx, patientId),
  ]);
  const readOnly = patient.data.status === 'archived' || patient.data.status === 'discharged';
  const guardianList = guardians?.ok ? guardians.data : [];

  return (
    <PatientProfile
      patient={patient.data}
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
          loadFailed={!consents.ok}
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
