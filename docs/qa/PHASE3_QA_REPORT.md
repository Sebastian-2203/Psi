# Phase 3 QA Report (2026-11-14, one pass)

## Commands run (from clean, real results)

| Command | Result |
|---|---|
| `pnpm db:reset` | OK (all migrations through `20261114220000_clinical_audit_scope`, seed applied) |
| `pnpm typecheck` | pass |
| `pnpm lint` | pass |
| `pnpm format:check` | pass |
| `pnpm i18n:check` | OK, 1180 keys in both locales |
| `pnpm test` | 28 files, 1451 tests passed (before the added file) |
| `pnpm db:test` | 14 files, 375 pgTAP tests, PASS |
| `pnpm build` | success |
| `pnpm e2e` (once; re-run only to list skips) | 46 passed, 2 skipped (skipped tests not inspected) |
| Added `tests/unit/clinical-file-validation.test.ts` | 8 passed; eslint, prettier and tsc clean |

## Traceability (Must only)

Evidence: pgTAP `14_clinical.sql` (DB), `tests/integration/clinical-server.test.ts` (INT), `tests/unit/phase3-components.test.tsx` (UI), `tests/e2e/phase3.spec.ts` (E2E).

| Req | Status | Evidence / gap |
|---|---|---|
| CLR-01 | Verified | DB records (unique per patient, no delete), INT idempotent open, care-team gating. Legal minimum content `[NEEDS LEGAL VERIFICATION]`. |
| CLR-02 | Partial | Sections store revisions, author and time (DB, INT). Intake-specific sections and "required per org" configuration are not tested. |
| CLR-03 | Partial | Section audience adult/minor is filtered in `queries.ts`, but no test asserts that adults do not see minor sections. |
| CLR-04 | Partial | DB covers assessment create, finalize and freeze. No test asserts "no computed interpretation". |
| CLR-05 | Verified | DB (notes, assessments, revisions and addenda immutable even for the table owner), INT, UI, E2E. |
| CLR-06 | Partial | DB: diagnosis label is immutable. Nothing asserts that no suggestions or autocomplete appear (absent by design). |
| CLR-07 | Partial, defect D1 | Delete refused (DB). Legal-hold flag and retention config are not implemented (no `legal_hold` anywhere in src or migrations). Archive and close are tested. |
| SES-01 | Verified | INT sessions are records only. Timeline UI is not E2E-tested. |
| SES-02 | Partial | The link from sessions to plan and objectives is not asserted. The "plan lists linked sessions" view is not covered. |
| SES-03 | Partial | The note-state timeline is not asserted for ordering (newest first). |
| SES-04 | Partial | UI test for the pending-notes list. The audit of status changes is not asserted. |
| NOTE-01 | Partial | Note types, inactive-type refusal and body storage covered (DB, INT). Choice of SOAP, DAP or custom formats is not E2E-tested. |
| NOTE-02 | Verified | Author-only drafts, hash-validated finalize, read-only afterwards (DB, INT, UI, E2E). |
| NOTE-03 | Verified | DB and INT idempotent addendum with reason and author. The "no patient notification" part is not asserted. |
| NOTE-04 | Verified | Patients and guardians read no notes (DB, INT, E2E portal). No sharing control exists. |
| NOTE-05 | Not covered | No reference-to-patient-response feature exists. It depends on Phase 4 responses. Treat as deferred, not a defect. |
| TPL-01 | Verified | DB, INT, UI. |
| TPL-02 | Verified | DB: version 2 with goals carried over. Prior versions remain readable. |
| TPL-03 | Verified | DB, INT, UI, E2E: the portal shows only patient-facing wording and status. |
| DOC-01 | Partial, defect D2 | Private bucket, upload and validation covered. Type, magic-byte and size rules are now unit tested (new file). Malware scan is not implemented, and the source says so. |
| DOC-02 | Verified | DB, INT, E2E: share, list, unshare removes access at once, guardian-visible flag. |
| DOC-03 | Partial | Signed URL with TTL and audit events `file.download_url_issued` and `document.portal_url_issued` (INT). Behavior after expiry is not tested (Supabase-controlled). |

## Defects

- D1 (Medium): CLR-07 legal-hold flag and configurable retention are not implemented. This is a Must gap, or the requirement needs an explicit deferral decision.
- D2 (Medium): DOC-01 "scanned" is not met, because there is no malware scanner. It is documented in code and needs an ADR or an accepted deferral.
- No Critical or High defects found. No cross-tenant, platform_admin, patient or guardian leakage found in the tested paths.

## Coverage summary

Must requirements: 6 verified outright, 2 verified with minor gaps, 9 partial, 1 not covered (NOTE-05, deferred).
Added tests: 1 file, 8 tests. Source was not modified.

## Unverified

Attribute-level accessibility (WCAG) beyond the E2E 390px fit check. Behavior of the 2 skipped E2E tests. Stress and concurrency of finalize.

## Escalation

None needed. D1 and D2 need product and architect decisions.
