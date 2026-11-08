import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

/** DESIGN_SYSTEM §6.4: white bg, 1px --input border (>=3:1), 16px text (no iOS zoom). Error: 2px border + message via aria-describedby. */
function Input({ className, type, ...props }: ComponentProps<'input'>) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        'h-(--control-h) w-full min-w-0 rounded-md border border-input bg-card px-3 text-base text-foreground transition-colors placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-2 aria-invalid:border-destructive',
        className,
      )}
      {...props}
    />
  );
}

export { Input };
