import { cva, type VariantProps } from 'class-variance-authority';
import { CircleAlert, CircleCheck, Info, TriangleAlert, type LucideIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

/**
 * DESIGN_SYSTEM §3.5 / §6.10: tinted container + 4px left border + icon + visually-hidden status
 * word. Meaning is never carried by colour alone. Errors use role="alert".
 */
const alertVariants = cva('relative flex gap-3 rounded-md border-l-4 p-4 text-sm', {
  variants: {
    variant: {
      error: 'border-destructive bg-destructive-surface text-destructive-surface-foreground',
      info: 'border-info bg-info-surface text-info-surface-foreground',
      success: 'border-success bg-success-surface text-success-surface-foreground',
      warning: 'border-warning-border bg-warning-surface text-warning-foreground',
    },
  },
  defaultVariants: { variant: 'info' },
});

type AlertVariant = NonNullable<VariantProps<typeof alertVariants>['variant']>;

const icons: Record<AlertVariant, LucideIcon> = {
  error: CircleAlert,
  info: Info,
  success: CircleCheck,
  warning: TriangleAlert,
};

function Alert({
  className,
  variant = 'info',
  children,
  ...props
}: Omit<ComponentProps<'div'>, 'role'> & { variant?: AlertVariant }) {
  const t = useTranslations('common.alert');
  const Icon = icons[variant];
  return (
    <div
      data-slot="alert"
      role={variant === 'error' ? 'alert' : 'status'}
      className={cn(alertVariants({ variant }), className)}
      {...props}
    >
      <Icon className="mt-0.5 size-5 shrink-0" aria-hidden />
      <div className="flex flex-col gap-1">
        <span className="sr-only">{t(variant)}</span>
        {children}
      </div>
    </div>
  );
}

function AlertTitle({ className, ...props }: ComponentProps<'p'>) {
  return <p data-slot="alert-title" className={cn('font-bold', className)} {...props} />;
}

function AlertDescription({ className, ...props }: ComponentProps<'div'>) {
  return <div data-slot="alert-description" className={cn(className)} {...props} />;
}

export { Alert, AlertDescription, AlertTitle, alertVariants };
