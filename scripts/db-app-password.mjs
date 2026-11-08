#!/usr/bin/env node
// Sets the password of the `app_server` login role on the LOCAL Supabase database (ADR-019).
// The password never lives in migrations or seed: it is read from APP_DB_PASSWORD
// (environment or .env.local). Refuses to run against non-local hosts.
//
// Usage: pnpm db:app-password
import { existsSync } from 'node:fs';
import postgres from 'postgres';

if (existsSync('.env.local') && typeof process.loadEnvFile === 'function') {
  process.loadEnvFile('.env.local');
}

// Well-known local Supabase superuser URL (`supabase status`); never a hosted project.
const adminUrl =
  process.env.SUPABASE_DB_ADMIN_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const password = process.env.APP_DB_PASSWORD;

const host = new URL(adminUrl).hostname;
if (!['127.0.0.1', 'localhost', '::1'].includes(host)) {
  console.error(`Refusing to set the app_server password on non-local host "${host}".`);
  process.exit(1);
}
if (!password || !/^[A-Za-z0-9_-]{24,128}$/.test(password)) {
  console.error(
    'APP_DB_PASSWORD must be set (24-128 chars of [A-Za-z0-9_-]). Generate one with:\n' +
      "  node -e \"console.log(require('node:crypto').randomBytes(24).toString('base64url'))\"",
  );
  process.exit(1);
}

const sql = postgres(adminUrl, { max: 1, onnotice: () => {} });
try {
  // ALTER ROLE cannot take bind parameters; the value is restricted to a safe charset above.
  await sql.unsafe(`alter role app_server with password '${password}'`);
  console.log('app_server password set on the local database.');
} finally {
  await sql.end();
}
