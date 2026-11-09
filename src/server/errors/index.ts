import 'server-only';

export { ERROR_CODES, ERROR_CODE_SPEC, type ErrorCode } from './codes';
export { AppError, isAppError, type AppErrorOptions } from './app-error';
export { mapPostgresError } from './postgres';
export { dbFailure, refinePrecondition } from './precondition';
export {
  fail,
  failure,
  ok,
  toAppError,
  toErrorPayload,
  toResult,
  type AppErrorPayload,
  type Outcome,
  type Result,
} from './result';
