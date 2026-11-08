# Architecture — Psi (SyV Solutions)

> Status: **Phase 0 — Proposed** (documentation only; nothing here is implemented).
> Owner: architect agent. Access-control content must be reviewed by the security agent.
> Related: [DATABASE.md](./DATABASE.md) · [API_CONTRACTS.md](./API_CONTRACTS.md) · [DECISIONS.md](./DECISIONS.md)

Psi is a multi-tenant, bilingual (es/en) psychological practice management SaaS built by
SyV Solutions. The first tenant is the clinical brand "Daniela Ortega — Psicóloga"
(Colombia). The product has two surfaces:

- **Professional dashboard** — organization owners and psychologists manage patients,
  clinical records, sessions, notes, consents, resources and therapeutic activities.
- **Patient portal** — patients (adult or child/adolescent mode) and guardians complete
  assigned activities, view shared resources, sign consents and manage preferences.

Out of MVP scope: video calls, payments, billing, native apps, AI diagnosis, automated
recommendations, advanced scheduling. Nothing in this architecture may preclude adding
them later, but nothing is built for them now.

Legal note: nothing in this document asserts regulatory compliance (Ley 1581/2012,
Resolución 1995/1999, Ley 1090/2006, Ley 1098/2006, etc.). Items that depend on law are
marked `[NEEDS LEGAL VERIFICATION]`.

---

## 1. System context

```mermaid
flowchart LR
  subgraph Users
    PRO[Psychologist / Org owner<br/>browser]
    PAT[Patient adult / child<br/>browser]
    GUA[Guardian<br/>browser]
    PADM[SyV platform_admin<br/>browser]
  end

  subgraph Vercel["Hosting (recommended: Vercel)"]
    NEXT[Next.js App Router<br/>RSC + Server Actions + Route Handlers<br/>middleware: locale + tenant]
  end

  subgraph Supabase["Supabase project (per environment)"]
    AUTH[Supabase Auth<br/>email+password, magic link, TOTP MFA]
    PG[(Postgres<br/>RLS on every tenant table)]
    ST[(Storage<br/>private buckets)]
  end

  MAIL[Transactional email<br/>provider TBD]
  OBS[Error tracking / logs<br/>PHI-scrubbed]

  PRO & PAT & GUA & PADM -->|HTTPS| NEXT
  NEXT -->|user JWT| PG
  NEXT -->|user JWT| ST
  NEXT --> AUTH
  NEXT -->|restricted service role,<br/>allowlisted ops only| PG
  AUTH --> MAIL
  NEXT --> MAIL
  NEXT --> OBS
```

Key properties:

1. **The browser never talks to Postgres directly for domain data.** All reads and writes
   go through server-only code (React Server Components, Server Actions, Route Handlers).
   The Supabase browser client is used only for Auth session handling (sign-in, MFA
   challenge, token refresh). See ADR-004.
2. **RLS is the second line of defense**, not the only one. Every server call runs with the
   user's JWT so RLS still applies even if an app-layer check is missing.
3. **The service-role key is restricted** to a small, allowlisted set of server operations
   (see §6.4) and never reaches client bundles.

---

## 2. Deployment topology (recommendation)

| Component | Recommendation | Notes |
|---|---|---|
| Web app | Vercel (Next.js native), one project, environments: Preview / Staging / Production | Alternative: any Node host with Next.js standalone output. |
| Database/Auth/Storage | Supabase hosted, **one project per environment** (local, staging, production) | Never share a project between staging and production. |
| Region | Choose Supabase region and Vercel function region **co-located** | Data residency / international transfer `[NEEDS LEGAL VERIFICATION]` (Ley 1581 transfer rules). Candidate: `sa-east-1` (São Paulo) or `us-east-1`. Client decision. |
| Email | Transactional provider (e.g. Resend / Postmark / SES) configured as Supabase Auth SMTP and for app notifications | Emails must contain **no clinical content**, only links. |
| DNS | App domain owned by SyV (e.g. `app.<syv-domain>`), optional per-org custom domains for portal white-label | Custom domains: open decision (ADR-017). |
| Secrets | Vercel encrypted env vars; Supabase keys per env | Service-role key only in server env, never `NEXT_PUBLIC_*`. |
| Backups | Supabase daily backups + PITR on production (paid add-on) | See §17. |

