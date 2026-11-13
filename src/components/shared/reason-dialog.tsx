'use client';

import { useTranslations } from 'next-intl';
import { useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import type { ActionError, ActionResult } from '@/modules/auth/schemas/result';
import { FormError, SelectField, TextAreaField, useValidationMessage } from './form-kit';

type Option = { value: string; label: string };

/**
 * Confirmation dialog that asks for a reason (free text, min 3 chars) or a choice from a closed
 * list. Destructive confirmations name the object (title) and use `destructive-solid` (§6.9).
 */
export function ReasonDialog({
  trigger,
  title,
  description,
  confirmLabel,
  destructive = false,
  reasonLabel,
  options,
  optionalReason = false,
  minLength = 3,
  action,
  onDone,
}: {
  trigger: ReactNode;
  title: string;
  description?: string;
  confirmLabel: string;
  destructive?: boolean;
  reasonLabel: string;
  /** When set, the reason is chosen from this list instead of typed. */
  options?: Option[];
  optionalReason?: boolean;
  minLength?: number;
  action: (reason: string) => Promise<ActionResult<unknown>>;
  onDone?: () => void;
}) {
  const tc = useTranslations('common');
  const v = useValidationMessage();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState(options?.[0]?.value ?? '');
  const [fieldError, setFieldError] = useState<string | undefined>();
  const [serverError, setServerError] = useState<ActionError | null>(null);
  const [busy, setBusy] = useState(false);

  async function confirm() {
    const value = reason.trim();
    setServerError(null);
    if (!optionalReason && value.length < minLength) {
      setFieldError(v(value.length === 0 ? 'fieldRequired' : 'fieldTooShort'));
      return;
    }
    if (optionalReason && value.length > 0 && value.length < minLength) {
      setFieldError(v('fieldTooShort'));
      return;
    }
    setFieldError(undefined);
    setBusy(true);
    const result = await action(value);
    setBusy(false);
    if (result.ok) {
      setOpen(false);
      onDone?.();
    } else setServerError(result.error);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          setServerError(null);
          setFieldError(undefined);
        }
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : null}
        </DialogHeader>
        <FormError error={serverError} />
        {options ? (
          <SelectField
            label={reasonLabel}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            error={fieldError}
          >
            {options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </SelectField>
        ) : (
          <TextAreaField
            label={reasonLabel}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            error={fieldError}
            maxLength={500}
          />
        )}
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="outline" onClick={() => setOpen(false)}>
            {tc('cancel')}
          </Button>
          <Button
            variant={destructive ? 'destructive-solid' : 'default'}
            onClick={confirm}
            loading={busy}
          >
            {confirmLabel}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
