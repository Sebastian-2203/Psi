import type { ActionResult } from '@/modules/auth/schemas/result';

/** Client-safe DTO mirrors of the data-request queries (structurally identical). */
export type DataRequestStatus =
  'received' | 'in_review' | 'fulfilled' | 'partially_fulfilled' | 'rejected';
export type DataRequestType = 'access' | 'rectification';

export type MyDataRequestDto = {
  requestId: string;
  requestType: string;
  status: DataRequestStatus;
  receivedAt: string;
  dueAt: string | null;
  resolvedAt: string | null;
  resolutionSummary: string | null;
};

export type StaffDataRequestDto = MyDataRequestDto & {
  subjectType: 'patient' | 'guardian';
  subjectPatientId: string | null;
  subjectName: string | null;
  requesterNote: string | null;
};

export type SubmitAction = (input: {
  requestType: DataRequestType;
  note?: string;
}) => Promise<ActionResult<{ requestId: string }>>;

export type UpdateAction = (input: {
  requestId: string;
  status: DataRequestStatus;
  resolutionSummary?: string;
  dueDate?: string;
}) => Promise<ActionResult<{ requestId: string }>>;
