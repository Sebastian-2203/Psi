# src/server

Server-only infrastructure: `auth`, `db`, `authz`, `audit`, `tenancy`, `storage`, `errors`, `logging`
(ARCHITECTURE §3). Every file here must start with `import 'server-only'`. `env.ts` holds the
Zod-validated server environment. `db/system` (app_server system functions) and `db/service-role`
(Supabase Auth admin API, service-role key) may each be imported only from the per-file allowlists in
`eslint.config.mjs`.
