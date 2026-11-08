import 'server-only';
import { AppError, isAppError, type AppErrorOptions } from './app-error';
import type { ErrorCode } from './codes';
import { mapPostgresError } from './postgres';

/** Serializable error payload returned to clients (API_CONTRACTS §2). */
export type AppErrorPayload = {
  code: ErrorCode;
  messageKey: string;
  fieldErrors?: Record<string, string[]>;
  requestId: string;
  retryable: boolean;
};

export type Result<T> = { ok: true; data: T } | { ok: false; error: AppErrorPayload };

/** Internal result used between server layers before a requestId is attached. */
export type Outcome<T> = { ok: true; data: T } | { ok: false; error: AppError };

export function ok<T>(data: T): { ok: true; data: T } {
  return { ok: true, data };
}

export function failure(
  code: ErrorCode,
  options?: AppErrorOptions,
): { ok: false; error: AppError } {
  return { ok: false, error: new AppError(code, options) };
}

export function toErrorPayload(error: AppError, requestId: string): AppErrorPayload {
  return {
    code: error.code,
    messageKey: error.messageKey,
    ...(error.fieldErrors ? { fieldErrors: error.fieldErrors } : {}),
    requestId,
    retryable: error.retryable,
  };
}

/** Builds a client-facing failed Result. */
export function fail(
  code: ErrorCode,
  requestId: string,
  options?: AppErrorOptions,
): { ok: false; error: AppErrorPayload } {
  return { ok: false, error: toErrorPayload(new AppError(code, options), requestId) };
}

/**
 * Normalizes anything thrown into an AppError: AppErrors pass through, Postgres errors are
 * mapped (unique -> CONFLICT, IMMUTABLE: -> IMMUTABLE_RECORD, ...), everything else -> INTERNAL.
 * Raw messages never reach clients.
 */
export function toAppError(error: unknown): AppError {
  if (isAppError(error)) return error;
  return mapPostgresError(error) ?? new AppError('INTERNAL', { cause: error });
}

/** Converts an internal Outcome to the client Result envelope. */
export function toResult<T>(outcome: Outcome<T>, requestId: string): Result<T> {
  return outcome.ok ? outcome : { ok: false, error: toErrorPayload(outcome.error, requestId) };
}
