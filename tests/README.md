# tests

- `unit/` Vitest: schemas, policies, pure logic (`*.test.ts` run in node, `*.test.tsx` in jsdom).
- `integration/` Vitest against local Supabase (DAL, RLS, triggers).
- `e2e/` Playwright: critical flows per role (chromium).
- `authz/` permission matrix tests generated from the registry.
- `fixtures/` synthetic personas and seed builders. Fictional data only, never real patient data.
