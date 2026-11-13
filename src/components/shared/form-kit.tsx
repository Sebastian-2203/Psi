'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslations } from 'next-intl';
import {
  useEffect,
  useId,
  useRef,
  type ComponentProps,
  type ReactNode,
  type SelectHTMLAttributes,
} from 'react';
import type { FieldValues, Resolver } from 'react-hook-form';
import type { z } from 'zod';
import { Alert } from '@/components/ui/alert';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import type { ActionError } from '@/modules/auth/schemas/result';

/**
 * Shared form building blocks for the Phase 2 screens (DESIGN_SYSTEM §6.4): label above, hint and
 * error tied with aria-describedby, server errors as role="alert" focused when they appear.
 * Server messages arrive as i18n KEYS (never text) and are translated here.
 */

/**
 * Typed resolver for schemas whose input type differs from the output (transforms). Fields listed
 * in `blankToUndefined` (optional selects) are sent as `undefined` when empty. The submit handler
 * receives the PARSED output (trimmed, normalized).
 */
export function schemaResolver<T extends FieldValues>(
  schema: z.ZodType,
  blankToUndefined: readonly string[] = [],
): Resolver<T> {
  const base = zodResolver(schema as never) as unknown as Resolver<T>;
  return (values, context, options) => {
    const prepared = { ...values } as Record<string, unknown>;
    for (const key of blankToUndefined) if (prepared[key] === '') prepared[key] = undefined;
    return base(prepared as typeof values, context, options);
  };
}

/** Translates a server message key; unknown keys fall back to the generic internal error. */
export function useMessage() {
  const t = useTranslations();
  return (key: string, values?: Record<string, string | number>) =>
    t.has(key as never) ? t(key as never, values as never) : t('errors.internal');
}

/** Translates a field validation key of the top-level `validation` namespace. */
export function useValidationMessage() {
  const t = useTranslations('validation');
  return (key: string | undefined): string | undefined => {
    if (!key) return undefined;
    return t.has(key as never) ? t(key as never) : t('fieldRequired');
  };
}

function ids(base: string, hint?: string, error?: string) {
  const hintId = hint ? `${base}-hint` : undefined;
  const errorId = error ? `${base}-error` : undefined;
  return { hintId, errorId, describedBy: [hintId, errorId].filter(Boolean).join(' ') || undefined };
}

function FieldShell({
  id,
  label,
  hint,
  error,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  children: ReactNode;
}) {
  const { hintId, errorId } = ids(id, hint, error);
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
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

type FieldProps = Omit<ComponentProps<typeof Input>, 'id'> & {
  label: string;
  hint?: string;
  error?: string;
};

export function FormField({ label, hint, error, ...inputProps }: FieldProps) {
  const id = useId();
  const { describedBy } = ids(id, hint, error);
  return (
    <FieldShell id={id} label={label} hint={hint} error={error}>
      <Input
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        {...inputProps}
      />
    </FieldShell>
  );
}

export function TextAreaField({
  label,
  hint,
  error,
  ...props
}: Omit<ComponentProps<typeof Textarea>, 'id'> & { label: string; hint?: string; error?: string }) {
  const id = useId();
  const { describedBy } = ids(id, hint, error);
  return (
    <FieldShell id={id} label={label} hint={hint} error={error}>
      <Textarea
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        {...props}
      />
    </FieldShell>
  );
}

/** Native select (best mobile + AT support), styled like the Input. */
export function SelectField({
  label,
  hint,
  error,
  children,
  className,
  ...props
}: Omit<SelectHTMLAttributes<HTMLSelectElement>, 'id'> & {
  label: string;
  hint?: string;
  error?: string;
}) {
  const id = useId();
  const { describedBy } = ids(id, hint, error);
  return (
    <FieldShell id={id} label={label} hint={hint} error={error}>
      <select
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={
          className ??
          'h-(--control-h) w-full rounded-md border border-input bg-card px-3 text-base aria-invalid:border-2 aria-invalid:border-destructive'
        }
        {...props}
      >
        {children}
      </select>
    </FieldShell>
  );
}

export function CheckField({
  label,
  hint,
  checked,
  onCheckedChange,
  error,
  disabled,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onCheckedChange: (next: boolean) => void;
  error?: string;
  disabled?: boolean;
}) {
  const id = useId();
  const { describedBy } = ids(id, hint, error);
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-start gap-3">
        <Checkbox
          id={id}
          checked={checked}
          disabled={disabled}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          onCheckedChange={(next) => onCheckedChange(next === true)}
          className="mt-0.5"
        />
        <Label htmlFor={id} className="font-normal">
          {label}
        </Label>
      </div>
      {hint ? (
        <p id={`${id}-hint`} className="ml-9 text-sm text-muted-foreground">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={`${id}-error`} className="ml-9 text-sm font-semibold text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** Form-level server error: role="alert", focused when it appears. */
export function FormError({ error }: { error: ActionError | null }) {
  const message = useMessage();
  const t = useTranslations('errors');
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (error) ref.current?.focus();
  }, [error]);
  if (!error) return null;
  return (
    <div ref={ref} tabIndex={-1} className="outline-none" data-testid="form-error">
      <Alert variant="error">
        <p>{message(error.messageKey)}</p>
        {error.code === 'INTERNAL' ? (
          <p className="text-xs opacity-80">{t('reference', { id: error.requestId })}</p>
        ) : null}
      </Alert>
    </div>
  );
}

/** Maps server field errors (validation keys) onto react-hook-form fields. Returns true if any applied. */
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

/** Strips empty strings so optional schema fields stay `undefined`. */
export function compact<T extends Record<string, unknown>>(values: T): T {
  return Object.fromEntries(
    Object.entries(values).filter(([, v]) => v !== '' && v !== undefined),
  ) as T;
}

/** Maps client-side Zod issues (message = validation key) onto react-hook-form fields. */
export function setZodErrors(
  error: z.ZodError,
  setError: (name: never, value: { type: string; message: string }) => void,
  fields: readonly string[],
): void {
  const seen = new Set<string>();
  for (const issue of error.issues) {
    const field = String(issue.path[0] ?? '');
    if (fields.includes(field) && !seen.has(field)) {
      seen.add(field);
      setError(field as never, { type: 'validate', message: issue.message });
    }
  }
}
