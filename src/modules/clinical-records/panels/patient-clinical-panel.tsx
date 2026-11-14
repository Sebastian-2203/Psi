import { FolderOpen } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { EmptyState } from '@/components/shared/empty-state';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Link } from '@/i18n/navigation';
import { DocumentsTab } from '@/modules/documents/components/documents-tab';
import {
  archiveClinicalDocumentAction,
  issueClinicalFileUrlAction,
  shareClinicalDocumentAction,
  unshareClinicalDocumentAction,
  uploadClinicalDocumentAction,
} from '@/modules/documents/server/actions';
import { listClinicalDocuments } from '@/modules/documents/server/service';
import {
  createAddendumAction,
  createNoteDraftAction,
  discardNoteDraftAction,
  finalizeNoteAction,
  getNoteAction,
  updateNoteDraftAction,
} from '@/modules/notes/server/actions';
import { listNotes } from '@/modules/notes/server/service';
import { NotesTab } from '@/modules/notes/components/notes-tab';
import { SessionsTab } from '@/modules/sessions/components/sessions-tab';
import { recordSessionAction, updateSessionAction } from '@/modules/sessions/server/actions';
import { listSessions } from '@/modules/sessions/server/service';
import { PlanTab } from '@/modules/treatment/components/plan-tab';
import {
  activateTreatmentPlanAction,
  addGoalAction,
  createTreatmentPlanDraftAction,
  endTreatmentPlanAction,
  getTreatmentPlanAction,
  reviseTreatmentPlanAction,
  setPatientFacingGoalTextAction,
  updateGoalStatusAction,
  updateTreatmentPlanDraftAction,
  withdrawPatientFacingGoalTextAction,
} from '@/modules/treatment/server/actions';
import { getTreatmentPlan, listTreatmentPlans } from '@/modules/treatment/server/service';
import type { AuthzContext } from '@/server/authz';
import { RecordTab } from '../components/record-tab';
import {
  addDiagnosisAction,
  closeClinicalRecordAction,
  createAssessmentAction,
  discardAssessmentDraftAction,
  finalizeAssessmentAction,
  listSectionRevisionsAction,
  openClinicalRecordAction,
  reopenClinicalRecordAction,
  updateAssessmentDraftAction,
  updateDiagnosisStatusAction,
  updateRecordSectionAction,
} from '../server/actions';
import { getClinicalRecord, listAssessments, listClinicalConfig } from '../server/queries';

export const CLINICAL_TABS = ['record', 'sessions', 'notes', 'plan', 'documents'] as const;
export type ClinicalTab = (typeof CLINICAL_TABS)[number];
export const isClinicalTab = (value: string | undefined): value is ClinicalTab =>
  (CLINICAL_TABS as readonly string[]).includes(value ?? '');

/**
 * Server composition of ONE clinical tab of the patient profile. Only the active tab is loaded, so
 * opening a profile does not read (or audit-read) clinical data nobody looked at. Care team only:
 * every query re-checks `app.can_read_clinical` (RLS); a failed read renders a neutral error.
 * Server actions are passed down as props; nothing here is a security boundary on its own.
 */
