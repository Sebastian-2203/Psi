'use client';

import { X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Dialog as SheetPrimitive } from 'radix-ui';
import type { ComponentProps } from 'react';
import { usePortalContainer } from '@/components/shared/context-scope';
import { cn } from '@/lib/utils';

const Sheet = SheetPrimitive.Root;
const SheetTrigger = SheetPrimitive.Trigger;
const SheetClose = SheetPrimitive.Close;

/** Side drawer built on Dialog (focus trap, Esc, aria-modal). Used for the mobile professional menu. */
function SheetContent({
  className,
  children,
  side = 'left',
  ...props
}: ComponentProps<typeof SheetPrimitive.Content> & { side?: 'left' | 'right' }) {
  const t = useTranslations('common');
  const container = usePortalContainer();
  return (
    <SheetPrimitive.Portal container={container}>
      <SheetPrimitive.Overlay className="fixed inset-0 z-50 bg-overlay data-[state=open]:animate-in data-[state=open]:fade-in-0" />
      <SheetPrimitive.Content
        data-slot="sheet-content"
        className={cn(
          'fixed inset-y-0 z-50 flex w-72 max-w-[85vw] flex-col gap-4 bg-sidebar p-4 text-foreground shadow-3 data-[state=open]:animate-in',
          side === 'left'
            ? 'left-0 border-r data-[state=open]:slide-in-from-left'
            : 'right-0 border-l data-[state=open]:slide-in-from-right',
          className,
        )}
        {...props}
      >
        {children}
        <SheetPrimitive.Close className="absolute top-3 right-3 inline-flex size-11 items-center justify-center rounded-md hover:bg-accent">
          <X className="size-5" aria-hidden />
          <span className="sr-only">{t('close')}</span>
        </SheetPrimitive.Close>
      </SheetPrimitive.Content>
    </SheetPrimitive.Portal>
  );
}

function SheetTitle({ className, ...props }: ComponentProps<typeof SheetPrimitive.Title>) {
  return <SheetPrimitive.Title className={cn('text-h3 font-bold', className)} {...props} />;
}

function SheetDescription(props: ComponentProps<typeof SheetPrimitive.Description>) {
  return <SheetPrimitive.Description {...props} />;
}

export { Sheet, SheetClose, SheetContent, SheetDescription, SheetTitle, SheetTrigger };
