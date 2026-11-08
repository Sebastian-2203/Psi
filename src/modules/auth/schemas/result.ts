/**
 * Client-safe shape of the server `Result<T>` (API_CONTRACTS §2), so client components can type
 * server-action props without importing server modules. Must stay structurally identical.
 */
export type ActionError = {
  code: string;
  messageKey: string;
  fieldErrors?: Record<string, string[]>;
  requestId: string;
  retryable: boolean;
};

export type ActionResult<T> = { ok: true; data: T } | { ok: false; error: ActionError };

/** A server action that redirects on success and only returns on failure. */
export type RedirectingAction<I> = (input: I) => Promise<ActionResult<never> | undefined | void>;
