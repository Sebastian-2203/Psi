# Project Status

**Current phase:** 2 — Patient management (authorized 2026-11-09).
**Branch:** `claude/vibrant-dijkstra-gsnsfx`.

## Done
- Phase 0 — foundation docs, agents, brand (provisional, client-confirmed decisions in `docs/DECISIONS.md`).
- Phase 1 — scaffold, Supabase schema + RLS (Option A), auth + staff MFA, i18n, design system, branding,
  security hardening. Gate passed for internal alpha with synthetic data (`docs/SECURITY.md` §14.8,
  `docs/qa/PHASE1_QA_REPORT.md`).

## Phase 2 progress
- [x] DB layer: migrations `20261109100000/110000/120000`, pgTAP 266/266.
- [ ] Server modules (patients/guardians/consents actions, portal invitations + guard, seed, integration
      tests) — PAUSED mid-way by client request; partial code committed as WIP, untested.
- [ ] Frontend: patient list/profile, guardians, consent signing, portal entry.
- [ ] Security review + QA pass.

## Blockers / pending client decisions
- Q-03, Q-04, Q-17 running on provisional defaults (see `docs/DECISIONS.md` client log).
- Pre-pilot (non-code): legal review, DPA, hosting region, mail provider, infra access policy,
  restore drill, independent audit.

## Local dev notes
- Docker daemon may stop on session restarts: run `dockerd` in the background, then `pnpm db:start && pnpm db:reset`.
