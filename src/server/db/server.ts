import 'server-only';
import type postgres from 'postgres';
import { assertVerifiedClaims, type VerifiedClaims } from '@/server/auth/claims';
import { getSql } from './pool';

declare const userTransactionBrand: unique symbol;

/** A transaction running as `authenticated` with the request's verified claims. */
export type UserTransaction = postgres.TransactionSql & { readonly [userTransactionBrand]: true };

/** Per-transaction statement timeout for user requests. */
const USER_STATEMENT_TIMEOUT = '10s';

/**
 * Runs `fn` in ONE transaction as the verified user (ADR-019 Option A):
 *
 *   begin;
 *   set_config('request.jwt.claims', <verified payload>, true)   -- auth.jwt(), aal, ...
 *   set_config('request.jwt.claim.sub', <sub>, true)            -- auth.uid() reads this first
 *   set_config('request.jwt.claim', '', true)                    -- auth.jwt() reads this first
 *   set local role authenticated;                                -- RLS + grants of authenticated
 *   ... fn(tx) ...
 *   commit;   -- every setting above reverts; the pooled connection is clean again
 *
 * The supabase `auth.uid()` in this Postgres image is
 * `coalesce(request.jwt.claim.sub, request.jwt.claims->>'sub')`, so both are set to the same
 * verified value and the legacy singular key is blanked, leaving no stale value to win.
 * After setup the transaction asserts `current_user = 'authenticated'` and
 * `auth.uid() = sub` before running `fn`.
 *
 * `claims` must come from src/server/auth/claims.ts (checked at runtime, not only by type).
 */
export async function withUserTransaction<T>(
  claims: VerifiedClaims,
  fn: (tx: UserTransaction) => Promise<T>,
): Promise<T> {
  assertVerifiedClaims(claims);
  const payload = JSON.stringify(claims.payload);
  const sql = getSql();

  const result = await sql.begin(async (tx) => {
    await tx`
      select
        set_config('request.jwt.claims', ${payload}, true),
        set_config('request.jwt.claim.sub', ${claims.sub}, true),
        set_config('request.jwt.claim', '', true),
        set_config('statement_timeout', ${USER_STATEMENT_TIMEOUT}, true)
    `;
    await tx`set local role authenticated`;
    const [check] = await tx<{ ok: boolean }[]>`
      select (current_user = 'authenticated' and auth.uid() = ${claims.sub}::uuid) as ok
    `;
    if (!check?.ok) {
      throw new Error('Failed to bind verified claims to the transaction.');
    }
    return fn(tx as UserTransaction);
  });
  return result as T;
}
