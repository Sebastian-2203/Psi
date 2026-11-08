import { Slot } from 'radix-ui';
import { cva, type VariantProps } from 'class-variance-authority';
import { Loader2 } from 'lucide-react';
import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

/**
 * DESIGN_SYSTEM §6.1. Heights come from the context (`--control-h`: 40 professional / 48 portal /
 * 56 child) so one component serves every context. `destructive` is OUTLINE by design; the filled
 * `destructive-solid` is for confirmation dialogs only. Include an icon + text with destructive.
 */
const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 rounded-md border border-transparent font-bold whitespace-nowrap transition-colors duration-(--duration-fast) disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-5",
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground hover:bg-primary-hover',
        secondary: 'border-border bg-secondary text-secondary-foreground hover:bg-accent',
        outline: 'border-input bg-card text-foreground hover:bg-accent',
        ghost: 'text-foreground hover:bg-accent',
        destructive: 'border-destructive bg-card text-destructive hover:bg-destructive-surface',
        'destructive-solid': 'bg-destructive text-destructive-foreground hover:opacity-90',
        link: 'text-primary hover:text-primary-hover h-auto min-h-0 px-0 underline underline-offset-4 hover:decoration-2',
      },
      size: {
        sm: 'h-8 min-h-(--target-min) px-3 text-[0.9375rem]',
        default: 'h-(--control-h) min-h-(--target-min) px-4 text-[0.9375rem]',
        lg: 'h-12 min-h-(--target-min) px-6 text-base',
        icon: 'size-(--control-h) min-h-(--target-min) min-w-(--target-min)',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
);

type ButtonProps = ComponentProps<'button'> &
  VariantProps<typeof buttonVariants> & { asChild?: boolean; loading?: boolean };

function Button({
  className,
  variant,
  size,
  asChild = false,
  loading,
  children,
  disabled,
  ...props
}: ButtonProps) {
  const Comp = asChild ? Slot.Root : 'button';
  return (
    <Comp
      data-slot="button"
      className={cn(buttonVariants({ variant, size }), className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {asChild ? (
        children
      ) : (
        <>
          {loading ? <Loader2 className="animate-spin" aria-hidden /> : null}
          {children}
        </>
      )}
    </Comp>
  );
}

export { Button, buttonVariants };
