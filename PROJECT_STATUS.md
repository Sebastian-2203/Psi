# Project Status

**Current phase:** 3 — Clinical module (authorized 2026-11-14). Phase 2 complete.

## Phase 3 progress

- [x] Backend: clinical schema, RLS, immutability, server modules; pgTAP 375, Vitest 1440.
- [ ] Frontend: clinical record, sessions, notes + addenda, plans, documents
- [ ] Security review + QA
      **Branch:** `claude/vibrant-dijkstra-gsnsfx`.

## Done

- Phase 0 — foundation docs, agents, brand (provisional, client-confirmed decisions in `docs/DECISIONS.md`).
- Phase 1 — scaffold, Supabase schema + RLS (Option A), auth + staff MFA, i18n, design system, branding,
  security hardening. Gate passed for internal alpha with synthetic data (`docs/SECURITY.md` §14.8,
  `docs/qa/PHASE1_QA_REPORT.md`).

## Phase 2 progress

- [x] DB layer: migrations `20261109100000/110000/120000`, QA closure `20261114110000` (data_subject_requests) and `20261114120000` (majority notice); pgTAP 294/294 (13 files).
- [x] Server modules: patients, guardians, consents, portal invitations + guard, data requests, seed; Vitest 1071/1071 (26 files).
- [x] Frontend: patient list (server search)/profile, majority notice, guardians, consent signing, portal entry, data requests. e2e 40 passed, 1 skipped (screenshot); i18n 790 keys.
- [x] QA pass and defect closure D-1..D-5 (`docs/qa/PHASE2_QA_REPORT.md`).
- [ ] Security review of S2-07 (data requests, `majority_in_days`).

## Blockers / pending client decisions

- Q-03, Q-04, Q-17 running on provisional defaults (see `docs/DECISIONS.md` client log).
- Pre-pilot (non-code): legal review, DPA, hosting region, mail provider, infra access policy,
  restore drill, independent audit.

## Local dev notes

- Docker daemon may stop on session restarts: run `dockerd` in the background, then `pnpm db:start && pnpm db:reset`.
