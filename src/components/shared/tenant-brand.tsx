'use client';

import { createContext, useContext, type ReactNode } from 'react';
import { DEFAULT_BRAND } from '@/styles/default-brand';

/**
 * Presentation data of the host's organization (ADR-010): practice name and logo URL. Provided by
 * the root layout from server-resolved branding; non-PHI. Components outside a provider (tests,
 * previews) fall back to the default Daniela brand.
 */
export type TenantBrandValue = { displayName: string; logoUrl: string | null };

const DEFAULT_VALUE: TenantBrandValue = { displayName: DEFAULT_BRAND.displayName, logoUrl: null };

const TenantBrandContext = createContext<TenantBrandValue>(DEFAULT_VALUE);

export function TenantBrandProvider({
  value,
  children,
}: {
  value: TenantBrandValue;
  children: ReactNode;
}) {
  return <TenantBrandContext.Provider value={value}>{children}</TenantBrandContext.Provider>;
}

export function useTenantBrand(): TenantBrandValue {
  return useContext(TenantBrandContext);
}
