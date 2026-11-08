import { DEFAULT_BRAND } from '@/styles/default-brand';
import { cn } from '@/lib/utils';

/**
 * Practice name as live text. The low-res PNG logo is NOT used in the UI.
 * `display` uses Playfair Display (only at >= 24px per DESIGN_SYSTEM §4.2); otherwise Nunito Sans bold.
 * TODO(branding): swap for the vector logo lockup when the client supplies it; the name comes from
 * `organization_branding.display_name` for the resolved tenant.
 */
export function PracticeName({
  className,
  display = false,
  name = DEFAULT_BRAND.displayName,
}: {
  className?: string;
  display?: boolean;
  name?: string;
}) {
  return (
    <span
      className={cn(
        display
          ? 'font-display text-2xl leading-tight font-semibold'
          : 'text-base leading-tight font-bold',
        className,
      )}
    >
      {name}
    </span>
  );
}
