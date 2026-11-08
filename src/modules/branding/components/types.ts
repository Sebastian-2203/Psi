/** Result payload of the branding actions (client-safe mirror of the server `Saved` type). */
export type SavedBranding = { updatedAt: string; logoUrl: string | null };

/** Client-safe shape of the server `Result<T>` (API_CONTRACTS §2); must stay structurally identical. */
export type ActionError = {
  code: string;
  messageKey: string;
  fieldErrors?: Record<string, string[]>;
  requestId: string;
  retryable: boolean;
};

export type ActionResult<T> = { ok: true; data: T } | { ok: false; error: ActionError };
