# CLAUDE.md — Global Project Instructions

Project: **Psi** — psychological practice management SaaS
Technology company: **SyV Solutions** · First clinical tenant: **Daniela Ortega — Psicóloga** (Colombia)

This file is loaded by every Claude Code session and subagent. Read it before doing anything.

## Current phase

**Phase 3 — Clinical module** (authorized 2026-11-14): clinical records with structured sections and revisions,
assessments, professional-entered diagnoses, treatment plans and goals, therapy sessions (record only), clinical notes
(draft → finalized, immutable, addenda), clinical documents (private storage, signed URLs). Record section keys and
note types are configurable per organization; seeded examples are fictional and tagged `[NEEDS PSYCHOLOGIST INPUT]`
until Daniela provides hers. Phases 0–2 accepted. ADR-019 Option A applies. Do not start Phase 4 without authorization.
Follow the resource budget rules in `docs/AGENT_WORKFLOW.md`.

## Source of truth

| Topic | Document | Owner agent |
|---|---|---|
| Vision, scope, stack | `PROJECT.md` | orchestrator |
| Architecture | `docs/ARCHITECTURE.md` | architect |
| Database | `docs/DATABASE.md` | architect (design) / backend (implementation) |
| API contracts | `docs/API_CONTRACTS.md` | architect |
| ADRs | `docs/DECISIONS.md` | architect |
| Security & permissions | `docs/SECURITY.md` | security |
| Requirements | `docs/PRODUCT_REQUIREMENTS.md` | product |
| User journeys | `docs/USER_JOURNEYS.md` | product |
| SaaS strategy | `docs/SAAS_STRATEGY.md` | product |
| Roadmap | `docs/DEVELOPMENT_ROADMAP.md` | product + architect |
| Brand | `docs/BRAND_GUIDELINES.md` | designer |
| Design system | `docs/DESIGN_SYSTEM.md` | designer |
| Agent workflow | `docs/AGENT_WORKFLOW.md` | orchestrator |

If code and docs disagree, stop and raise it. Update docs in the same change that alters behavior.

## Stack

Next.js (App Router) · React · TypeScript (strict) · Tailwind CSS · shadcn/ui · Lucide ·
Supabase (Postgres, Auth, Storage) · Zod · React Hook Form · next-intl · ESLint · Prettier ·
Vitest · Playwright. New dependencies require architect approval and an ADR when non-trivial.

## Non-negotiable rules

1. **Tenant isolation:** every tenant-owned row has `organization_id`. Enforce with RLS *and* server-side authorization. Never rely on frontend checks.
2. **platform_admin has no implicit access to clinical data.** Support access is break-glass, consented and audited.
3. **Patients and guardians never see private clinical notes** or internal professional documentation.
4. **Patient responses never automatically become clinical notes.**
5. **Guardians get only the permissions explicitly granted**; minors' private reflections are not automatically visible.
6. **Finalized clinical notes are immutable.** Corrections are addenda with author, timestamp and reason.
7. **Published activity versions are immutable;** assignments pin `activity_version_id`.
8. **No arbitrary HTML/JS** from psychologists. Activities use predefined, schema-validated blocks.
9. **No automated diagnoses, clinical conclusions or recommendations.**
10. **Validate all input with Zod** on the server. Strict TypeScript; no `any` without justification.
11. **No secrets in client code.** Service-role key only in audited server paths.
12. **Fictional data only** in development, tests and seeds. Never real patient data.
13. **No user-facing hard-coded strings** — use next-intl (es + en). Clinical/therapeutic content is never auto-translated.
14. **Do not hardcode legal retention periods** or legal interpretations. Mark `[NEEDS LEGAL VERIFICATION]`.
15. **Do not invent clinical protocols.** Mark `[NEEDS PSYCHOLOGIST INPUT]`.
16. **Do not invent brand facts.** Brand claims are labeled OBSERVED / REPORTED / PROVISIONAL.
17. **Never claim completion without running tests**, and never claim tests passed that were not run.
18. Out of MVP unless explicitly authorized: video conferencing, payments, billing, native apps, AI diagnosis, automated clinical recommendations, advanced scheduling.

## Agent coordination

The main session is the **orchestrator**. Specialized agents live in `.claude/agents/`:
`architect`, `frontend`, `backend`, `security`, `clinical`, `activities`, `qa`, `designer`, `product`.

- One owner per module/file; no two agents edit the same file concurrently.
- Architect approves architectural changes. Security reviews every module touching patient, guardian or clinical data. Designer owns visual direction; frontend implements it. Product owns requirements. QA verifies integration.
- Every agent reports: files modified, decisions, tests run (with real output), pending work.
- Details and invocation examples: `docs/AGENT_WORKFLOW.md`.

## Conventions (summary — full version in `docs/ARCHITECTURE.md`)

- Code, identifiers, commits and docs in **English**. UI copy in es (default) + en.
- DB: `snake_case`, plural table names, UUID PKs, `created_at`/`updated_at` `timestamptz`.
- TS: `camelCase` vars, `PascalCase` components/types, `kebab-case` file names.
- Commits: Conventional Commits (`feat:`, `fix:`, `docs:`, `chore:`, `test:`, `refactor:`).
- Migrations: `supabase/migrations/<timestamp>_<description>.sql`, forward-only, reviewed.
