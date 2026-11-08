# src/server

Server-only infrastructure: `auth`, `db`, `authz`, `audit`, `tenancy`, `storage`, `errors`, `logging`
(ARCHITECTURE §3). Every file here must start with `import 'server-only'`. `env.ts` holds the
Zod-validated server environment. `db/admin` (service role) may be imported only from the allowlist in
`eslint.config.mjs`.
