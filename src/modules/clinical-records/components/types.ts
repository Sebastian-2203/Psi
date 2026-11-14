import type { RichText } from '@/lib/rich-text';
import type { ActionResult } from '@/modules/auth/schemas/result';

/**
 * Client-safe mirrors of the Phase 3 server DTOs (clinical-records, notes, treatment, sessions,
 * documents). Components may not import module server code (ESLint), so the shapes are repeated
 * here and kept structurally identical to the server types.
 */
export type { RichText };
export type Action<I, O = unknown> = (input: I) => Promise<ActionResult<O>>;

export type SectionDefinitionDto = {
  id: string;
  key: string;
  title: string;
  description: string | null;
  audience: 'any' | 'adult' | 'minor';
  isRequired: boolean;
  position: number;
  isActive: boolean;
};
export type NoteTypeDto = {
  id: string;
  key: string;
  label: string;
  description: string | null;
  position: number;
  isActive: boolean;
};
export type RecordSectionDto = {
  definition: SectionDefinitionDto;
  section: {
    id: string;
    content: RichText;
    contentLocale: 'es' | 'en';
    revision: number;
    lastEditedByMembershipId: string;
    updatedAt: string;
  } | null;
};
export type DiagnosisStatus = 'provisional' | 'confirmed' | 'ruled_out' | 'resolved';
export type CodeSystem = 'cie10' | 'cie11' | 'dsm5tr' | 'other';
export type DiagnosisDto = {
  id: string;
  codeSystem: CodeSystem;
  code: string | null;
  label: string;
  status: DiagnosisStatus;
  diagnosedOn: string;
  resolvedOn: string | null;
  recordedByMembershipId: string;
};
export type RecordOverviewDto = {
  record: {
    id: string;
    patientId: string;
    recordNumber: string;
    status: 'open' | 'closed';
    openedAt: string;
    closedAt: string | null;
    closureSummary: RichText | null;
    reopenedAt: string | null;
  };
  isMinor: boolean;
  sections: RecordSectionDto[];
  diagnoses: DiagnosisDto[];
  activePlan: { id: string; version: number; activatedAt: string | null; goalCount: number } | null;
  draftPlanId: string | null;
};
export type SectionRevisionDto = {
  revision: number;
  content: RichText;
  contentLocale: 'es' | 'en';
  editedByMembershipId: string;
  editedAt: string;
};
export type AssessmentDto = {
  id: string;
  assessedOn: string;
  instrumentName: string;
  instrumentReference: string | null;
  administeredBy: string | null;
  results: RichText;
  interpretation: RichText | null;
  attachmentFileId: string | null;
  correctsAssessmentId: string | null;
  status: 'draft' | 'finalized';
  authorMembershipId: string;
  authorName: string | null;
  finalizedAt: string | null;
  updatedAt: string;
};

export type AddendumReason = 'correction' | 'clarification' | 'late_entry' | 'other';
export type AddendumDto = {
  id: string;
  reason: AddendumReason;
  body: RichText;
  contentLocale: 'es' | 'en';
  authorMembershipId: string;
  authorName: string | null;
  contentHash: string;
  createdAt: string;
};
export type NoteSummaryDto = {
  id: string;
  noteTypeId: string;
  therapySessionId: string | null;
  status: 'draft' | 'finalized';
  authorMembershipId: string;
  authorName: string | null;
  createdAt: string;
  updatedAt: string;
  finalizedAt: string | null;
  addendumCount: number;
};
export type NoteWithAddendaDto = NoteSummaryDto & {
  patientId: string;
  body: RichText;
  contentLocale: 'es' | 'en';
  contentHash: string | null;
  addenda: AddendumDto[];
};

export type SessionStatus =
  'scheduled' | 'held' | 'cancelled_by_patient' | 'cancelled_by_psychologist' | 'no_show';
export type SessionModality = 'in_person' | 'remote_external' | 'phone';
export type SessionDto = {
  id: string;
  patientId: string;
  psychologistMembershipId: string;
  treatmentPlanId: string | null;
  start: string;
  end: string;
  status: SessionStatus;
  modality: SessionModality;
  cancelledReason: string | null;
  locationOrLink: string | null;
  noteState: 'none' | 'draft' | 'finalized';
  updatedAt: string;
};
export type PortalSessionDto = {
  sessionId: string;
  start: string;
  end: string;
  status: SessionStatus;
  modality: SessionModality;
};

export type GoalStatus = 'open' | 'in_progress' | 'achieved' | 'discontinued';
export type PlanStatus = 'draft' | 'active' | 'completed' | 'superseded' | 'discontinued';
export type GoalDto = {
  id: string;
  position: number;
  description: RichText;
  status: GoalStatus;
  targetDate: string | null;
  achievedAt: string | null;
  patientFacingText: RichText | null;
  patientFacingWithdrawnAt: string | null;
};
export type PlanDto = {
  id: string;
  patientId: string;
  recordId: string;
  version: number;
  status: PlanStatus;
  supersedesPlanId: string | null;
  summary: RichText;
  interventions: RichText | null;
  frequency: string | null;
  startDate: string;
  reviewDate: string | null;
  authorMembershipId: string;
  activatedAt: string | null;
  endedAt: string | null;
  updatedAt: string;
  goals: GoalDto[];
};
export type PlanSummaryDto = Omit<PlanDto, 'goals' | 'summary' | 'interventions'> & {
  goalCount: number;
};
export type PortalGoalDto = { goalId: string; patientFacingText: RichText; status: GoalStatus };

export type DocumentType =
  'referral' | 'report' | 'external_evaluation' | 'consent_scan' | 'certificate' | 'other';
export type ClinicalDocumentDto = {
  id: string;
  patientId: string;
  recordId: string;
  fileObjectId: string;
  documentType: DocumentType;
  title: string;
  documentDate: string | null;
  description: string | null;
  supersedesDocumentId: string | null;
  mimeType: string;
  sizeBytes: number;
  displayName: string;
  uploadedByMembershipId: string;
  createdAt: string;
  archivedAt: string | null;
  activeShare: { shareId: string; guardianVisible: boolean; sharedAt: string } | null;
};
export type PortalDocumentDto = {
  documentId: string;
  title: string;
  documentType: DocumentType;
  documentDate: string | null;
  mimeType: string;
  sizeBytes: number;
  sharedAt: string;
};
export type SignedUrlDto = { url: string; expiresInSeconds: number };
