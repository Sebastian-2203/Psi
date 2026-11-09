import 'server-only';
import type { z } from 'zod';
import { zodFieldErrors } from '@/lib/validation';
import { getRequestMeta } from '@/server/auth/request-meta';
import { getAuthzContext, type AuthzContext } from '@/server/authz';
import {
  fail,
  toAppError,
  toErrorPayload,
  toResult,
  type Outcome,
  type Result,
} from '@/server/errors';

/**
 * Thin server-action runner (API_CONTRACTS §2, ARCHITECTURE §6): Zod `.strict()` parse ->
 * getAuthzContext -> use case (permission check + one user transaction + audit live in the
 * use case) -> `Result`. Raw errors never reach the client: only a code, an i18n messageKey,
 * field error KEYS and the requestId.
 */
export async function runAction<S extends z.ZodType, T>(
  schema: S,
  input: unknown,
  work: (ctx: AuthzContext, data: z.output<S>) => Promise<Outcome<T>>,
): Promise<Result<T>> {
  const meta = await getRequestMeta();
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    return fail('VALIDATION_FAILED', meta.requestId, { fieldErrors: zodFieldErrors(parsed.error) });
  }
  try {
    const context = await getAuthzContext();
    if (!context.ok) return toResult(context, meta.requestId);
    return toResult(await work(context.data, parsed.data), context.data.requestId);
  } catch (error) {
    return { ok: false, error: toErrorPayload(toAppError(error), meta.requestId) };
  }
}
