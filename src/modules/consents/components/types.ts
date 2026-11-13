import type { ActionResult } from '@/modules/auth/schemas/result';
import type {
  CreateConsentTemplateInput,
  SaveConsentVersionDraftInput,
} from '@/modules/consents/schemas';

type A<I, O = unknown> = (input: I) => Promise<ActionResult<O>>;

export type ConsentRecordStatus = 'accepted' | 'declined' | 'withdrawn';

export type ConsentStatusEntryDto = {
  consentRecordId: string;
  templateId: string;
  templateKey: string;
  title: string;
  consentType: string;
  versionId: string;
  signerType: 'patient' | 'guardian' | 'professional_recorded';
  method: string;
  status: ConsentRecordStatus;
  acceptedAt: string;
  withdrawnAt: string | null;
};

export type SignableConsentDto = {
  patientId: string;
  templateId: string;
  templateKey: string;
  consentType: string;
  signerRequirement: string;
  versionId: string;
  locale: 'es' | 'en';
  title: string;
  body: unknown;
  bodyHash: string;
  myStatus: ConsentRecordStatus | null;
  myConsentRecordId: string | null;
};

export type ConsentActions = {
  record: A<{
    patientId: string;
    versionId: string;
    signerType: 'patient' | 'guardian';
    patientGuardianId?: string;
    method: 'verbal_recorded';
    decision: 'accepted' | 'declined';
    decidedAt: string;
  }>;
  withdraw: A<{ consentRecordId: string; reason: string }>;
};

export type TemplateActions = {
  createTemplate: A<CreateConsentTemplateInput, { templateId: string }>;
  saveDraft: A<SaveConsentVersionDraftInput, { versionId: string }>;
  publish: A<{ versionId: string }, { bodyHash: string; publishedAt: string }>;
};
