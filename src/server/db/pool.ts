import 'server-only';
import postgres from 'postgres';
import { env } from '@/server/env';

/**
 * Process-wide postgres.js pool for the `app_server` login role (ADR-019 Option A).
 *
 * - Hosted: DATABASE_URL points at the Supabase pooler in TRANSACTION mode
 *   (user `app_server.<project-ref>`, port 6543). Local: direct to 54322 as `app_server`.
 * - `prepare: false` because transaction-mode pooling cannot keep prepared statements.
 * - Only transaction-local settings (`set local`, `set_config(..., true)`) are ever used, so
 *   nothing leaks across pooled connections (asserted by tests/integration).
 * - Never use `sql.unsafe` with user input, and never `set`/`reset role` outside
 *   src/server/db: claim-setting is the security boundary of Option A.
 */

/** Login roles that must never back the app pool (they own objects or bypass RLS). */
const FORBIDDEN_DB_USERS = new Set(['postgres', 'supabase_admin', 'service_role', 'authenticator']);

const POOL_MAX = 5; // Small per-instance pool: serverless instances multiply connections.

let sql: postgres.Sql | undefined;

function assertAppRole(url: string): void {
  let user: string;
  try {
    user = decodeURIComponent(new URL(url).username);
  } catch {
    throw new Error('DATABASE_URL is not a valid URL.');
  }
  const base = user.split('.')[0] ?? '';
  if (FORBIDDEN_DB_USERS.has(base) || base !== 'app_server') {
    throw new Error('DATABASE_URL must use the app_server login role (ADR-019).');
  }
}

export function getSql(): postgres.Sql {
  if (!sql) {
    assertAppRole(env.DATABASE_URL);
    sql = postgres(env.DATABASE_URL, {
      max: POOL_MAX,
      prepare: false,
      idle_timeout: 20,
      connect_timeout: 10,
      connection: { application_name: 'psi-app-server' },
      onnotice: () => {},
    });
  }
  return sql;
}

/** Closes the pool (tests, graceful shutdown). */
export async function closeSql(): Promise<void> {
  const current = sql;
  sql = undefined;
  await current?.end({ timeout: 5 });
}
