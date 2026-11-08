# Phase 1 QA report

Date: 2026-11-08 · Branch `claude/vibrant-dijkstra-gsnsfx` · Fictional data only.
Commands were run against the local Supabase stack (db reset from scratch). The run was interrupted once
(API limit, stack restarted by the orchestrator); suites were re-run afterwards where noted.

## 1. Commands and results

| Command | Result |
|---|---|
| `pnpm install --frozen-lockfile` | OK (pnpm warns about ignored build scripts: @parcel/watcher, @swc/core; harmless) |
| `pnpm db:reset` | OK, all migrations through `20261108150000_recovery_reset_state` + seed + app_server password |
| `pnpm typecheck` | pass |
| `pnpm lint` | pass (0 findings) |
| `pnpm format:check` | pass |
| `pnpm i18n:check` | OK, 278 keys in both locales |
| `pnpm test` | 19 files / 463 tests passed; after adding gap test: 20 files / 468 passed |
| `pnpm test:integration` (integration + node projects, live stack) | 18 files / 452 passed; after gap test: 19 / 457 passed |
| `pnpm db:test` (pgTAP) | 10 files, 217 tests, PASS |
| `pnpm build` | pass |
| `pnpm e2e` run 1 | 34 passed (28.1 s) |
| `pnpm e2e` run 2 | 34 passed (29.0 s) |

Flakiness: none observed in 2 consecutive e2e runs (retries off locally). Two runs is weak evidence; CI uses retries: 1.

## 2. Exit gate

