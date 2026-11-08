# PROJECT.md — Psi: Psychological Practice Management Platform

## 1. Context

| | |
|---|---|
| Technology company | **SyV Solutions**, which builds the product and will commercialize it as SaaS |
| First clinical brand / tenant | **Daniela Ortega — Psicóloga** ([Instagram @psicologadanielaortega](https://www.instagram.com/psicologadanielaortega/)) |
| Initial market | Colombia (Spanish first, English supported) |
| Product type | Responsive web application with two experiences (not a marketing site) |
| Status | Phase 0: foundation documentation, awaiting client approval |

The platform starts with one psychologist. Its data model, security and theming support many independent
psychologists and organizations from day one. Each tenant has its own branding (white-label).

## 2. Vision

Give psychologists a calm, trustworthy and well-designed workspace that brings together clinical management,
structured documentation and therapeutic activities. Give patients (adults, adolescents and children, with
their guardians) a warm, age-appropriate space to do the work their psychologist assigns between sessions.

The product should feel like a natural extension of the psychologist's own professional brand. It should
not look like generic hospital or administrative software.

## 3. Experiences

### A. Professional dashboard
Patients and profiles · clinical records and psychological history · assessments · diagnoses (entered by
the professional) · treatment plans and goals · sessions · progress notes (draft → finalized → addenda) ·
consents · clinical documents · resource library · no-code activity builder · assignments · patient
responses · progress tracking · professional settings · organization branding.

### B. Patient portal
Assigned activities · interactive exercises · educational resources (text, video, audio) · reflections and
journals · assigned objectives · documents shared by the psychologist · account, language and preferences.
The portal has **adult** and **child/adolescent** presentation modes. The psychologist decides which
activities are appropriate. Nothing is prescribed automatically by age.

**Patients never access private clinical notes. Patient responses never automatically become clinical notes.**

## 4. Users and roles

| Actor | Role / mechanism |
|---|---|
| Platform administrator (SyV) | `platform_admin`: runs the platform, with **no implicit clinical access** |
| Practice owner | `organization_owner` |
| Psychologist | `psychologist` |
| Adult / adolescent / child patient | `patient` |
| Guardian / legal representative | Relationship-scoped actor with granular, explicitly granted permissions |

## 5. MVP scope

1. Authentication (MFA for professionals/admins) · 2. Organizations and memberships · 3. Role-based access ·
4. Multi-tenant isolation · 5. Patient registration · 6. Adult and minor workflows · 7. Guardian management ·
8. Clinical records · 9. Sessions · 10. Progress notes · 11. Consent management · 12. Resource library ·
13. No-code activity builder · 14. Activity assignment · 15. Patient responses · 16. Patient portal ·
17. Spanish and English · 18. Audit logging · 19. Security controls · 20. Configurable organization branding.

**Not in MVP** (requires explicit authorization): video conferencing, online payments, billing, native
mobile apps, AI-based diagnosis, automated clinical recommendations, advanced scheduling.

## 6. Technology stack

| Layer | Choice |
|---|---|
| Frontend | Next.js (App Router), React, TypeScript strict, Tailwind CSS, shadcn/ui, Lucide |
| Backend | Next.js server actions and route handlers; Supabase (PostgreSQL, Auth, Storage) |
| Validation and forms | Zod, React Hook Form |
| i18n | next-intl (es default, en) |
| Quality | ESLint, Prettier, Vitest, Playwright, RLS tests against local Supabase |
| Delivery | Git, GitHub, CI (see `docs/ARCHITECTURE.md`) |

Rationale and alternatives: `docs/DECISIONS.md`.

## 7. Regulatory context (Colombia)

These need to be checked by qualified legal professionals. This project does not interpret them:
Ley 1581 de 2012 (personal data protection) · Resolución 1995 de 1999 (clinical records) ·
Resolución 839 de 2017 (clinical record retention) · Ley 1090 de 2006 (psychology profession) ·
Ley 1098 de 2006 (childhood and adolescence code) · any regulations on digital health services.

What the product supports technically: consent management with evidence, data subject rights workflows,
clinical record traceability, secure handling, export, configurable retention/deletion policies, and
processing-responsibility documentation. The **data controller (psychologist/organization) and data
processor (SyV Solutions)** relationship depends on the actual contracts. See `docs/SAAS_STRATEGY.md`.
Supabase and other vendors do not guarantee legal compliance on their own.

## 8. Documentation map

See the table in `CLAUDE.md`. All of it lives in `/docs`.
