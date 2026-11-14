'use client';

import { useValidationMessage } from '@/components/shared/form-kit';
import type { ActionError } from '@/modules/auth/schemas/result';

/** Translated server field error (validation key) for `name`, if the last action reported one. */
export function useServerFieldError(error: ActionError | null) {
  const v = useValidationMessage();
  return (name: string): string | undefined => v(error?.fieldErrors?.[name]?.[0]);
}

export const todayIso = () => {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
