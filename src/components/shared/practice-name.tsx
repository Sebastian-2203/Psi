'use client';

import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import { useTenantBrand } from './tenant-brand';

/**
 * Practice name as live text, preceded by the organization's uploaded logo when there is one
 * (public `branding` bucket; PNG/JPEG/WebP only). The name always stays as text.
 * `display` uses Playfair Display (only at >= 24px per DESIGN_SYSTEM §4.2); otherwise Nunito Sans bold.
 * Name and logo come from the host's organization branding (TenantBrandProvider); the default is
 * the provisional Daniela Ortega brand.
 */
export function PracticeName({
  className,
  display = false,
  name,
  logoUrl,
}: {
  className?: string;
  display?: boolean;
  /** Overrides the tenant value (settings preview). */
  name?: string;
  logoUrl?: string | null;
}) {
  const tenant = useTenantBrand();
  const t = useTranslations('common');
  const shownName = name ?? tenant.displayName;
  const shownLogo = logoUrl === undefined ? tenant.logoUrl : logoUrl;
  return (
    <span
      className={cn(
        'inline-flex max-w-full min-w-0 items-center gap-2',
        display && 'flex-col gap-3 sm:flex-row',
        className,
      )}
    >
      {shownLogo ? (
        // Plain <img>: tenant logos are validated raster files from our public bucket (no next/image remote config).
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={shownLogo}
          alt={t('logoAlt', { name: shownName })}
          className={cn('w-auto shrink-0 object-contain', display ? 'max-h-16' : 'max-h-8')}
          height={display ? 64 : 32}
        />
      ) : null}
      <span
        className={cn(
          'min-w-0',
          display
            ? 'text-center font-display text-2xl leading-tight font-semibold sm:text-left'
            : 'truncate text-base leading-tight font-bold',
        )}
      >
        {shownName}
      </span>
    </span>
  );
}