| Gate item | Status | Evidence |
|---|---|---|
| Cross-tenant isolation tests green | MET | pgTAP 217 green (`supabase/tests`), `authz-parity`, `tenancy-context`, `data-api-closed` integration, e2e "cross-tenant host: org A owner denied on demo-b" |
| MFA enforced for staff | MET | integration "aal1 staff: MFA_REQUIRED in the app AND no rows in the database"; e2e "aal1 staff held at MFA", "staff without a factor can only reach MFA enrollment", invitee must enroll MFA |
| CI green from a clean clone | NOT MET (see D-1) | Fresh `git clone` into `/tmp/claude-0/.../scratchpad/qa-clone`: install, typecheck, lint, format:check, i18n:check, test (399 passed, 64 integration tests skipped without stack) all pass. `pnpm build` FAILS using the env that `.github/workflows/ci.yml` job `app` provides. With the 3 missing variables supplied, the build passes. |
| Security approval for 1.3, 1.4, 1.7, 1.8 | Not verified by QA (security agent's remit) | |

## 3. Defects

| ID | Severity | Description / repro | Owner |
|---|---|---|---|
| D-1 | High (blocks gate) | CI `app` job builds with only `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SESSION_ACTIVITY_SECRET`. `src/server/env.ts` also requires `SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL`, `APP_BASE_DOMAIN`, so `next build` fails at "Collecting page data" with `Invalid or missing environment variables: SUPABASE_SERVICE_ROLE_KEY, DATABASE_URL, APP_BASE_DOMAIN`. Repro: clone, `env -i PATH=$PATH HOME=$HOME NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321 NEXT_PUBLIC_SUPABASE_ANON_KEY=x SESSION_ACTIVITY_SECRET=$(openssl rand -hex 32) pnpm build`. Fix: add placeholder values for the three variables to the job env (no secrets needed). Local green build masks this because `.env.local` exists. | backend / architect (ci.yml) |
| D-2 | Medium | I18N-02 only partly implemented: `profiles.locale` and `organizations.default_locale` exist in the schema, but no application code reads or writes them. Locale comes from the URL prefix (default `es`) only. The user language preference does not persist across devices and the org default is not applied to the sign-in redirect. Roadmap 1.5 lists "locale preference". | frontend / backend |
| D-3 | Low | `scripts/check-i18n.mjs` checks key parity only (empty values, placeholder mismatch and unused/missing keys in source were unchecked). Mitigated by new test below. | qa (done) |
| D-4 | Info | `i18n/request.ts` still has `TODO(tenancy)`: time zone is the fixed default, not the org time zone (I18N-04 partially). | frontend |

No defects found in: 390 px layout, keyboard flow, Spanish register (below).

## 4. Exploratory checks (throwaway Playwright scripts, not committed)

- 390 px viewport, `/es` and `/en` for sign-in, forgot-password, reset-password, mfa, mfa/enroll: all HTTP 200, `scrollWidth == clientWidth == 390` (no horizontal scroll). Authenticated pages (branding settings, MFA with a session) were not exercised at 390 px by script; `shells.spec.ts` covers the mobile shell only.
- Keyboard only: tab order is skip link, es, en, email, password, submit, forgot-password link. Typing and Enter on a wrong password submits and shows one generic alert ("El correo o la contraseña no son correctos."). Focus lands on the alert container.
- Spanish copy: auth/recovery text uses "tú" (e.g. "Restablece tu contraseña", "¿Olvidaste tu contraseña?"). Automated: no "usted" forms in `auth.*`.

## 5. Tests added

`tests/unit/i18n-completeness.test.ts` (5 tests, passing): no empty values, ICU placeholder parity es/en, Spanish `auth.*` copy has no "usted" forms, auth key count parity, and every literal `t('...')` key in single-namespace source files exists in both catalogs. (First draft produced a false positive for a file mixing root and namespaced translators; the test now skips ambiguous files.)

Not added (already covered): invitation expiry (`auth-flows.test.ts` "expired tokens ... rejected"), rate limiting, idle timeout, recovery codes.

## 6. Requirements traceability (Phase 1 scope)

| ID | Pri | Status | Evidence |
|---|---|---|---|
| AUTH-01 sign-in | Must | Verified | e2e auth.spec (generic error), integration sign-in/MFA flow, unit schemas |
| AUTH-02 email verification | Must | Partial | Invitation acceptance binds to verified email (integration); no standalone self-signup verification flow in Phase 1 (signup is ORG-01, later) |
| AUTH-03 password reset | Must | Verified | e2e recovery, integration via Mailpit |
| AUTH-04 TOTP MFA for staff | Must | Verified | see gate; recovery codes ADR-021 integration |
| AUTH-05 idle/absolute timeouts | Must | Verified (15 min idle / 12 h absolute) | unit session policy, e2e idle timeout. Owner-configurable timeouts not implemented (fixed policy) |
| AUTH-06 invitation only | Must | Verified for staff; patient/guardian invitations out of scope (Phase 2) | staff invitation lifecycle integration, e2e invite |
| AUTH-07/08/09 | Should/Could/Won't | Out of Phase 1 | |
| ORG-01 signup creates org | Must | Not covered (not in Phase 1 workstreams) | |
| ORG-02 invite psychologist | Must | Verified | e2e + integration (non-owner denied) |
| ORG-03 org settings | Must | Partial | branding only; default language/timezone/contact not editable |
| ORG-05 deactivate member | Must | Not covered by Phase 1 tests | later |
| ORG-04/06/07 | Should/Could | Out of scope | |
| RBAC-01 roles | Must | Verified | permission-matrix.test.ts, authz-parity |
| RBAC-02 tenant isolation | Must | Verified | pgTAP, authz-parity, e2e cross-tenant |
| RBAC-03 care-team access | Must | Out of Phase 1 (patients in Phase 2) | |
| RBAC-04 platform_admin sees no clinical data | Must | Partial | e2e "no professional access by role alone", pgTAP 05_platform_admin; clinical data does not exist yet |
| RBAC-05/06/07 | Must/Should | RBAC-06 partial (owner capacities in matrix); 05 and 07 later | |
| I18N-01 es+en UI | Must | Verified for existing UI | i18n:check, new completeness test, e2e locale switch |
| I18N-02 user/org language | Must | User preference: verified (`locale-preference.test.ts`); org default: Phase 2 | |
| I18N-03 authored content per language | Must | Out of Phase 1 | |
| I18N-04 locale/timezone formatting | Must | Partial (D-4) | formatters module exists |
| AUD-01 read/write audit of sensitive data | Must | Partial | writer and auth/branding events (audit.test.ts, pgTAP 06); no clinical data yet |
| AUD-02 security events logged | Must | Verified for sign-in, MFA, rate-limit, reset | auth-flows, audit integration |
| AUD-03 append-only | Must | Verified | pgTAP 06_audit, audit.test.ts |
| AUD-04 patient access history view | Must | Out of Phase 1 | |
| AUD-07 no clinical content in logs | Must | Not verifiable yet (no clinical data) | |
| BRD-01 branding config | Must | Partial | display name, colors, logo verified (branding.test.ts, pgTAP 10, e2e branding); favicon and welcome text not covered |
| BRD-02 applied to login/portal | Must | Partial | login/portal shells verified; emails and PDFs later |
| BRD-03 contrast validation | Must | Verified | unit contrast.test.ts, branding-guard.test.ts |
| BRD-04 subdomain | Should | Verified (host resolution) | tenancy-context |
| SEC-02 isolation tests | Must | Verified | as RBAC-02 |
| SEC-03 server-side authz | Must | Verified | authz-parity, MFA_REQUIRED server and DB |
| SEC-05 brute force | Must | Verified | rate limiting integration |
| SEC-06 secrets outside code | Must | Partial | service-role allowlist unit test; secret scanning job not confirmed by QA |
| SEC-09 web protections | Must | Verified | unit and e2e security-headers (CSP, cookies), Zod schemas |
| SEC-01, 04, 07, 08, 12, 14 | Must | Out of Phase 1 / operational | |

## 7. Recommendations

1. Fix D-1 before declaring the exit gate (re-run the clean-clone build with the exact CI env).
2. Decide on D-2 (implement profile/org locale preference or move it to Phase 2 with an explicit note).
3. Re-run e2e a third time in CI (retries on) and add axe accessibility checks (ARCHITECTURE 14 lists them; none exist yet).
4. CI already has an `e2e` job (ci.yml line 83); not executed by QA. Confirm it passes once D-1-style env gaps are checked there too.
5. No escalation needed for the suites above; D-1 is a trivial config fix.

## Resolution (orchestrator, 2026-11-08)

- **D-1 fixed:** the CI `app` job now provides placeholder `SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL`,
  `APP_BASE_DOMAIN` and `TRUSTED_PROXY`. Verified: a fresh clone builds with exactly that environment
  (`env -i … pnpm build` succeeds). Exit gate item "CI green from a clean clone": **met locally**; the
  first real GitHub Actions run is still to be observed.
- **D-2 fixed:** the user's language is stored on `profiles.locale` when they use the switcher
  (signed in) and applied after the second factor. Integration test
  `tests/integration/locale-preference.test.ts` (2 tests). The organization default locale for
  users without a preference and per-org time zone (D-4) move to Phase 2 with patient onboarding.
- Final full run after all fixes: format/i18n OK (282 keys), pgTAP PASS, Vitest 481/481, build OK,
  Playwright 34/34.
