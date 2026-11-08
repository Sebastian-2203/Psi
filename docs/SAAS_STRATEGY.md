# SaaS Strategy

**Owner:** Product agent · **Status:** Draft v0.1 — hypotheses, not decisions · Companion to `PRODUCT_REQUIREMENTS.md` and `USER_JOURNEYS.md`.

Legend: `[NEEDS LEGAL VERIFICATION]` = legal item flagged, not interpreted. `[NEEDS PSYCHOLOGIST INPUT]` = clinical-protocol item. `→ architect` = technical decision routed. No pricing is implemented in the MVP; plan tiers below are hypotheses for validation.

---

## 1. Strategic position

**What we are:** a trust-first practice platform for independent psychologists and small practices in Latin America, starting in Colombia, in Spanish with English supported. Two surfaces: a professional dashboard and a branded patient portal with psychologist-authored activities.

**What we are not (MVP):** a telehealth suite, a billing system, an AI clinical assistant, or a scheduling system. Staying out of those categories is a deliberate focus and a trust signal ("we do not analyze your patients").

**Wedge:** the between-session experience (no-code activity builder + portal) combined with a clinically careful records system. Many tools do notes; fewer let a psychologist author tailored, bilingual exercises for adults, adolescents and children without developers.

**Trust thesis:** psychologists buy where they are convinced that (a) patient data is isolated and encrypted, (b) the vendor cannot casually read it, (c) the vendor will not use it, (d) the tool respects clinical judgment. Every product choice (private notes, no automated conclusions, break-glass support) is also a market message.

**Design-partner approach:** Daniela Ortega is the first tenant and design partner. Success with her is the proof for the next 10–30 independent psychologists.

## 2. Tenancy model

| Aspect | Decision (hypothesis) |
|---|---|
| Tenant | Organization. All business data carries an org identifier; isolation enforced at the data layer (SEC-02, RBAC-02). |
| Solo practice | An org of one member who is both `organization_owner` and `psychologist`. No special-case code path; solo is just the smallest org. |
| Group practice | Org with multiple memberships. Owner administers; psychologists see only their care-team patients (RBAC-03/06). |
| Users across orgs | A person (login) may hold memberships in several orgs; data never crosses (ORG-06). Patients belong to one org's patient record each; a person being a patient in two orgs yields two unrelated patient records. |
| Guardians | Relationship-based actors tied to patient records inside one org; not org members. |
| Platform admin | SyV staff; no implicit clinical access; operational metadata only (RBAC-04). |
| Isolation guarantee | Tested continuously (cross-tenant test suite is a release gate). Tenant ids never accepted from the client. `→ architect` |
| Tenant lifecycle | trial → active → suspended (read-only, e.g., non-payment later) → offboarding (export, retention) → closed (data retained per legal duty or returned, not silently deleted) `[NEEDS LEGAL VERIFICATION]`. |
| Scale expectation | Many small tenants (1–10 psychologists, 20–500 patients each). Noisy-neighbour risk is low; per-tenant feature flags and limits needed. `→ architect` |

Why org-as-tenant (rather than psychologist-as-tenant): it makes solo and group practices the same model, supports white-label at org level, supports ownership change and offboarding, and is the natural contracting entity for a DPA.

## 3. Onboarding strategy

**Goals:** time-to-first-patient under 1 day for a solo psychologist; time-to-first-assigned-activity under 3 days (hypotheses).

### 3.1 Funnel stages
1. **Discover / request access** (invite-only during pilot; later self-serve signup).
2. **Account and security** — verify email, MFA (AUTH-04). Message: "Security first".
3. **Practice setup** — org name, language, timezone, branding, consent templates, safety text (journey J1).
4. **First patient** — adult or minor wizard (J2/J3), with consent gating explained as protection, not bureaucracy.
5. **First activity** — start from a starter template or blank (ACT-10).
6. **First assignment and review** — close the loop (J4).
7. **Second psychologist** (J9) — expansion trigger for group practices.

