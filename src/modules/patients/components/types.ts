import type { ActionResult } from '@/modules/auth/schemas/result';
import type { CreatePatientInput } from '@/modules/patients/schemas';

/** Client-safe DTO mirrors of the patient server queries (structurally identical). */
export type PatientStatus = 'intake' | 'active' | 'paused' | 'discharged' | 'archived';

export type PatientSummaryDto = {
  patientId: string;
  firstName: string;
  lastName: string;
  preferredName: string | null;
  status: PatientStatus;
  isMinor: boolean | null;
  updatedAt: string;
};

export type DirectoryEntryDto = {
  patientId: string;
  firstName: string;
  lastName: string;
  preferredName: string | null;
  status: PatientStatus;
  onMyCareTeam: boolean;
};

export type PatientDetailDto = PatientSummaryDto & {
  dateOfBirth: string;
  majorityDate: string | null;
  pronouns: string | null;
  documentType: string | null;
  documentNumber: string | null;
  email: string | null;
  phone: string | null;
  sex: string | null;
  genderIdentity: string | null;
  preferredLocale: 'es' | 'en' | null;
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
  hasPortalLogin: boolean;
  preferences: {
    portalMode: 'child' | 'adolescent' | 'adult';
    locale: 'es' | 'en' | null;
    notifyEmail: boolean;
    textSize: number;
    reducedMotion: boolean;
    audioInstructions: boolean;
  } | null;
  careTeam: Array<{
    careTeamMemberId: string;
    membershipId: string;
    displayName: string | null;
    careRole: 'primary' | 'secondary' | 'supervisor';
    startsAt: string;
  }>;
  activationMissing: string[];
};

export type Action<I, O> = (input: I) => Promise<ActionResult<O>>;

export type CreatePatientValues = CreatePatientInput;