Functions run in the **Node.js runtime** (not Edge) for anything touching the database,
so we can use the full Supabase server client, crypto and structured logging. Middleware
(locale + tenant resolution) runs at the edge but performs **no data access beyond a
cached host→organization lookup** (see §8).

---

## 3. Folder structure

```
/
├─ docs/                         # ARCHITECTURE, DATABASE, API_CONTRACTS, DECISIONS, SECURITY…
├─ messages/
│  ├─ es.json                    # UI strings (Spanish, default)
│  └─ en.json                    # UI strings (English)
├─ public/                       # static, non-tenant assets only
├─ supabase/
│  ├─ config.toml
│  ├─ migrations/                # timestamped SQL, the ONLY way schema changes
│  ├─ seed.sql                   # synthetic data only — never real patient data
│  └─ tests/                     # pgTAP RLS/trigger tests
├─ src/
│  ├─ app/
│  │  └─ [locale]/
│  │     ├─ (auth)/              # sign-in, MFA, recovery, invitation acceptance
│  │     ├─ (professional)/      # dashboard: patients, records, activities, settings
│  │     ├─ (portal)/            # patient/guardian portal (adult + child modes)
│  │     └─ layout.tsx           # NextIntlClientProvider, theme variables
│  │  └─ api/                    # route handlers: signed URLs, exports, webhooks
│  ├─ i18n/                      # next-intl routing, request config, formatters
│  ├─ modules/
│  │  └─ <domain>/               # see §4 for the domain list
│  │     ├─ schemas/             # Zod schemas + inferred types (isomorphic, no I/O)
│  │     ├─ server/              # 'server-only': DAL queries, actions, policies
│  │     │  ├─ queries.ts
│  │     │  ├─ actions.ts        # 'use server' entry points
│  │     │  └─ policy.ts         # permission checks for this domain
│  │     ├─ components/          # domain UI (server + client components)
│  │     └─ index.ts             # public surface of the module (types + components)
│  ├─ components/
│  │  ├─ ui/                     # shadcn/ui generated primitives (owned by designer/frontend)
│  │  └─ shared/                 # cross-domain presentational components
│  ├─ server/
│  │  ├─ auth/                   # session retrieval, AAL/MFA checks, current profile
│  │  ├─ db/                     # Supabase server client factory, admin client (restricted)
│  │  ├─ authz/                  # AuthzContext, permission registry, requirePermission()
│  │  ├─ audit/                  # audit event writer + event catalog
│  │  ├─ tenancy/                # organization resolution
│  │  ├─ storage/                # bucket/path helpers, signed URL issuance
│  │  ├─ errors/                 # AppError, error codes, Result helpers
│  │  └─ logging/                # structured logger with PHI scrubbing
│  ├─ lib/                       # pure utilities (dates, ids, hashing) — no I/O
│  ├─ styles/                    # Tailwind entry, CSS variable tokens
│  └─ middleware.ts              # next-intl + tenant host resolution
├─ tests/
│  ├─ unit/                      # Vitest: schemas, policies, pure logic
│  ├─ integration/               # Vitest against local Supabase: DAL + RLS + triggers
│  ├─ e2e/                       # Playwright: critical flows per role
│  ├─ authz/                     # permission matrix tests (generated from registry)
│  └─ fixtures/                  # synthetic personas & seed builders
└─ (root configs: tsconfig, eslint, prettier, next.config, tailwind, vitest, playwright)
```

### 3.1 Domain modules

| Module | Responsibility |
|---|---|
| `organizations` | Org lifecycle, settings, domains, branding |
| `members` | Memberships, membership roles, invitations (staff) |
| `profiles` | User profile, locale preference, professional profile |
| `patients` | Patient demographics, portal access, preferences, care team |
| `guardians` | Guardian records, patient↔guardian relationships, guardian permissions |
| `clinical-records` | Record, structured sections and revisions, assessments, diagnoses |
| `treatment` | Treatment plans and goals |
| `sessions` | Therapy sessions (light scheduling: date/time, status, modality) |
| `notes` | Clinical notes, finalization, addenda |
| `documents` | Clinical documents and file objects |
| `consents` | Consent templates, versions, consent records, revocations |
| `resources` | Resource library and resource shares |
| `activities` | Categories, activities, versions, blocks, block registry |
| `assignments` | Activity assignments and responses (portal side + professional review) |
| `content-i18n` | Therapeutic content translations with review status |
| `privacy` | Data subject requests, exports, retention policy configuration |
| `audit` | Audit log query UI (write path lives in `src/server/audit`) |
| `platform` | Platform admin: org provisioning, break-glass grants (no clinical UI) |

