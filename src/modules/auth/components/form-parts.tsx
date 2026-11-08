'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useId, useRef, type ComponentProps, type ReactNode } from 'react';
import { Alert } from '@/components/ui/alert';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { VALIDATION_KEYS, type ValidationKey } from '@/modules/auth/schemas';
import type { ActionError } from '@/modules/auth/schemas/result';

/** Translates an i18n key coming from the server (unknown keys fall back to errors.internal). */
export function useMessage() {
  const t = useTranslations();
  return (key: string, values?: Record<string, string | number>) =>
    // Keys come from the server's closed set; unknown keys fall back to a generic message.
    t.has(key as never) ? t(key as never, values as never) : t('errors.internal');
}

export function useValidationMessage() {
  const t = useTranslations('auth.validation');
  return (key: string | undefined): string | undefined => {
    if (!key) return undefined;
    return (VALIDATION_KEYS as readonly string[]).includes(key)
      ? t(key as ValidationKey)
      : t('fieldRequired');
  };
}

type FieldProps = Omit<ComponentProps<typeof Input>, 'id'> & {
  label: string;
  hint?: string;
  /** Translated error message. Sets aria-invalid and aria-describedby. */
  error?: string;
};

/** Label above, hint + error associated through aria-describedby (DESIGN_SYSTEM §6.4). */
export function FormField({ label, hint, error, ...inputProps }: FieldProps) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined;
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        {...inputProps}
      />
      {hint ? (
        <p id={hintId} className="text-sm text-muted-foreground">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} className="text-sm font-semibold text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** Form-level server error: role="alert", focused when it appears (focus management). */
export function FormError({ error }: { error: ActionError | null }) {
  const message = useMessage();
  const t = useTranslations('errors');
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (error) ref.current?.focus();
  }, [error]);
  if (!error) return null;
  return (
    <div ref={ref} tabIndex={-1} className="outline-none">
      <Alert variant="error">
        <p>{message(error.messageKey)}</p>
        {error.code === 'INTERNAL' ? (
          <p className="text-xs opacity-80">{t('reference', { id: error.requestId })}</p>
        ) : null}
      </Alert>
    </div>
  );
}

export function FormNotice({
  children,
  variant = 'info',
}: {
  children: ReactNode;
  variant?: 'info' | 'success' | 'warning';
}) {
  return <Alert variant={variant}>{children}</Alert>;
}

/** Maps server field errors (validation keys) onto react-hook-form fields. */
export function applyFieldErrors(
  error: ActionError,
  setError: (name: never, value: { type: string; message: string }) => void,
  fields: readonly string[],
): boolean {
  let applied = false;
  for (const [field, keys] of Object.entries(error.fieldErrors ?? {})) {
    if (fields.includes(field) && keys[0]) {
      setError(field as never, { type: 'server', message: keys[0] });
      applied = true;
    }
  }
  return applied;
}
