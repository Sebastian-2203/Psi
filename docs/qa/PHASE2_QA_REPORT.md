# Phase 2 QA Report (patients, guardians, consents)

Date: 2026-11-14. One pass from a clean `pnpm db:reset`. Fictional data only.

## Commands and results

| Command | Result |
|---|---|
| `pnpm db:reset` | OK (all migrations + seed applied) |
| `pnpm typecheck` | pass |
| `pnpm lint` | pass |
| `pnpm format:check` | pass |
| `pnpm i18n:check` | pass (734 keys in es + en) |
| `pnpm test` (Vitest) | 25 files, 962/962 passed |
| `pnpm db:test` (pgTAP) | 12 files, 280 tests, PASS (274 existing + 6 added in `12_minor_assent.sql`) |
| `pnpm build` | pass |
| `pnpm e2e` (full, once) | 38 passed, 1 skipped (screenshot, needs PHASE2_SCREENSHOT=1), **1 failed** |
| `pnpm e2e tests/e2e/phase2.spec.ts` (diagnostic rerun) | 6 passed, 1 skipped |

The e2e failure was `phase2.spec.ts:52` (minor + guardian). `getByLabel('Nombres')` matched 2 elements
(streaming keeps a hidden copy of the page until the swap), a strict-mode violation. It passed on rerun,
so it is a flaky test, not a product defect. The heading wait in `createPatient` is not enough on a cold run.

## Traceability (Must requirements)

| Req | Status | Evidence / gap |
|---|---|---|
| PAT-01 adult create | verified | phase2-server (create, duplicates), pgTAP 11, e2e |
| PAT-02 minor create / guardian enforced | verified | pgTAP 11 sec. 2 (activation gating), phase2-server activation, e2e minor flow |
| PAT-03 profile / preferences / portal mode | verified | phase2-server (update with optimistic concurrency, preferences), pgTAP my_portal_mode, schemas unit |
| PAT-04 list, search, filter | partial | list and status filter covered (e2e, server). No text search exists in `patients/server/queries.ts` (see D-1) |
| PAT-05 status lifecycle | partial | intake to active/paused, no return to intake, gated activation covered. Discharged/archived transitions not tested |
| PAT-06 alert near 18 | partial | fail-closed suspension job covered (pgTAP 11). The alert/task 60 days before is a TODO in the migration (D-2) |
| PAT-07 duplicate warning | verified | phase2-server (confirmation required) |
| PAT-09 access/rectification request | not covered | no implementation found (D-3) |
| GRD-01 guardian as separate person | verified | pgTAP 11, phase2-server |
| GRD-02 relationship fields | partial | type, legal-rep and primary flags covered. Start/end dates not asserted |
| GRD-03 legal-rep information | verified | legal-basis gate (pgTAP, server, schemas) |
| GRD-04 granular permissions, minimal default | verified | pgTAP per-permission, server diff, e2e seeded guardian |
| GRD-05 different per guardian / revoke at once | verified | pgTAP revocation, server revocation cuts access |
| GRD-06 invitation after verification | verified | server (acceptance does not activate), e2e |
| GRD-07 adolescent sees what guardian can see | partial | privacy view DTO tested at server level. No e2e/UI assertion found |
| CON-01 versioned templates es/en | partial | draft/publish/immutability covered. The es+en pair and the five template types are not asserted |
| CON-02 who/what/when/version/method | verified | server record + evidence, pgTAP |
| CON-03 minor assent, separate | verified (added) | new pgTAP `12_minor_assent.sql`: the guardian cannot sign it, adults cannot, the minor signs her own record |
| CON-04 withdrawal | verified | pgTAP and server (one-time, append-only) |
| CON-05 consents gate activation | verified | pgTAP and server |
| CON-06 portal e-acceptance with evidence | verified | hash-binding, typed name, checkbox, e2e portal signing |

Should items (PAT-08, GRD-08, CON-07, CON-08): GRD-08 caveats and PAT-08 invitations are covered. CON-07 (scanned upload) has no test and CON-08 (renewal reminders) is not implemented.

## Defects

| ID | Severity | Description |
|---|---|---|
| D-1 | Medium | PAT-04 (Must): no text search over patients. Only a status filter exists. |
| D-2 | Medium | PAT-06 (Must): there is no alert or task as a minor approaches 18. Only the suspension at majority exists (TODO in migration `20261109100000`). |
| D-3 | Medium | PAT-09 (Must): there is no access/rectification request flow. It may be deferred by scope, so confirm with product. |
| D-4 | Low | Flaky e2e `phase2.spec.ts:52`: ambiguous `getByLabel` during streaming. Scope the locator to the visible form. |
| D-5 | Low | `PROJECT_STATUS.md` says pgTAP 266 and Vitest 930. Actual counts are 274 (now 280) and 962. |

No critical or high defects found. No source files were modified.

## Tests added

`/home/user/Psi/supabase/tests/12_minor_assent.sql` (6 pgTAP assertions, passing).

## Escalation

None needed. D-1 to D-3 need product/architect decisions (implement or formally defer).
