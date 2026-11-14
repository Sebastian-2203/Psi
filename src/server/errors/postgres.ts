import 'server-only';
import { AppError } from './app-error';
import type { ErrorCode } from './codes';

type PgLikeError = { code?: unknown; message?: unknown };

function isPgLikeError(value: unknown): value is PgLikeError & { code: string; message: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as PgLikeError).code === 'string' &&
    typeof (value as PgLikeError).message === 'string'
  );
}

/** Message prefixes raised by our SQL functions/triggers (errcode P0001). */
const PREFIX_TO_CODE: ReadonlyArray<[prefix: string, code: ErrorCode]> = [
  ['IMMUTABLE:', 'IMMUTABLE_RECORD'],
  ['PRECONDITION:', 'PRECONDITION_FAILED'],
  ['NOT_FOUND:', 'NOT_FOUND'],
  ['RATE_LIMITED:', 'RATE_LIMITED'],
  ['NOT_IMPLEMENTED:', 'PRECONDITION_FAILED'],
  ['AUDIT:', 'INTERNAL'],
  ['RATE_LIMIT:', 'INTERNAL'],
];

/**
 * Maps a Postgres error (postgres.js PostgresError) to an AppError, or null if it is not one.
 * Only the SQLSTATE and our own message prefix are inspected; DB text is kept as internal
 * `detail` (PHI-free by construction of our messages) and never shown to users.
 */
export function mapPostgresError(error: unknown): AppError | null {
  if (!isPgLikeError(error)) return null;
  const { code, message } = error;

  if (code === 'P0001') {
    const match = PREFIX_TO_CODE.find(([prefix]) => message.startsWith(prefix));
    if (match) return new AppError(match[1], { cause: error, detail: message.slice(0, 120) });
    return new AppError('INTERNAL', { cause: error, detail: 'P0001' });
  }

  switch (code) {
    case '23505': // unique_violation
    case '40001': // serialization_failure
      return new AppError('CONFLICT', { cause: error, detail: code });
    case '23503': // foreign_key_violation (incl. composite tenant FKs) -> do not reveal targets
      return new AppError('NOT_FOUND', { cause: error, detail: code });
    case '23514': // check_violation
    case '23502': // not_null_violation
    case '22P02': // invalid_text_representation
    case '22001': // string_data_right_truncation
      return new AppError('VALIDATION_FAILED', { cause: error, detail: code });
    case '42501': // insufficient_privilege / RLS WITH CHECK violation
      return new AppError('FORBIDDEN', { cause: error, detail: code });
    case '57014': // query_canceled (statement_timeout)
      return new AppError('INTERNAL', { cause: error, detail: code });
    default:
      return new AppError('INTERNAL', { cause: error, detail: code });
  }
}
