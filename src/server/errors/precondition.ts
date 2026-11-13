import 'server-only';
import { AppError } from './app-error';
import { toAppError } from './result';

/**
 * Refines a mapped Postgres error into a user-facing message key. The DB raises
 * `PRECONDITION:<machine_key>` (errcode P0001); `mapPostgresError` keeps the prefix as the
 * internal `detail`. Modules pass an allowlist `machine_key -> i18n key`; anything not listed
 * keeps the generic key, and the raw DB message never reaches the client.
 */
export function refinePrecondition(
  error: AppError,
  keys: Readonly<Record<string, string>>,
): AppError {
  if (error.code !== 'PRECONDITION_FAILED' || !error.detail) return error;
  const machineKey = error.detail.replace(/^PRECONDITION:/, '');
  const messageKey = keys[machineKey];
  if (!messageKey) return error;
  return new AppError('PRECONDITION_FAILED', {
    messageKey,
    cause: error.cause,
    detail: error.detail,
  });
}

/** `toAppError` + `refinePrecondition` as an Outcome failure (the usual `catch` body). */
export function dbFailure(
  error: unknown,
  keys: Readonly<Record<string, string>> = {},
): { ok: false; error: AppError } {
  return { ok: false, error: refinePrecondition(toAppError(error), keys) };
}
