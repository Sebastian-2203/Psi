# Project Status

**Current phase:** 2 — Patient management (authorized 2026-11-09).
**Branch:** `claude/vibrant-dijkstra-gsnsfx`.

## Done
- Phase 0 — foundation docs, agents, brand (provisional, client-confirmed decisions in `docs/DECISIONS.md`).
- Phase 1 — scaffold, Supabase schema + RLS (Option A), auth + staff MFA, i18n, design system, branding,
  security hardening. Gate passed for internal alpha with synthetic data (`docs/SECURITY.md` §14.8,
  `docs/qa/PHASE1_QA_REPORT.md`).

## Phase 2 progress
- [ ] Backend: patients, care team, guardians + permissions, consents + evidence, patient/guardian portal
      invitations, seed, tests — in progress (migrations `20261109100000`, `20261109110000` drafted).
- [ ] Frontend: patient list/profile, guardians, consent signing, portal entry.
- [ ] Security review + QA pass.

## Blockers / pending client decisions
- Q-03, Q-04, Q-17 running on provisional defaults (see `docs/DECISIONS.md` client log).
- Pre-pilot (non-code): legal review, DPA, hosting region, mail provider, infra access policy,
  restore drill, independent audit.

## Local dev notes
- Docker daemon may stop on session restarts: run `dockerd` in the background, then `pnpm db:start && pnpm db:reset`.