### 3.2 Pilot plan (Daniela as design partner)
- Phase A (alpha): Daniela only, with test patients and dummy data; no real patient data until consent texts are legally reviewed and the security Musts (SEC-01…SEC-09, SEC-12, SEC-14) pass.
- Phase B (beta): Daniela with real patients, with a written controller/processor arrangement in place.
- Phase C: 3–5 trusted peer psychologists, onboarded personally.
- Phase D: guided self-serve.

### 3.3 Onboarding assets
Spanish-first guided checklist; 10-minute walkthrough videos; templates for consents (marked as drafts needing legal review); patient-facing "How your information is protected" page; psychologist-facing "What SyV can and cannot see" page; migration help (manual import in pilot; CSV later, PAT-10).

### 3.4 Activation definition (hypothesis)
A tenant is *activated* when it has: MFA enrolled, consents published, ≥1 patient with all required consents, and ≥1 session record. *Engaged* when, in a rolling 28 days, it finalizes notes for ≥ 70% of held sessions (record usage) and/or has ≥1 activity submission (portal usage).

## 4. White-label scope

| Layer | MVP | Later | Never / not planned |
|---|---|---|---|
| Display name, logo, favicon | Yes (BRD-01) | | |
| Primary/secondary/accent colors with contrast guardrails | Yes (BRD-01/03) | Full theme tokens | Disabling accessibility guardrails |
| Login and portal branding, welcome text | Yes | Per-mode (child/adolescent/adult) themes (BRD-05 Should) | |
| Branded emails and PDFs (name, logo, colors, footer) | Yes (BRD-02, BRD-05) | Own sending domain with DKIM | |
| Branded subdomain `slug.<platform-domain>` | Should (BRD-04) | | |
| Custom domain with TLS | Could (BRD-06) | Yes, on higher plans (hypothesis) | |
| Remove "powered by SyV" | Open question | Possibly on higher tiers | |
| Custom consent/legal text | Yes (CON-01) | | Pre-approved legal advice (client's responsibility) |
| Custom UI copy overrides | No | Limited glossary overrides (e.g., "patient" vs "consultante") | Arbitrary code/CSS injection |
| Separate deployments per tenant | No | Enterprise possibility | |
| Native apps under tenant brand | Out of MVP | Roadmap hypothesis | |

Principles: branding never weakens security (no tenant-supplied scripts), accessibility (contrast enforced) or clarity of the privacy statements. Terminology matters in Colombia (paciente / consultante / usuario): glossary override is a candidate post-MVP feature `[NEEDS PSYCHOLOGIST INPUT]`.

## 5. Plan tier hypotheses (no pricing implementation in MVP)

Billing, payment collection and plan enforcement are **out of scope**; the MVP only needs per-tenant feature flags and limits that a later billing system can drive. All numbers below are hypotheses to test with discovery interviews.

| Tier (working names) | Target | Hypothesized inclusions | Hypothesized limits / differentiators | Value metric candidate |
|---|---|---|---|---|
| Pilot / Founding | Daniela and first 3–5 peers | Everything in MVP | Hands-on support; feedback commitment; locked-in founder terms | N/A |
| Solo | Independent psychologist | 1 psychologist, patient portal, builder, library, branding (basic) | Active patient cap; storage cap; subdomain | Active patients |
| Practice | 2–10 psychologists | Multiple members, shared library, org audit view, branding (full), custom email footer | Seats; storage; support SLA | Seats + active patients |
| Organization | Clinics, universities, NGOs | Custom domain, SSO (future), advanced audit/export, DPA customization, data-region options | Dedicated support, security reviews | Seats + contract |

Notes:
- Do not gate safety/privacy features (MFA, audit log, consent management) behind higher tiers; gate scale, branding depth and support.
- "Active patient" must be defined (e.g., with activity in last 90 days) to avoid penalizing discharged-patient retention duties.
- Retention obligations mean closed-account data handling must be priced and designed (offboarding).
- Open: free tier? Probably a time-limited trial with dummy data only (no real patient data until contract and DPA are in place).

## 6. Data controller vs. data processor considerations `[NEEDS LEGAL VERIFICATION]`

*Product hypothesis, not legal advice. Colombian terms: Responsable del Tratamiento / Encargado del Tratamiento under Ley 1581/2012.*

| Question | Working hypothesis | Why it matters |
|---|---|---|
| Who is the controller of patient data? | The psychologist/organization (they decide purposes: treatment, record keeping) | Drives consent texts, rights handling, notification duties |
| Who is the processor? | SyV Solutions, processing on documented instructions of the org | DPA content; liability; support access limits |
| Does SyV ever act as controller? | For account/billing data of its customers (psychologists), site analytics, and security logs | Needs a separate privacy notice for SyV's own purposes |
| Health data as sensitive data | Treated as sensitive; heightened consent/safeguards | Product defaults to least collection and explicit consent |
| Clinical record custody | Duties of the professional under Res. 1995/1999 and Res. 839/2017 (retention, custody, access); platform must support, not replace, those duties | Retention features, no hard delete, export on leaving |
| Minors' data | Heightened protection (Ley 1581/2012 and Ley 1098/2006 context); guardian consent plus child's voice | Guardian/assent workflows |
| Professional secrecy / ethics | Ley 1090/2006 (deontological code) shapes expectations; product mirrors via privacy-by-design | Marketing claims and support access |
| Registration of databases | Whether tenants (or SyV) must register with the regulator's registry (e.g., RNBD) | Possible onboarding step `[NEEDS LEGAL VERIFICATION]` |
| Cross-border transfer | Hosting outside Colombia may constitute transfer/transmission | Region choice, contractual basis (SEC-08) |
| Subprocessors | Hosting/database provider (Supabase and underlying cloud), email provider, error tracking, storage/CDN | Subprocessor list, notification of changes |
| Privacy policy / data-handling policy | Each controller needs its own; SyV supplies editable drafts | Template content in CON-01 |
| Breach notification | Processor must notify controller promptly; controller duties toward authority/patients | SEC-12 runbook |
| Right to delete vs. retention | Clinical retention duties may override deletion requests | PAT-09 and CLR-07 behavior |
| Electronic consent validity | Evidence quality for e-acceptance | CON-06 (Ley 527/1999 context) |

Design implications already reflected in the PRD: org-level consent templates (versioned), data-rights workflow, immutable records with addenda, audit access history, no content in logs, no analytics on clinical content, break-glass support.

## 7. Data Processing Agreement (DPA) needs

Minimum topics for the SyV–tenant DPA (to be drafted by counsel):
1. Roles, subject matter, duration, nature, purpose, categories of data (health, minors) and data subjects.
2. Processing only on the controller's documented instructions; prohibition of own-purpose use (no analytics, no training, no marketing on patient data).
3. Confidentiality commitments of SyV personnel; need-to-know access.
4. Security measures annex (encryption, MFA, isolation, audit, backups) matching SEC requirements.
5. Support access terms: break-glass only (section 8), logged, consented, time-boxed.
6. Subprocessor list, notification and objection mechanism; flow-down obligations.
7. International transfers and hosting region disclosures.
8. Assistance with data-subject rights (access, rectification) and with controller's regulatory duties.
9. Breach notification timeline and cooperation.
10. Retention, return and deletion on termination, respecting clinical retention duties; export format and timing.
11. Audit/inspection rights (documentation-based first; on-site optional for large tenants).
12. Liability, insurance and indemnity; governing law and jurisdiction.
13. Order of precedence with Terms of Service.

Other legal artifacts to prepare: Terms of Service, SyV privacy notice (for its own data), subprocessor register, security whitepaper, incident-response summary, template privacy notice and consent texts for tenants (draft, reviewed by counsel and by Daniela), acceptable-use policy (no illegal content, no use for non-clinical harvesting). All `[NEEDS LEGAL VERIFICATION]`.

Process: DPA acceptance is recorded at tenant creation (versioned), and the product blocks real-patient data entry until accepted (feature flag `real_data_enabled`). `→ architect`

## 8. Support access model

**Principle:** Support is a privilege requested, not a default. SyV staff cannot view clinical content in normal operation (RBAC-04).

### 8.1 Tiers of access
| Tier | What | Access path | Controls |
|---|---|---|---|
| T0 Self-service | Docs, chat/email, status page | Public | No data access |
| T1 Operational metadata | Tenant status, plan flags, member counts, error ids, job status, timestamps | Admin console (platform_admin) | No names of patients, no content; every view logged |
| T2 Tenant configuration | Branding, settings, membership list (staff names/emails) with owner's request | Admin console | Ticket reference required; owner is notified of the access |
| T3 Break-glass clinical access | Specific records needed to fix a defect or restore data | Separate elevated procedure | See below |

### 8.2 Break-glass procedure (SEC-14)
1. **Trigger:** a support case that cannot be resolved with T1/T2 and requires clinical data (e.g., corrupted note, failed migration).
2. **Request:** SyV engineer submits reason, scope (tenant, patient or object ids), duration, and ticket reference.
3. **Consent:** the tenant's `organization_owner` approves; if the scope touches a specific psychologist's patients, the treating psychologist also approves `[NEEDS PSYCHOLOGIST INPUT]`. Approval is recorded in the tenant's audit trail. Patient notification requirements `[NEEDS LEGAL VERIFICATION]`.
4. **Four-eyes:** a second SyV staff member approves the elevation (internal control).
5. **Access:** time-boxed (hypothesis 4 h, auto-expiry), least scope, read-only by default; writes need explicit extra approval; no bulk export; sessions recorded.
6. **Audit:** every action logged; report sent to the owner after closure; the tenant can see the full record in its audit view (AUD-04).
7. **Revocation:** owner can revoke at any time; access terminates immediately.
8. **Emergency exception** (platform-wide security incident): documented, executive-approved, retroactive notification to affected tenants `[NEEDS LEGAL VERIFICATION]`.

### 8.3 Impersonation
No silent "log in as user". If screen-sharing assistance is needed, the user shares their own screen (SyV is not a participant in the clinical session). Any future impersonation feature requires the break-glass flow and a visible banner.

### 8.4 Staff controls
Background checks and confidentiality agreements; separate admin identities with MFA/hardware keys; quarterly access review; training on health-data handling; no clinical data in tickets, chat or screenshots (support tooling redacts uploads and asks for object ids instead).

## 9. Metrics

Principle: product analytics are collected from **non-content operational events** only; no patient names, notes, responses or free text enter analytics. Tenant-level aggregate metrics are computed server-side from counts. Any per-patient analytics for a psychologist's own use (e.g., trends) belong in the product, not in SyV's analytics.

### 9.1 North Star (hypothesis)
**Finalized sessions documented per active psychologist per week** (the habit that makes the system the source of truth), complemented by **activities completed by patients per active psychologist** (the portal's value).

### 9.2 Metric tree
| Area | Metric | Definition (hypothesis) | Target (to calibrate) |
|---|---|---|---|
| Acquisition | Qualified demos / pilots started | Discovery calls converting to pilot | n/a |
| Activation | Time to first patient | Signup → first patient with consents | < 1 day |
| Activation | Time to first assigned activity | Signup → first assignment | < 3 days |
| Activation | Setup completion | % tenants completing checklist J1 | > 80% |
| Engagement | Weekly active psychologists | ≥1 note finalized or activity assigned | > 70% of paid |
| Engagement | Note finalization lag | Median hours session → finalized note | Falling trend |
| Engagement | Activities authored per psychologist | Published versions per month | ≥ 2 |
| Engagement | Assignment-to-submission rate | Submitted / assigned within 14 days (aggregate, informational only; never shown to patients as compliance) | Baseline first |
| Portal | Patient portal activation | % invited patients logging in within 7 days | > 60% |
| Portal | Portal task success | % started activities submitted | > 70% |
| Retention | Tenant logo retention | Tenants active at month 3 / 6 / 12 | > 90% at 12 months for solo (hypothesis) |
| Expansion | Second-psychologist adoption | % Practice-tier tenants adding a member | Track |
| Quality | p95 portal LCP, error rate, uptime | NFR-PERF/OBS | 99.5% |
| Quality | Accessibility defects open | WCAG AA findings | 0 critical |
| Trust/Security | Cross-tenant test pass | CI | 100% |
| Trust/Security | MFA coverage (professionals) | % | 100% |
| Trust/Security | Break-glass events | Count and duration | Trending to near 0; each reviewed |
| Trust/Security | Data-rights requests closed on time | % within the org's configured deadline | 100% |
| Support | First response time, resolution time, CSAT | Standard | Per SLA |
| Commercial | MRR, ARPA, CAC payback, churn | Post-billing phase | n/a for MVP |

### 9.3 Qualitative signals
Monthly interviews with Daniela and pilots; psychologist NPS; patient feedback prompts (optional, anonymous, non-clinical, e.g., "Was this easy to use?" without content); usability tests of child mode with guardians (with proper consent and ethical safeguards `[NEEDS PSYCHOLOGIST INPUT]`).

## 10. Colombia go-to-market hypotheses

*All are hypotheses to validate by interviews; none are market-size claims.*

**H1 — Target segment:** independent clinical and counseling psychologists (private practice, 1–3 clinicians), especially those working with children/adolescents and using homework/psychoeducation materials, in Bogotá, Medellín, Cali, Barranquilla and online practitioners serving the diaspora.
**H2 — Core pain:** records and materials scattered across WhatsApp, Drive, Word and paper; anxiety about confidentiality and regulatory compliance; no easy way to produce interactive exercises in Spanish.
**H3 — Differentiation:** Spanish-first, Colombian regulatory sensitivity (flags, not legal advice), child/adolescent-aware UX with guardian controls, no-code activity builder, privacy-by-design with explicit non-use of data and break-glass support.
**H4 — Channels:** (a) design-partner referrals via Daniela; (b) professional communities and associations (e.g., colegio profesional, university alumni groups) `[NEEDS PSYCHOLOGIST INPUT]` for credible entry points; (c) WhatsApp and Instagram-led content from clinicians, not ads; (d) workshops on "digital between-session work" and data protection basics; (e) university training clinics and supervised practicum programs (later; also institutional compliance needs).
**H5 — Trust accelerators:** transparent security page, Spanish DPA and privacy templates, local reference customers, optional independent security review/pen-test summary, clear exit/export promise.
**H6 — Pricing sensitivity:** local-currency pricing (COP) will matter; monthly plans are preferred over annual in early stages; price per active patient may feel punitive for small practices (test alternatives). Billing is out of the MVP; pilot is free or discounted in exchange for feedback `[decision for SyV]`.
**H7 — Sales motion:** founder-led, high-touch pilot with a personal onboarding session, followed by self-serve with templates; no outbound at scale until activation metrics are healthy.
**H8 — Expansion:** group practices and clinics (J9 pull), then schools' counseling units and NGOs (needs institutional DPA and different consent models, higher legal complexity), then other LATAM countries (country-by-country legal module; Spanish-first helps).
**H9 — Regulatory posture:** position the product as a tool that supports the professional's duties; avoid claims such as "compliant with Ley X" or "certified" until counsel validates `[NEEDS LEGAL VERIFICATION]`.
**H10 — Language:** Colombian Spanish register in UI and patient content; English for expatriates and bilingual families; ensure default wording uses locally natural terms (paciente/consultante).
**Validation plan:** 15–20 discovery interviews with psychologists (mixed child/adult practice); 5 usability sessions of the builder with non-technical psychologists; willingness-to-pay probes; legal advisor review of claims before any public landing page.

## 11. Risks and mitigations

| # | Risk | Likelihood | Impact | Mitigation | Owner |
|---|---|---|---|---|---|
| R1 | Breach or tenant isolation failure exposing health data | Low–Med | Critical | Data-layer isolation, cross-tenant tests as release gate, MFA, audit, pen-test, incident runbook (SEC-02/12) | Architect/Security |
| R2 | Regulatory misinterpretation (Ley 1581/2012, Res. 1995/1999, Res. 839/2017, Ley 1090/2006, Ley 1098/2006) | Med | High | Flag-don't-interpret; engage Colombian counsel before real data; review of consent texts | SyV leadership |
| R3 | Controller/processor ambiguity; no DPA | Med | High | Draft DPA early; block real data until accepted (feature flag) | SyV/Legal |
| R4 | Hosting region / cross-border transfer issues | Med | High | Decide region early, disclose subprocessors, legal review (SEC-08) | Architect/Legal |
| R5 | Clinical harm from misuse (e.g., portal treated as crisis channel) | Med | Critical | Persistent safety info, "not monitored" messaging, no chat in MVP, onboarding disclaimers `[NEEDS PSYCHOLOGIST INPUT]` | Product/Clinical |
| R6 | Guardian conflict or privacy breach for minors | Med | High | Granular permissions, instant revocation, adolescent privacy view, caveat flags | Product |
| R7 | Feature creep into excluded areas (video, billing, AI) | High | Med | MVP scope guardianship; explicit out-of-scope list; change control | Product |
| R8 | Must list is too large for a small team; delayed value | High | Med | Thin-slice alpha (roadmap), parallelize with architect; defer Shoulds | Product/Architect |
| R9 | Builder complexity (games, accessibility) delays MVP | Med | Med | Limit game types (2–3), strict block schema, template-first | Architect/Product |
| R10 | Low adoption by psychologists (note-taking slower than Word) | Med | High | Optimize note UX, autosave, templates, import help, co-design with Daniela | Product |
| R11 | Single design-partner bias | High | Med | Interview 15+ psychologists before locking Should/Could; keep configuration over hardcoding | Product |
| R12 | Accessibility failures (WCAG 2.2 AA) in builder-authored content | Med | Med | Authoring validation, alt text required, audits | QA/Design |
| R13 | Support access misuse or insider threat | Low | Critical | Break-glass, four-eyes, audit visible to tenants, staff vetting | SyV Ops |
| R14 | Data-loss or outage | Low–Med | High | Backups, restore drills, status page (SEC-07) | Architect |
| R15 | Retention vs. erasure conflicts | Med | Med | No hard deletes; legal-reviewed policy; clear patient messaging | Legal/Product |
| R16 | Children's sign-in mechanism weakens security | Med | Med | Security review of AUTH-07; guardian-mediated default | Architect |
| R17 | Vendor lock-in/ platform dependency (Supabase) | Low–Med | Med | Portable schema, export features, abstraction at boundaries | Architect |
| R18 | Claims overreach in marketing | Med | Med | Legal review of claims; avoid "certified/compliant" wording | SyV leadership |
| R19 | Founder capacity / concentration on one client | Med | Med | Clear pilot scope; backlog governance | SyV leadership |
| R20 | Brand misuse in white-label (impersonation, offensive content) | Low | Med | Terms of service, moderation hooks, contrast/script guardrails | Product |

## 12. Decisions needed and routing

| Decision | Needed by | Route to |
|---|---|---|
| Legal roles, DPA, consent texts, retention, regional hosting | Before beta with real patients | SyV leadership + Colombian counsel |
| Owner access policy to clinical content in groups | Before group-practice pilot | Daniela + product |
| Child sign-in mechanism | Before child portal build | Architect + security |
| Branding: "powered by SyV" requirement | Before branding build | SyV leadership |
| Starter content ownership and clinical review | Before library seeding | Daniela / clinical agent |
| Feature flags and limits for future tiers | MVP design | Architect |
| Admin console scope (T1/T2 views) | MVP design | Architect + product |
| Definition of "active patient" for pricing | Before pricing work | Product + SyV leadership |
| Pilot terms (free, founder discount, data ownership, exit) | Before Phase B | SyV leadership |

## 13. Roadmap shape (high level; detail in `DEVELOPMENT_ROADMAP.md`)

1. **Foundation:** auth, orgs, RBAC, isolation, audit, security baseline, i18n shell, branding tokens.
2. **Clinical core:** patients, guardians, consents, records, sessions, notes, plans, documents.
3. **Between-session engine:** resource library, builder, versions, assignments, portal, responses.
4. **Hardening and pilot readiness:** accessibility audit, pen-test, DPA, break-glass, backups drill, onboarding assets.
5. **Post-MVP candidates (not committed):** scheduling basics, reminders by other channels, branching logic, billing and plans, custom domains, additional locales, supervisor sharing, interoperability.
