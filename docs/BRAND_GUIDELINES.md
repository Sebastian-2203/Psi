# Brand Guidelines — Daniela Ortega · Psicóloga

> Status: **Phase 0 — PROVISIONAL.** No visual evidence of the existing brand could be collected.
> Every color, font and visual rule in this document is a **proposal awaiting validation** by Daniela Ortega,
> unless explicitly labeled otherwise. Nothing here should be treated as the final brand.
>
> Owner: Designer agent (Brand / Creative Direction) · Technology partner: SyV Solutions
> Last updated: 2026-11-08 · Companion document: [`DESIGN_SYSTEM.md`](./DESIGN_SYSTEM.md)

---

## 0. Evidence labels used in this document

| Label | Meaning |
|---|---|
| **OBSERVED** | Seen directly in a primary source controlled by the brand owner (cited). |
| **REPORTED** | Stated in text/metadata from a source (cited), not visually verified. |
| **PROVISIONAL** | A designer proposal. Not evidence. Must be validated or replaced once assets arrive. |
| **UNATTRIBUTED** | Found publicly, but **not** clearly linked to `@psicologadanielaortega`; deliberately *not* used. |

Rule: several professionals share the name "Daniela Ortega". Only evidence clearly linked to the handle
`psicologadanielaortega` (or supplied by Daniela herself) may be attributed to this brand.

---

## 1. Research log

Date of research: 2026-11-08. Methods restricted to: one direct fetch of the official URL and standard web
searches. No third-party scraping/mirror/analytics services were used, and no attempt was made to bypass
Instagram's login wall.