export async function PatientClinicalPanel({
  ctx,
  tab,
  patientId,
  sessionId,
}: {
  ctx: AuthzContext;
  tab: ClinicalTab;
  patientId: string;
  sessionId?: string;
}): Promise<ReactNode> {
  const myMembershipId = ctx.membership?.id ?? '';

  if (tab === 'sessions') {
    const [sessions, plans] = await Promise.all([
      listSessions(ctx, { patientId, limit: 100 }),
      listTreatmentPlans(ctx, patientId),
    ]);
    return (
      <SessionsTab
        patientId={patientId}
        sessions={sessions.ok ? sessions.data : []}
        plans={
          plans.ok
            ? plans.data.map((p) => ({ id: p.id, version: p.version, status: p.status }))
            : []
        }
        myMembershipId={myMembershipId}
        loadFailed={!sessions.ok}
        actions={{ record: recordSessionAction, update: updateSessionAction }}
      />
    );
  }

  const overview = await getClinicalRecord(ctx, patientId);
  const noRecord = !overview.ok && overview.error.code === 'NOT_FOUND';
  const failed = !overview.ok && !noRecord;

  if (tab === 'record') {
    const [assessments, docs] = overview.ok
      ? await Promise.all([listAssessments(ctx, patientId), listClinicalDocuments(ctx, patientId)])
      : [null, null];
    return (
      <RecordTab
        patientId={patientId}
        overview={overview.ok ? overview.data : null}
        assessments={assessments?.ok ? assessments.data : []}
        documents={docs?.ok ? docs.data : []}
        myMembershipId={myMembershipId}
        loadFailed={failed || (assessments !== null && !assessments.ok)}
        actions={{
          open: openClinicalRecordAction,
          close: closeClinicalRecordAction,
          reopen: reopenClinicalRecordAction,
          section: { save: updateRecordSectionAction, revisions: listSectionRevisionsAction },
          assessment: {
            create: createAssessmentAction,
            update: updateAssessmentDraftAction,
            finalize: finalizeAssessmentAction,
            discard: discardAssessmentDraftAction,
          },
          diagnosis: { add: addDiagnosisAction, updateStatus: updateDiagnosisStatusAction },
        }}
      />
    );
  }

  const t = await getTranslations('clinical.record');
  if (!overview.ok) {
    return (
      <Card>
        <EmptyState
          icon={FolderOpen}
          title={failed ? t('loadFailed') : t('needRecordTitle')}
          description={failed ? undefined : t('needRecordDescription')}
          action={
            failed ? undefined : (
              <Button asChild>
                <Link href={{ pathname: `/patients/${patientId}`, query: { tab: 'record' } }}>
                  {t('goToRecord')}
                </Link>
              </Button>
            )
          }
        />
      </Card>
    );
  }
  const { record, isMinor } = overview.data;
  const closed = record.status === 'closed';

  if (tab === 'notes') {
    const [notes, config, sessions] = await Promise.all([
      listNotes(ctx, { patientId, limit: 50 }),
      listClinicalConfig(ctx),
      listSessions(ctx, { patientId, limit: 100 }),
    ]);
    return (
      <NotesTab
        recordId={record.id}
        recordClosed={closed}
        notes={notes.ok ? notes.data : []}
        noteTypes={config.ok ? config.data.noteTypes : []}
        sessions={sessions.ok ? sessions.data : []}
        myMembershipId={myMembershipId}
        initialSessionId={sessionId}
        loadFailed={!notes.ok || !config.ok}
        actions={{
          create: createNoteDraftAction,
          update: updateNoteDraftAction,
          finalize: finalizeNoteAction,
          discard: discardNoteDraftAction,
          addendum: createAddendumAction,
          get: getNoteAction,
        }}
      />
    );
  }

  if (tab === 'plan') {
    const plans = await listTreatmentPlans(ctx, patientId);
    const list = plans.ok ? plans.data : [];
    const pick =
      list.find((p) => p.status === 'draft') ?? list.find((p) => p.status === 'active') ?? list[0];
    const current = pick ? await getTreatmentPlan(ctx, pick.id) : null;
    return (
      <PlanTab
        recordId={record.id}
        recordClosed={closed}
        plans={list}
        current={current?.ok ? current.data : null}
        loadFailed={!plans.ok || (current !== null && !current.ok)}
        actions={{
          create: createTreatmentPlanDraftAction,
          update: updateTreatmentPlanDraftAction,
          addGoal: addGoalAction,
          activate: activateTreatmentPlanAction,
          revise: reviseTreatmentPlanAction,
          end: endTreatmentPlanAction,
          goalStatus: updateGoalStatusAction,
          setGoalText: setPatientFacingGoalTextAction,
          withdrawGoalText: withdrawPatientFacingGoalTextAction,
          get: getTreatmentPlanAction,
        }}
      />
    );
  }

  const docs = await listClinicalDocuments(ctx, patientId);
  return (
    <DocumentsTab
      recordId={record.id}
      isMinor={isMinor}
      documents={docs.ok ? docs.data : []}
      loadFailed={!docs.ok}
      actions={{
        upload: uploadClinicalDocumentAction,
        archive: archiveClinicalDocumentAction,
        share: shareClinicalDocumentAction,
        unshare: unshareClinicalDocumentAction,
        url: issueClinicalFileUrlAction,
      }}
    />
  );
}