---

## 4. Module boundaries & dependency rules

```mermaid
flowchart TB
  APP["src/app (routes, layouts)"] --> MOD_C["modules/*/components"]
  APP --> MOD_S["modules/*/server (actions, queries)"]
  MOD_C --> MOD_SCH["modules/*/schemas"]
  MOD_C --> UI["components/ui, components/shared"]
  MOD_S --> MOD_SCH
  MOD_S --> SRV["src/server/* (auth, db, authz, audit, storage, errors, logging)"]
  SRV --> LIB["src/lib"]
  MOD_SCH --> LIB
```

Rules (enforced with `eslint-plugin-boundaries` or `no-restricted-imports` — dependency to
be justified in Phase 1):

1. `src/app` may import a module only through its `index.ts` or its `server/actions.ts`.
2. `modules/*/server/**` and `src/server/**` start with `import 'server-only'`. Client
   components can never import them.
3. A module may import **another module's schemas and public types**; it may **not** import
   another module's `server/queries.ts`. Cross-domain reads go through the other module's
   exported server functions (e.g. `notes` asks `patients` "is this patient in the org and
   in my care team" via `patients/server/policy.ts`).
4. `src/server/db/admin.ts` (service role) may be imported only from an explicit allowlist
   of files (lint rule). See §6.4.
5. `schemas/` are pure (Zod + types). No I/O, no environment access — safe in client and
   server.
6. No module reaches into `supabase/` SQL directly; types are generated
   (`supabase gen types`) into `src/server/db/types.gen.ts`.
7. Circular dependencies between modules are forbidden (`import/no-cycle`).

---

## 5. Roles & actors (summary)

| Actor | How represented | Clinical access |
|---|---|---|
| `platform_admin` | Row in `platform_admins` (not a membership) | **None implicit.** Break-glass only (time-boxed, reasoned, audited, ADR-014). |
| `organization_owner` | `membership_roles.role = organization_owner` | Administrative only. Clinical access only if also `psychologist` **and** on the patient's care team (open decision Q-03). |
| `psychologist` | `membership_roles.role = psychologist` | Patients where the membership is an active `care_team_members` row. |
| `patient` | `patients.profile_id` linked to an auth user | Own assignments, own responses, shared resources, own consents. **Never** clinical notes, record sections, diagnoses. |
| `guardian` | `guardians` row (optionally linked to a profile) + `patient_guardians` relationship + `patient_guardian_permissions` | Only what each granted permission allows, for that specific patient, while the relationship is active. |

Detailed permission matrix: owned by security (`docs/SECURITY.md`, to be written). The
permission registry in `src/server/authz/permissions.ts` is the single source of truth in
code; tests are generated from it (§14).

---

## 6. Data access

### 6.1 Server-only Data Access Layer (DAL)

- Every query lives in `modules/<domain>/server/queries.ts` and receives an
  `AuthzContext` as its first argument. No query function exists without one.
- The DAL uses `createServerClient()` from `src/server/db/server.ts`, bound to the
  request's cookies → user JWT → RLS applies.
- DAL functions **always filter by `organization_id` explicitly**, even though RLS would
  also enforce it. This makes intent obvious and keeps query plans index-friendly.
- DAL returns DTOs (mapped, typed) — never raw rows with columns the caller should not
  see (e.g. a portal DTO for an assignment never includes psychologist-only fields).

### 6.2 RLS as second line

- RLS enabled + `FORCE ROW LEVEL SECURITY` on every table in `public`.
- Policies call `SECURITY DEFINER` helper functions in a dedicated `app` schema with fixed
  `search_path` (e.g. `app.is_org_member(org_id)`, `app.has_clinical_access(patient_id)`,
  `app.guardian_can(patient_id, permission)`). Helpers are `STABLE` and indexed paths.
- Default deny: no policy → no access. `anon` role has no policies on domain tables.

### 6.3 Atomic multi-step writes

Supabase JS does not offer client-side transactions. Mutations that must be atomic
(e.g. finalize note + audit, create activity version + blocks, publish version, accept
consent + evidence) are implemented as **Postgres functions** (`SECURITY INVOKER`, so RLS
still applies) called via `rpc()`. The function writes the domain rows and the audit row in
one transaction.

### 6.4 Restricted service role

`src/server/db/admin.ts` exposes narrow functions, not a raw client:

| Allowed use | Why it needs elevated rights |
|---|---|
| Invitation acceptance (link new auth user to membership / patient / guardian) | Caller has no membership yet |
| Auth admin operations (create user for invitation, revoke sessions) | Supabase Auth admin API |
| Platform org provisioning | Creates first org + owner membership |
| Scheduled jobs (expire invitations, expire break-glass grants, signed-export cleanup) | No user context |
| Writing audit rows for **failed/denied** access attempts | User may lack insert rights for that org |

Every service-role call logs an audit event with `actor_type = 'system'` or the
initiating user, and is covered by an integration test.

---

## 7. Request lifecycle with authorization

```mermaid
sequenceDiagram
  participant B as Browser
  participant MW as middleware.ts
  participant RSC as Server Action / RSC
  participant AZ as src/server/authz
  participant DAL as module DAL
  participant PG as Postgres (RLS)
  participant AU as audit

  B->>MW: request /es/patients/123
  MW->>MW: next-intl locale; resolve tenant hint (host→org)
  MW->>RSC: forward (headers: x-request-id, x-org-hint)
  RSC->>AZ: getAuthzContext()
  AZ->>AZ: verify session (getUser, not getSession), AAL level
  AZ->>PG: load memberships/roles/patient+guardian links (cached per request)
  AZ-->>RSC: AuthzContext {profileId, orgId, roles, actorKind, aal}
  RSC->>RSC: Zod-parse input
  RSC->>AZ: requirePermission(ctx, 'clinical.note.read', {patientId})
  AZ-->>RSC: ok | AppError(FORBIDDEN/NOT_FOUND)
  RSC->>DAL: getNote(ctx, id)
  DAL->>PG: select ... where organization_id = ctx.orgId (RLS re-checks)
  PG-->>DAL: rows
  DAL->>AU: record('clinical_note.viewed') (for clinical reads)
  DAL-->>RSC: DTO
  RSC-->>B: rendered UI / Result<T>
```

Rules:

1. **Authenticate** with `supabase.auth.getUser()` (server-verified), never trust
   `getSession()` alone.
2. **MFA**: professional and platform routes require `aal2` (TOTP). Portal MFA optional
   (open decision Q-07).
3. **Validate** all input with Zod before any I/O.
4. **Authorize** via `requirePermission()` with the resource scope (org, patient,
   assignment). Unauthorized access to an existing resource in another tenant returns
   `NOT_FOUND` (no enumeration).
5. **Execute** through the DAL (RLS applies).
6. **Audit** clinical reads and all mutations (§13).
7. **Respond** with a `Result<T>` (see API_CONTRACTS.md); never throw raw DB errors to the
   client.

---

## 8. Tenancy resolution

The organization is the tenant (ADR-002). Resolution order:

1. **Host mapping** — `organization_domains` maps a host (custom domain or
   `<slug>.<app-domain>`) to an organization. Used primarily by the portal for white-label.
   Middleware reads a short-lived cached map; it only sets an `x-org-hint` header.
2. **Active organization cookie** — for professional users with several memberships, an
   `active_org` cookie selects the org. It is a *hint*.
3. **Server validation** — `getAuthzContext()` always verifies that the user actually
   belongs to the hinted org (membership, patient link or guardian link). A hint never
   grants access. If invalid → fall back to the user's only org or show an org picker.

The URL path deliberately **does not** contain the org id (`/[locale]/...` only): it keeps
links shareable across white-label hosts and prevents treating the URL as an authority.

Portal users (patient/guardian) usually belong to exactly one org; a guardian could be
linked to patients in two orgs, so the same validation applies.

---

## 9. Internationalization

- **Library**: `next-intl` with locale-prefixed routing: `/es/...`, `/en/...`
  (`localePrefix: 'always'`). Default locale `es`. ADR-009.
- **Locale selection order**: explicit URL → user preference (`profiles.locale`) →
  organization default (`organizations.default_locale`) → `Accept-Language` → `es`.
  After sign-in, the user is redirected to their preferred locale.
- **UI strings**: `messages/es.json`, `messages/en.json`, namespaced per module
  (`patients.list.title`). CI fails if keys diverge between the two files.
- **Dates, numbers, times**: `next-intl` formatters with the **organization time zone**
  (`organizations.time_zone`, default `America/Bogota`) unless the user overrides. All
  timestamps stored as `timestamptz` (UTC).
- **Clinical content is never auto-translated.** Notes, record sections, diagnoses text,
  patient responses are stored and displayed in the language they were written in, with a
  `content_locale` column where useful.
- **Therapeutic content translations** (activity versions, resources, consent templates)
  are explicit, human-authored and tracked in `content_translations` with a review status
  (`draft → in_review → approved`, or `rejected`). Only `approved` translations are shown
  to patients; otherwise the source language is shown. Machine translation, if ever added,
  would enter as `draft` and require human approval (not in MVP).
- **Consent texts**: each consent template version is authored per locale; the accepted
  text hash covers the exact locale shown (see DATABASE.md §Consents).
- **Enum labels** (statuses, roles) are translated in `messages/*`, never stored as text.

---

## 10. White-label theming pipeline

ADR-010. Per organization branding is data, not code.

1. `organization_branding` stores: display name, logo/favicon file references, a small set
   of **semantic color tokens** (primary, primary-foreground, accent, radius scale…),
   optional font choice from an allowlist, portal welcome copy per locale.
2. On request, the root layout loads branding for the resolved org (cached, tag-revalidated
   on change) and emits a `<style>` block of CSS variables on `:root`
   (`--brand-primary: 222 47% 31%;` in shadcn HSL format). Tailwind config maps
   `colors.primary` etc. to these variables. shadcn components consume them unchanged.
3. Values are **validated server-side** (Zod: color formats, allowlisted fonts, max
   lengths) and **contrast-checked** (WCAG AA against foreground) before saving; invalid
   palettes are rejected rather than rendered. No arbitrary CSS input is accepted.
4. Child-mode portal uses an additional token set (larger radius, playful palette
   variants) derived from the brand tokens by the designer's rules — not free CSS.
5. Logos are served from the `branding` bucket (non-PHI). Whether that bucket is public
   is open decision Q-09; default proposal: public-read for logos only, because login
   pages render before authentication.
6. Emails use the org display name and logo URL; no clinical content.

---

## 11. Activity block rendering

ADR-008. Activities are composed of **predefined safe blocks**; no arbitrary HTML/JS.

- **Block schema**: a Zod discriminated union on `type`:
  `text`, `image`, `multiple_choice`, `open_response`, `scale`, `emotion_selector`,
  `audio`, `video`, `game`. Each block config has a `schemaVersion` integer.
- **Rich text** inside `text`/instructions uses a restricted AST (paragraph, heading
  levels 2–3, bold, italic, bullet/numbered list, link with allowlisted protocols
  `https:`/`mailto:`). Stored as JSON AST, rendered by our React components. No
  `dangerouslySetInnerHTML` anywhere in the renderer tree (lint rule).
- **Media blocks** reference `file_objects` ids (private storage, signed URLs) or, for
  video, an allowlisted embed provider id + video id (security to approve list) — never a
  raw iframe URL.
- **Games** reference a `game_type` from a fixed catalog implemented in code (e.g.
  `memory_match`, `drag_sort`, `emotion_matching`) with a typed config per game type.
- **Versioned block schema**: when a block schema changes, `schemaVersion` is bumped and a
  pure upgrader function (`upgradeBlock(v1) → v2`) is registered. Stored published blocks
  are **never rewritten**; they are upgraded in memory at render time.
- **Renderer registry**:
  `blockRenderers: Record<BlockType, { adult: Component; child: Component; review: Component }>`.
  `review` is the professional view of a patient's response. Unknown type or failed
  parse → safe fallback ("content unavailable") + logged error, never a crash.
- **Responses**: each answerable block has a matching response Zod schema
  (`responseSchemaFor(block)`); the server validates every `activity_response_item`
  against the pinned version's block before saving.
- No scoring engine produces diagnoses or conclusions; scales show raw values to the
  psychologist.

---

## 12. Storage

ADR-011.

| Bucket | Content | Access |
|---|---|---|
| `clinical-documents` | Clinical documents, signed consent scans, exports | Private; care team only |
| `activity-media` | Images/audio/video used in activity blocks | Private; org members + assigned patients/guardians |
| `resources` | Resource library files | Private; org members + patients with a share |
| `branding` | Logos, favicons | Public-read proposed (Q-09); write by org owner |
| `exports` | Generated record exports / DSR packages | Private; requester only; auto-expire |

**Path convention** (enforced by storage RLS on `storage.objects` using path segments):

```
<bucket>/org/<organization_id>/<domain>/<entity_id>/<file_object_id>.<ext>
e.g. clinical-documents/org/9f…/patients/41…/c2….pdf
```

- File names never contain patient names or PHI.
- Every stored object has a `file_objects` row (mime, size, sha256, uploaded_by). Upload
  flow: server issues **signed upload URL** → client uploads → server action confirms,
  verifies size/mime/hash, then links the file to its domain entity.
- **Signed URL TTLs** (configurable constants, not hardcoded in callers):
  clinical documents and exports **60 s**; activity media and resources **10 min** (long
  enough for an audio/video session); signed upload URLs **2 min**.
- Signed URLs are issued only by route handlers / server actions after authorization, and
  each issuance for clinical content is audited.
- Max sizes and mime allowlists per bucket (e.g. PDF/JPEG/PNG/WebP/MP3/M4A/MP4).
  Antivirus scanning: open decision Q-10.

---

## 13. Error handling, logging & observability

### Errors
- `AppError` with a code from a closed set (see API_CONTRACTS.md §3). Server actions
  return `Result<T>`; route handlers return JSON `{ error: { code, message, requestId } }`
  with matching HTTP status.
- Postgres errors are mapped: unique violation → `CONFLICT`; immutability trigger
  (`SQLSTATE` custom `P0001` with prefix `IMMUTABLE:`) → `IMMUTABLE_RECORD`; RLS empty
  result → `NOT_FOUND`.
- User-facing messages are i18n keys, never raw DB messages.
- Next.js `error.tsx` boundaries per route group show a generic message + `requestId`.

### Logging
- Structured JSON logs: `timestamp, level, requestId, route, actionName, orgId,
  actorProfileId, durationMs, errorCode`.
- **No PHI in logs**: no names, emails, document numbers, note text, responses, file
  names, free-text inputs. Logger has a scrubber (deny-list of keys + redaction of any
  Zod-parsed input) and inputs are never logged by default.
- Error tracking (e.g. Sentry) with `sendDefaultPii: false`, request bodies disabled,
  breadcrumbs scrubbed. Session replay disabled.
- Audit log (DB, append-only) is separate from operational logs and is the place for
  "who accessed what" (ADR-012).

### Observability
- Request id propagated from middleware into logs and audit rows.
- Basic metrics: action latency, error rate by code, RLS-denied counts, signed URL
  issuance rate (anomaly detection for data exfiltration).

---

## 14. Testing strategy

| Layer | Tool | What |
|---|---|---|
| Unit | Vitest | Zod schemas (blocks, responses, branding), policy functions, upgraders, formatters |
| Integration | Vitest + local Supabase (`supabase start`) | DAL functions, Postgres functions, immutability triggers, audit writes |
| RLS | pgTAP (`supabase test db`) **and** Vitest with real JWTs per persona | Each table: allowed and denied cases per role, cross-tenant isolation |
| Permission matrix | Vitest, generated from `permissions.ts` × personas | Every permission × role × relationship state (active/revoked/expired guardian, off-care-team psychologist, platform_admin without grant) |
| E2E | Playwright | Critical flows: sign-in + MFA, create patient, write+finalize note+addendum, publish activity + assign + patient completes (adult and child), guardian consent, locale switch, white-label host |
| Accessibility | Playwright + axe | Portal child/adult modes, core dashboard pages |
| i18n | Script in CI | `es.json`/`en.json` key parity, no missing keys |

Personas (synthetic): two orgs (A, B); per org an owner-only, an owner+psychologist, a
psychologist on care team, a psychologist off care team, an adult patient, a child
patient, two guardians with different permissions, one revoked guardian; one
platform_admin with and without break-glass. **No real patient data in any non-production
environment.**

---

## 15. CI outline

On every PR (GitHub Actions):

1. Install (frozen lockfile) → typecheck (`tsc --noEmit`, strict) → ESLint → Prettier check.
2. i18n key parity check.
3. Unit tests (Vitest).
4. Start local Supabase → apply all migrations from scratch → pgTAP RLS tests →
   integration tests → permission matrix.
5. Generated DB types are up to date (`supabase gen types` diff is empty).
6. Build Next.js; Playwright E2E against the build + local Supabase (smoke set on PR,
   full suite nightly).
7. Dependency audit (`npm audit --audit-level=high` or equivalent) and secret scanning.
8. Migration lint: no edits to already-merged migration files; destructive statements
   (`DROP`, `ALTER ... TYPE`) require a `-- reviewed-destructive:` marker.

On merge to `main`: deploy to staging, apply migrations to staging (`supabase db push`),
run smoke E2E. Production deploys are manual promotions with migration step first and an
approval gate.

---

## 16. Environments

| Env | App | Supabase | Data |
|---|---|---|---|
| Local | `next dev` | `supabase start` (Docker) | `seed.sql` synthetic |
| Preview | Vercel preview per PR | Shared **staging** project (or Supabase branching if adopted) | Synthetic only |
| Staging | Vercel staging | Staging project | Synthetic only |
| Production | Vercel production | Production project, PITR enabled | Real data |

- Production data is never copied down. Support debugging uses synthetic reproductions.
- Env vars validated at boot with Zod (`src/server/env.ts`); missing/invalid → fail fast.
- Auth redirect URLs and allowed hosts configured per environment.

---

## 17. Backup & recovery considerations

- Production: daily automated backups + **Point-in-Time Recovery** (Supabase add-on).
  Target RPO ≤ 5 min (PITR), RTO ≤ 4 h — to be confirmed with client.
- **Storage objects are not covered by database backups** in the same way; plan a
  scheduled replication of private buckets to a separate, encrypted location
  `[decision Q-11]`.
- Quarterly restore drill into an isolated project (with access restricted to SyV
  operators named in the runbook); audit the drill.
- Restores must respect deletions performed by data subject requests: after a restore,
  re-apply the DSR suppression log (`data_subject_requests` with completed suppression).
  `[NEEDS LEGAL VERIFICATION]`
- Retention periods are **not hardcoded** (ADR-013): `retention_policies` stores
  configured periods once legal confirms them; purge jobs read from there and are disabled
  until a policy exists.

---

## 18. Conventions

### Naming
- DB: `snake_case`, plural tables, `id uuid` PK (`gen_random_uuid()`), FK columns
  `<entity>_id`, timestamps `created_at`/`updated_at` (`timestamptz`), enums as Postgres
  enum types named `<domain>_<thing>` (e.g. `note_status`).
- TS: `camelCase` vars/functions, `PascalCase` types/components, files `kebab-case.ts`,
  React components `PascalCase.tsx`. Zod schemas `xxxSchema`, inferred types `Xxx`.
- Server actions: `verbNounAction` (e.g. `finalizeNoteAction`). Queries: `getX`, `listX`.
- Permissions: `domain.resource.verb` (e.g. `clinical.note.finalize`).
- Audit events: `resource.past_tense_verb` (e.g. `clinical_note.finalized`).
- i18n keys: `module.screen.element`.

### Code
- TypeScript `strict`, `noUncheckedIndexedAccess`, no `any` (lint error), no non-null
  assertions in server code.
- No `dangerouslySetInnerHTML` (lint error, no exceptions without ADR).
- Every new dependency requires a one-line justification in the PR description and
  architect approval.

### Git
- Branches: `main` (protected), `feat/<scope>-<short>`, `fix/…`, `chore/…`, `docs/…`.
  Agent branches as assigned by the orchestrator.
- Commits: Conventional Commits (`feat(notes): add addendum creation`), scope = module.
- PRs: small, one concern, linked to the requirement, security review checkbox required
  for any module touching patient, guardian or clinical data.
- Migrations: one logical change per migration file; never edit a merged migration.

---

## 19. Open architectural questions (summary)

Tracked in DECISIONS.md "Open questions". Highlights: hosting region / data residency
(Q-01), custom domains in MVP (Q-02), owner clinical visibility (Q-03), guardian access
for adolescents (Q-04), retention periods (Q-05), break-glass approval flow (Q-06), portal
MFA (Q-07), platform activity templates (Q-08), branding bucket public (Q-09), antivirus
(Q-10), storage backup replication (Q-11).
