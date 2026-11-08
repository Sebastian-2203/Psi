# src/modules

Domain modules (ARCHITECTURE §3.1). Each `<domain>/` contains `schemas/` (pure Zod + types),
`server/` (`'server-only'`: queries, actions, policy), `components/` and an `index.ts` public surface.
Modules are added by the workstream that owns the domain. Boundary rules: ARCHITECTURE §4
(enforced in `eslint.config.mjs`).
