import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { cache } from 'react';
import { withUserTransaction } from '@/server/db/server';
import { getVerifiedClaims, type VerifiedClaims } from './claims';
import { createRequestAuthClient } from './supabase';

/**
 * Whether the caller holds any capacity that requires aal2 (staff membership that is not
 * removed/suspended in a readable org, or platform admin). Read through the caller's own
 * RLS-bound `app.my_capacities()` (aal-independent by design).
 */
export async function requiresMfa(claims: VerifiedClaims): Promise<boolean> {
  const [row] = await withUserTransaction(claims, async (tx) => {
    return tx<{ required: boolean }[]>`
      select exists (
        select 1 from app.my_capacities() c
        where c.acting_as = 'platform_admin'
           or (c.acting_as = 'staff' and c.membership_status = 'active'
               and c.org_status in ('active', 'read_only'))
      ) as required
    `;
  });
  return row?.required ?? true;
}

export type TotpFactorState = { verifiedFactorId: string | null; unverifiedFactorIds: string[] };

/** Fresh factor list from Supabase Auth (getUser round-trip; never the cookie copy). */
export async function getTotpFactors(client: SupabaseClient): Promise<TotpFactorState> {
  const { data, error } = await client.auth.mfa.listFactors();
  if (error || !data) return { verifiedFactorId: null, unverifiedFactorIds: [] };
  const totp = data.all.filter((f) => f.factor_type === 'totp');
  return {
    verifiedFactorId: totp.find((f) => f.status === 'verified')?.id ?? null,
    unverifiedFactorIds: totp.filter((f) => f.status !== 'verified').map((f) => f.id),
  };
}

export type AuthPageState =
  | { signedIn: false }
  | {
      signedIn: true;
      claims: VerifiedClaims;
      factors: TotpFactorState;
      mfaRequired: boolean;
    };

/** Session state for the (auth) pages (MFA enrollment/challenge, reset). Per request. */
export const getAuthPageState = cache(async (): Promise<AuthPageState> => {
  const claims = await getVerifiedClaims();
  if (!claims) return { signedIn: false };
  const client = await createRequestAuthClient();
  const [factors, mfaRequired] = await Promise.all([getTotpFactors(client), requiresMfa(claims)]);
  return { signedIn: true, claims, factors, mfaRequired };
});