| # | Method | URL / query | Result |
|---|---|---|---|
| 1 | WebFetch (official URL, single attempt) | `https://www.instagram.com/psicologadanielaortega/` | **Failed — HTTP 429 Too Many Requests.** No body returned. No bio, posts, avatar, link or colors could be read. Instagram typically also gates content behind login; this was not circumvented. |
| 2 | Web search | `psicologadanielaortega` | No result referencing the handle. Results were unrelated people (other Ortegas, academics). |
| 3 | Web search | `"Daniela Ortega" psicóloga` | One exact-name match: a Doctoralia Colombia listing for "Daniela Ortega Higuita" (see #5). All other results were different people. No personal website found. |
| 4 | Web search | `"psicologadanielaortega" instagram OR linktr.ee OR sitio web` | No link page (Linktree or similar), no website, no directory listing referencing the handle. |
| 5 | WebFetch (directory listing) | `https://www.doctoralia.co/perfil/daniela-ortega-higuita` | Page exists (psychologist, Bogotá, lists adults and children). **It does not mention the Instagram handle nor any personal/social link.** Classified **UNATTRIBUTED** — not used for any brand conclusion. |
| 6 | Web search | `Psicóloga Daniela Ortega terapia infantil adultos consulta` | No exact match beyond #5; only other professionals with similar names. |

### 1.1 Conclusion of research

- **No OBSERVED visual evidence** (logo, colors, typography, photography, post templates) was obtained.
- **REPORTED evidence clearly linked to the handle: only the handle and brand name themselves**, as given in the
  project brief: "Daniela Ortega — Psicóloga", `instagram.com/psicologadanielaortega`.
- The project brief (not a public source) states the product serves **adult and child patients**.
  This is labeled **REPORTED (project brief)** and is the only audience information used.
- The Doctoralia listing (#5) may or may not be the same person. It must **not** be cited as brand evidence
  until Daniela confirms it.

### 1.2 Next research step

Request the assets in §14 directly from Daniela. Screenshots supplied by the owner are the preferred, compliant
route for Instagram content.

---

## 2. Brand analysis (evidenced items only)

| Item | Finding | Label | Source |
|---|---|---|---|
| Brand name | "Daniela Ortega — Psicóloga" | REPORTED | Project brief; handle matches |
| Primary channel | Instagram, `@psicologadanielaortega` | REPORTED | Project brief (URL); content not accessible |
| Handle language | Spanish ("psicóloga") → Spanish-speaking audience likely | REPORTED (inference from handle) | Handle text |
| Practice type | Personal clinical brand (named individual, not an institution) | REPORTED (inference from name) | Handle/name |
| Audience | Adults and children | REPORTED | Project brief |
| Logo | Unknown | — | Not accessible |
| Palette | Unknown | — | Not accessible |
| Typography | Unknown | — | Not accessible |
| Photography | Unknown | — | Not accessible |
| Tone of voice | Unknown | — | Not accessible |
| Location / country | Unknown (not attributed) | — | Doctoralia Bogotá listing is UNATTRIBUTED |

Strategic implication: the brand is a **person-led** practice. Trust is built on the professional herself,
so the digital product should feel like an extension of her consultation room — not of a hospital or a SaaS tool.

---

## 3. Visual identity assessment

**Existing identity (evidence):** None could be assessed. No logo, color, type or imagery was observed.

**Assessment approach once assets arrive (PROVISIONAL checklist):**
1. Extract HEX values from the original logo vector (not from compressed Instagram JPEGs).
2. Sample recurring colors across 15–20 posts; note frequency, not one-offs.
3. Identify type families from source files or Daniela's design tool (Canva templates, etc.).
4. Note recurring graphic devices (frames, shapes, illustration style, photo treatment).
5. Assess legibility and WCAG contrast of existing combinations; flag any that fail.
6. Classify each element: *keep as-is* / *refine for digital* / *replace*.

Until then, all sections below use a neutral, warm **PROVISIONAL** direction designed to be easily re-skinned
through the token system in `DESIGN_SYSTEM.md`.

---

## 4. Color palette

### Existing identity (evidence)
None. No brand color has been observed.

### Recommended refinements
Not possible yet. Once real colors arrive: keep the brand hue, adjust lightness/saturation only as needed to
reach WCAG 2.2 AA for text (4.5:1) and UI components (3:1).

### New digital applications — PROVISIONAL palette
Direction: **warm, calm, trustworthy, human, accessible.** Warm off-whites instead of clinical white; a muted
sage-teal for calm and growth; clay/terracotta accents for warmth. No saturated "medical blue", no heavy gradients.

| Role | HEX | Use | Label |
|---|---|---|---|
| Background | `#FBF8F4` | App canvas (warm paper) | PROVISIONAL |
| Surface / card | `#FFFFFF` | Cards, dialogs | PROVISIONAL |
| Foreground | `#2E2A27` | Body text (warm charcoal, not pure black) | PROVISIONAL |
| Muted text | `#6B625A` | Secondary text, captions | PROVISIONAL |
| Primary — sage teal | `#3D6B5E` | Primary buttons, links, focus | PROVISIONAL |
| Secondary — sand | `#EFE6DB` | Secondary buttons, chips | PROVISIONAL |
| Accent — clay (soft) | `#F7E4D8` with text `#7A3E26` | Highlights, selected states | PROVISIONAL |
| Muted surface | `#F2EDE7` | Section fills, table stripes | PROVISIONAL |
| Divider | `#E3DBD1` | Decorative dividers only | PROVISIONAL |
| Input border | `#8C8178` | Form field outlines (≥3:1) | PROVISIONAL |
| Destructive | `#B3261E` | Delete, errors | PROVISIONAL |
| Success | `#2F6B45` | Confirmations | PROVISIONAL |
| Warning | `#FFF2D6` with text `#7A4E00` | Caution banners | PROVISIONAL |
| Info | `#2D5B8A` | Informational | PROVISIONAL |

**Child mode accents (same brand, more playful) — PROVISIONAL:** sun `#F4C25B`, coral `#F2A285`,
sky `#BFDDF2`, primary slightly brighter `#2F7466`. Always paired with dark text (see contrast table in
`DESIGN_SYSTEM.md` §3.4).

**Color rules (PROVISIONAL):**
- Color is never the only carrier of meaning (pair with icon + text).
- Max one primary-filled button per view.
- Clinical risk/alert states use destructive/warning tokens sparingly — avoid alarming red screens.

---

## 5. Typography

### Existing identity (evidence)
None observed.

### Recommended refinements
Once the brand's fonts are known: if they are licensed display fonts, use them only for headings/marketing and
keep an open-source, highly legible family for UI and clinical text.

### New digital applications — PROVISIONAL
| Use | Family | Why |
|---|---|---|
| UI + body | **Inter** (Google Fonts, OFL) | Excellent screen legibility, full Spanish diacritics (á é í ó ú ñ ü ¿ ¡), tabular numbers for dates/tables. |
| Headings (adult + marketing) | **Fraunces** (Google Fonts, OFL), soft optical settings | Warm, human serif; signals care and craft without looking corporate. |
| Child mode headings | **Nunito** (Google Fonts, OFL) | Rounded terminals feel friendly and playful while remaining very readable. |

All three are PROVISIONAL and swappable through tokens. Minimum body size 16px; clinical notes 16–17px with
1.6 line-height.

---

## 6. Logo usage

### Existing identity (evidence)
Logo not observed. **Do not recreate, trace or approximate the logo from memory or low-resolution images.**

### Recommended refinements
On receipt of the logo: verify clear-space, minimum size, and that it works in one color (for favicons,
PDFs and stamps on reports).

### New digital applications — PROVISIONAL rules
- Until the real logo is supplied, use a **text wordmark placeholder**: "Daniela Ortega" (heading font) +
  "Psicóloga" (UI font, muted). Labeled as placeholder in the codebase.
- Required variants: full color, single color dark, single color light (reverse), square/avatar mark, favicon (32/180/512px).
- Clear-space: at least the height of the wordmark's capital letter on all sides.
- Minimum width: 120px (horizontal), 32px (mark).
- Never: stretch, recolor outside the palette, add shadows/gradients, place on busy photos.
- In white-label tenants, each organization's logo replaces this one through `organization_branding`.

---

## 7. Iconography

### Existing identity (evidence)
None observed.

### Recommended refinements
If Instagram posts use a recognizable illustration/icon style, mirror its stroke weight and corner style.

### New digital applications — PROVISIONAL
- Library: **Lucide** (ships with shadcn/ui; ISC license). Outline, 1.5–2px stroke, rounded joins.
- Sizes: 16 (inline), 20 (buttons/nav), 24 (headers). Child mode: 24–32 with optional filled soft background circle.
- Avoid medical clichés (stethoscopes, crosses, pills, brains with gears). Prefer neutral metaphors:
  calendar, notebook, leaf/sprout, hands, chat bubble.
- Icons always have an accessible label (visible text or `aria-label`).

---

## 8. Imagery & photography

### Existing identity (evidence)
None observed. Whether Daniela uses portraits, stock or illustration is unknown.

### Recommended refinements
Use her own professional portraits (with usage rights) as the primary trust signal on public/portal surfaces.

### New digital applications — PROVISIONAL
- Natural light, warm tones, real spaces; no staged "doctor in white coat" stock.
- **Never** show identifiable patients. No images of distress used as decoration.
- Child mode: simple flat illustrations (soft shapes, limited palette) rather than photos of children.
- Inside the clinical app, imagery is minimal: empty states and onboarding only.
- All images need alt text; decorative images use empty alt.

---

## 9. Graphic elements

### Existing identity (evidence)
None observed.

### Recommended refinements
Pending posts review.

### New digital applications — PROVISIONAL
- Soft organic blob or rounded-rectangle shapes in muted/secondary tones as subtle backgrounds (≤10% of a view).
- Generous radius (see design system), hairline dividers, plenty of whitespace.
- **No heavy gradients**; at most a very subtle two-tone wash on marketing hero areas.
- Child mode: allowed small decorative stickers/stars in activity completion, never in clinical areas.

---

## 10. Design principles (PROVISIONAL)

1. **Calma primero (calm first).** Low visual noise; one clear task per screen.
2. **Humano, no hospitalario.** Warm neutrals, human language, no clinical sterility.
3. **Confianza visible.** Clear privacy cues (locked notes, who can see what), consistent patterns.
4. **Accesible por defecto.** WCAG 2.2 AA minimum, keyboard and screen-reader ready, reduced motion respected.
5. **Mismo ADN, dos voces.** Adult = mature and sober; child = more playful, same palette family and tokens.
6. **Marca del profesional.** The organization's brand leads; the product (SyV) stays in the background.

---

## 11. Tone of voice (Spanish-first, bilingual)

### Existing identity (evidence)
No captions or bio were accessible. Tone unknown.

### Recommended refinements
Collect 5–10 captions Daniela considers representative; align microcopy with her real voice (tú vs usted, emoji use).

### New digital applications — PROVISIONAL
- Spanish (es) is the primary language; English (en) is secondary and must be a faithful, natural translation, not literal.
- Default address: **"tú"** in the patient portal (warm), neutral impersonal forms in clinical staff UI. *Pending decision: "tú" vs "usted" — region-dependent.*
- Short, clear, kind. No jargon to patients; correct clinical terminology for professionals.
- Never blaming: "No pudimos guardar los cambios. Inténtalo de nuevo." rather than "Error: entrada inválida".

| Context | Español (primario) | English |
|---|---|---|
| Portal greeting (adult) | "Hola, Ana. Qué bueno verte de nuevo." | "Hi Ana, good to see you again." |
| Portal greeting (child) | "¡Hola, Leo! ¿Listo para tu actividad?" | "Hi Leo! Ready for your activity?" |
| Empty state | "Aún no tienes actividades asignadas." | "You don't have any activities yet." |
| Locked note | "Nota finalizada. Puedes agregar una adenda." | "Note finalized. You can add an addendum." |
| Error | "Algo no salió bien. Tus datos están a salvo; inténtalo de nuevo." | "Something went wrong. Your data is safe; please try again." |

---

## 12. Brand personality (PROVISIONAL)

| Is | Is not |
|---|---|
| Cálida (warm) | Infantil in adult spaces |
| Serena (calm) | Fría / clínica |
| Profesional y confiable | Corporativa |
| Cercana (approachable) | Informal en temas clínicos |
| Esperanzadora (hopeful) | Eufórica / exagerada |

To be validated against Daniela's own description of her practice and her real content.

---

## 13. Digital guidelines

### Existing identity (evidence)
Instagram presence reported; no other digital channel found (no website, no link page) in research §1.

### Recommended refinements
If a link page or website is created, reuse the same tokens so Instagram → portal → app feel continuous.

### New digital applications — PROVISIONAL
- **Clinical dashboard (professional):** sober, dense-but-airy, adult tokens; the brand appears in logo, primary color, headings.
- **Patient portal — adult:** same tokens, larger type, more whitespace, warm greetings.
- **Patient portal — child:** child-mode tokens (rounded font, accent colors, larger targets ≥ 48px, celebratory micro-feedback that respects reduced motion).
- **Email/notifications:** plain, text-first, logo + primary color only; never include clinical content in email bodies.
- **PDF exports:** single-color logo, Inter body, no background tints (print-friendly).
- **White-label:** every brand value comes from tokens; no hard-coded Daniela colors in components.

---

## 14. Assets required from Daniela (checklist)

- [ ] Logo — master vector **SVG** (and AI/PDF if available)
- [ ] Logo — **PNG** variants: full color, single color dark, reverse/white, square avatar mark, transparent background
- [ ] Official color palette (HEX/RGB; Pantone/CMYK if printed materials exist)
- [ ] Font names and font files/licenses (or Canva template names)
- [ ] **15–20 screenshots** of representative Instagram posts (feed, carousels, stories highlights)
- [ ] **Profile screenshot** (avatar, bio, highlights, link-in-bio)
- [ ] Professional photos **with written usage rights** (photographer release)
- [ ] Brand manual / style guide, if one exists
- [ ] Tone examples: 5–10 captions she considers "very her"; preference "tú" vs "usted"
- [ ] Audience info: country/city, age groups (adult, adolescent, child), modalities (online/in person), languages
- [ ] Confirmation of which public listings (if any) belong to her (e.g. directory profiles)
- [ ] Things she dislikes / wants to avoid visually

---

## 15. Provisional marketing direction

- **Positioning (PROVISIONAL):** "Acompañamiento psicológico cercano y profesional, para adultos y niños" — to be validated.
- **Instagram ↔ product continuity:** posts announcing the portal should use the same palette and type as the app
  once validated, so patients recognize it instantly.
- **Content pillars (proposal):** psychoeducation, practical tools (linked to portal activities), behind-the-scenes
  of the practice, guidance for parents.
- **Portal as differentiator:** "Tus actividades entre sesiones, en un solo lugar seguro."
- **Ethics:** no testimonials that identify patients; no outcome promises; follow local professional-association advertising rules.
- **Measurement (later phase):** portal activation rate, activity completion, appointment adherence — no clinical data in marketing analytics.

---

## 16. Pending decisions

1. Real logo, palette and fonts (blocks finalizing any of §4–§9).
2. "Tú" vs "usted" for patients; regional Spanish variant.
3. Whether child mode applies by age, by professional toggle, or both.
4. Whether the Doctoralia listing (UNATTRIBUTED) is hers.
5. Whether dark mode is offered in the patient portal at launch (see `DESIGN_SYSTEM.md` §4).
