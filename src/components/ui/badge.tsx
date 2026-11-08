import { cva, type VariantProps } from 'class-variance-authority';
import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

/** DESIGN_SYSTEM §6.8: tinted surface + dark text (all >= 5.2:1). Pair with an icon + text, never colour alone. */
const badgeVariants = cva(
  'inline-flex min-h-[22px] items-center gap-1 rounded-full border border-transparent px-2.5 text-xs font-semibold [&_svg]:size-3.5',
  {
    variants: {
      variant: {
        neutral: 'bg-muted text-foreground',
        outline: 'border-input bg-card text-foreground',
        brand: 'bg-brand-surface text-brand-surface-foreground',
        success: 'bg-success-surface text-success-surface-foreground',
        warning: 'border-warning-border bg-warning-surface text-warning-foreground',
        error: 'bg-destructive-surface text-destructive-surface-foreground',
        info: 'bg-info-surface text-info-surface-foreground',
      },
    },
    defaultVariants: { variant: 'neutral' },
  },
);

function Badge({
  className,
  variant,
  ...props
}: ComponentProps<'span'> & VariantProps<typeof badgeVariants>) {
  return (
    <span data-slot="badge" className={cn(badgeVariants({ variant }), className)} {...props} />
  );
}

export { Badge, badgeVariants };
