import 'server-only';

/** Closed set of application error codes (API_CONTRACTS §3). */
export const ERROR_CODES = [
  'UNAUTHENTICATED',
  'MFA_REQUIRED',
  'FORBIDDEN',
  'NOT_FOUND',
  'VALIDATION_FAILED',
  'CONFLICT',
  'IMMUTABLE_RECORD',
  'PRECONDITION_FAILED',
  'IDEMPOTENCY_MISMATCH',
  'RATE_LIMITED',
  'PAYLOAD_TOO_LARGE',
  'UNSUPPORTED_MEDIA',
  'INTERNAL',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

type ErrorCodeSpec = { httpStatus: number; retryable: boolean; messageKey: string };

export const ERROR_CODE_SPEC: Readonly<Record<ErrorCode, ErrorCodeSpec>> = {
  UNAUTHENTICATED: { httpStatus: 401, retryable: false, messageKey: 'errors.unauthenticated' },
  MFA_REQUIRED: { httpStatus: 401, retryable: false, messageKey: 'errors.mfaRequired' },
  FORBIDDEN: { httpStatus: 403, retryable: false, messageKey: 'errors.forbidden' },
  NOT_FOUND: { httpStatus: 404, retryable: false, messageKey: 'errors.notFound' },
  VALIDATION_FAILED: { httpStatus: 422, retryable: false, messageKey: 'errors.validationFailed' },
  CONFLICT: { httpStatus: 409, retryable: false, messageKey: 'errors.conflict' },
  IMMUTABLE_RECORD: { httpStatus: 409, retryable: false, messageKey: 'errors.immutableRecord' },
  PRECONDITION_FAILED: {
    httpStatus: 412,
    retryable: false,
    messageKey: 'errors.preconditionFailed',
  },
  IDEMPOTENCY_MISMATCH: {
    httpStatus: 422,
    retryable: false,
    messageKey: 'errors.idempotencyMismatch',
  },
  RATE_LIMITED: { httpStatus: 429, retryable: true, messageKey: 'errors.rateLimited' },
  PAYLOAD_TOO_LARGE: { httpStatus: 413, retryable: false, messageKey: 'errors.payloadTooLarge' },
  UNSUPPORTED_MEDIA: { httpStatus: 415, retryable: false, messageKey: 'errors.unsupportedMedia' },
  INTERNAL: { httpStatus: 500, retryable: true, messageKey: 'errors.internal' },
};
