'use client';

import { useTranslations } from 'next-intl';
import { useState, type ReactNode } from 'react';
import { FormError } from '@/components/shared/form-kit';
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

/** Confirmation without a reason. Names the object in the title; destructive uses `destructive-solid`. */
export function ConfirmDialog({
  trigger,
  title,
  description,
  confirmLabel,
  destructive = false,
  action,
  onDone,
}: {
  trigger: ReactNode;
  title: string;
  description: string;
  confirmLabel: string;
  destructive?: boolean;
  action: () => Promise<ActionResult<unknown>>;
  onDone: () => void;
}) {
  const tc = useTranslations('common');
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ActionError | null>(null);

  async function confirm() {
    setError(null);
    setBusy(true);
    const result = await action();
    setBusy(false);
    if (result.ok) {
      setOpen(false);
      onDone();
    } else setError(result.error);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setError(null);
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <FormError error={error} />
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
