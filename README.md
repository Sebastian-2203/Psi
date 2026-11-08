# Psi

Multi-tenant, bilingual (es/en) psychological practice management SaaS by SyV Solutions.
First tenant: Daniela Ortega, Psicóloga (Colombia). Vision and scope: [PROJECT.md](PROJECT.md).

## Prerequisites

- Node.js 22 (see `.nvmrc`)
- pnpm 10
- Docker + Supabase CLI (from the backend workstream onward)

## Setup

```bash
pnpm install
cp .env.example .env.local   # fill in values; never commit secrets
pnpm dev                     # http://localhost:3000
```

## Scripts

| Script                         | Purpose                                   |
| ------------------------------ | ----------------------------------------- |
| `pnpm dev` / `build` / `start` | Next.js development, production build/run |
| `pnpm lint`                    | ESLint (includes architecture boundaries) |
| `pnpm typecheck`               | `tsc --noEmit` (strict)                   |
| `pnpm format` / `format:check` | Prettier                                  |
| `pnpm test` / `test:watch`     | Vitest                                    |
| `pnpm e2e`                     | Playwright (chromium)                     |
| `pnpm i18n:check`              | es/en message key parity                  |
| `pnpm db:*` / `gen:types`      | Local Supabase (see "Local database")     |

## Local database

Local Supabase via Docker (Supabase CLI is a devDependency: `pnpm exec supabase …`).
ADR-019 Option A: the **Data API (REST/GraphQL) is disabled**; the Next.js server connects to
Postgres as the `app_server` login role and runs each request as `authenticated` with verified
JWT claims (`src/server/db`). Auth and Storage stay on the API gateway.

```bash
pnpm db:start        # start Auth, Storage, gateway, Mailpit and Postgres (studio, realtime, … excluded)
cp .env.example .env.local   # values from `pnpm exec supabase status -o env`; set APP_DB_PASSWORD
pnpm db:reset        # migrations from scratch + FICTIONAL seed + sets the app_server password
pnpm db:test         # pgTAP RLS/trigger suite (supabase/tests)
pnpm test            # unit + authz matrix + integration (integration skips if the stack is down)
pnpm gen:types       # regenerate src/server/db/types.gen.ts (CI fails on drift)
pnpm db:stop
```

- URLs: API/Auth `http://127.0.0.1:54321`, Postgres `postgresql://…@127.0.0.1:54322/postgres`.
- `SESSION_ACTIVITY_SECRET` (>= 32 random chars, per environment) signs the idle-timeout cookie;
  the app refuses to start without it. Generate: `node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"`.
- `TRUSTED_PROXY` / `TRUSTED_PROXY_HOPS` pick the client-IP source (default `vercel` on Vercel,
  else rightmost X-Forwarded-For hop in development/test). **Required** for `next start` in
  production off Vercel: the server refuses to start without it (P1-21). **Verify per
  deployment** (SECURITY.md §14 P1-03).
- `DATABASE_URL` must use `app_server` (the pool refuses `postgres`/`service_role`). Its password
  is never in migrations; `pnpm db:app-password` sets it from `APP_DB_PASSWORD` (local hosts only).
- Seeded personas (all fictional, `@example.test`, password `Psi-Local-Fictional-2026`, TOTP
  secret `JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP`): see `supabase/seed.sql` and
  `tests/fixtures/personas.ts`. Tenant hosts: `demo-a.localhost`, `demo-b.localhost`.
- Staff and platform access requires `aal2` (TOTP) in the database itself.
- Emails (password recovery from Supabase Auth, invitations sent by the app) land in the local
  Mailpit at `http://127.0.0.1:54324` (`MAIL_DEV_HTTP_URL`, local only).
- E2E (`pnpm e2e`) signs in fictional personas with password + TOTP (RFC 6238 computed in
  `tests/fixtures/totp.ts`) and uses the tenant hosts directly: Chromium resolves `*.localhost`
  to loopback, no host-resolver rules needed. Local runs truncate `rate_limit_counters` first.

## Documentation

- [CLAUDE.md](CLAUDE.md) project rules and agent coordination
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), [docs/DECISIONS.md](docs/DECISIONS.md)
- [docs/DATABASE.md](docs/DATABASE.md), [docs/SECURITY.md](docs/SECURITY.md)
- [docs/DEVELOPMENT_ROADMAP.md](docs/DEVELOPMENT_ROADMAP.md)
