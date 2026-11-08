import 'server-only';
import { ERROR_CODE_SPEC, type ErrorCode } from './codes';

export type AppErrorOptions = {
  /** Overrides the default i18n key of the code. Never a raw DB/driver message. */
  messageKey?: string;
  /** i18n keys per field (VALIDATION_FAILED only). */
  fieldErrors?: Record<string, string[]>;
  /** Internal cause for logs; never serialized to clients. */
  cause?: unknown;
  /** Internal, PHI-free detail for logs (e.g. the DB error prefix). */
  detail?: string;
};

/** Application error with a code from the closed set (ARCHITECTURE §13). */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly messageKey: string;
  readonly fieldErrors?: Record<string, string[]>;
  readonly detail?: string;

  constructor(code: ErrorCode, options: AppErrorOptions = {}) {
    super(options.detail ? `${code}: ${options.detail}` : code, { cause: options.cause });
    this.name = 'AppError';
    this.code = code;
    this.messageKey = options.messageKey ?? ERROR_CODE_SPEC[code].messageKey;
    this.fieldErrors = options.fieldErrors;
    this.detail = options.detail;
  }

  get httpStatus(): number {
    return ERROR_CODE_SPEC[this.code].httpStatus;
  }

  get retryable(): boolean {
    return ERROR_CODE_SPEC[this.code].retryable;
  }
}

export function isAppError(value: unknown): value is AppError {
  return value instanceof AppError;
}
