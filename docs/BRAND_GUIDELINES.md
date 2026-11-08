# Brand Guidelines — Psico D.O.H. / Daniela Ortega · Psicóloga

> Status: **Phase 0 — evidence-based draft (v2).** The provisional sage palette of v1 is **withdrawn** and
> replaced by a direction built on two client-supplied inputs (2026-11-08): the logo file (**OBSERVED**) and the
> client's own analysis of Daniela's Instagram publications (**REPORTED (client analysis)**).
> HEX values and font names from the client analysis are **approximations / recommendations**, not verified
> original assets. No brand manual or original font files are known to exist.
>
> Owner: Designer agent (Brand / Creative Direction) · Technology partner: SyV Solutions
> Last updated: 2026-11-08 · Companion document: [`DESIGN_SYSTEM.md`](./DESIGN_SYSTEM.md)

---

## 0. Evidence labels used in this document

| Label | Meaning |
|---|---|
| **OBSERVED** | Seen directly in a primary source controlled or supplied by the brand owner/client (cited). |
| **REPORTED** | Stated in text from a source (cited), not visually verified by the designer. `REPORTED (client analysis)` = the client's own visual analysis of Daniela's Instagram. |
| **PROVISIONAL** | A designer proposal. Not evidence. Must be validated by the client. |
| **UNATTRIBUTED / UNCONFIRMED** | Found publicly or inferred, but **not** confirmed as belonging to this brand; deliberately not used as fact. |

Rule: several professionals share the name "Daniela Ortega". Only evidence linked to `@psicologadanielaortega`
or supplied by the client may be attributed to this brand.

---

## 1. Research log

| # | Date | Method | Source | Result | Label |
|---|---|---|---|---|---|
| 1 | 2026-11-08 | WebFetch (single attempt) | `https://www.instagram.com/psicologadanielaortega/` | **Failed — HTTP 429.** No content read; login wall not circumvented. | — |
| 2 | 2026-11-08 | Web search | `psicologadanielaortega` | No result referencing the handle. | — |
| 3 | 2026-11-08 | Web search | `"Daniela Ortega" psicóloga` | One exact-name match: Doctoralia listing "Daniela Ortega Higuita" (#5). Others were different people. | — |
| 4 | 2026-11-08 | Web search | handle + linktr.ee / website | No link page or website found. | — |
| 5 | 2026-11-08 | WebFetch | `doctoralia.co/perfil/daniela-ortega-higuita` | Psychologist, Bogotá, adults and children. Does **not** mention the handle. | UNATTRIBUTED |
| 6 | 2026-11-08 | Web search | `Psicóloga Daniela Ortega terapia infantil adultos consulta` | No further match. | — |
| 7 | 2026-11-08 | **Client-provided file**, viewed by designer | `docs/assets/brand/psico-doh-logo-provided-lowres.png` (624×620 raster, upscaled, low resolution) | Logo: single-line outline tree with the Greek letter **ψ** in the canopy, a grounding line under the trunk, serif wordmark **"Psico D.O.H."**, deep red on white. Orchestrator pixel sampling of darkest ink: ~`#A73C37` / `#AE312B` / `#9F3C3C`; anti-aliased edges ~`#DC9C9A`. Values approximate (low resolution, compression). | **OBSERVED** (client-provided file) |
| 8 | 2026-11-08 | **Client analysis** of Daniela's Instagram (supplied in writing) | Client brief | Personality, 6-colour palette, 3 Google font recommendations, hierarchy, visual style, audience modes, Daniela-vs-SyV separation (summarised in §2–§12). | **REPORTED (client analysis)** — HEX/fonts are approximations |

### 1.1 What changed with #7 and #8

- We now have **OBSERVED** logo evidence and a **REPORTED** palette/type direction. The v1 sage/clay palette,
  Inter/Fraunces fonts and text-wordmark placeholder are **retired**.
- **Name discrepancy (open):** the project brief says "Daniela Ortega — Psicóloga"; the logo wordmark reads
  **"Psico D.O.H."**. "D.O.H." *plausibly* stands for "Daniela Ortega Higuita", which would link the Doctoralia
  listing (#5) to this brand — but this is **UNCONFIRMED**. Nothing in this document assumes it.
  → Client must confirm (§16): practice name/wordmark to use in the product, and whether listing #5 is hers.
- The logo raster is **not production-ready** (low-res, upscaled). It may be used only in internal mock-ups
  until a vector master arrives. **Do not trace, redraw or "clean up" the logo** without the client's approval.

---

## 2. Brand identity & personality

| Item | Finding | Label | Source |
|---|---|---|---|
| Practice wordmark | "Psico D.O.H." | OBSERVED | Logo file (#7) |
| Professional | Daniela Ortega — Psicóloga | REPORTED | Project brief |
| Meaning of "D.O.H." | Possibly "Daniela Ortega Higuita" | UNCONFIRMED | Inference only |
| Primary channel | Instagram `@psicologadanielaortega` | REPORTED | Project brief |
| Audience | Adults, children and adolescents | REPORTED | Project brief + client analysis |
| Personality | Warm, approachable, calm, trustworthy, human, educational, professional, empathetic | REPORTED (client analysis) | #8 |
| Positioning of the product | "A welcoming digital practice, not hospital software" | REPORTED (client analysis) | #8 |
| Instagram visual style | Soft warm backgrounds, hand-drawn illustrations, red/coral line art, pastel combinations, educational infographics, real-life photography, friendly storytelling, wellness themes | REPORTED (client analysis) | #8 |

**Brand idea (PROVISIONAL synthesis):** *growth with roots* — the logo's tree (growth, shelter), ψ (psychology)
and grounding line (stability) suggest care that is both warm and grounded. The digital product should feel like
an extension of her consultation room: warm paper, a single confident red line, calm type.

| Is | Is not |
|---|---|
| Cálida, cercana (warm, approachable) | Infantil in adult spaces |
| Serena (calm) | Fría / hospitalaria |
| Profesional y confiable | Corporativa / "software de clínica" |
| Educativa (explains, guides) | Condescendiente |
| Humana, empática | Eufórica, exagerada, alarmista |

---

## 3. Existing identity vs refinements vs new applications

| Element | Existing identity (evidence) | Recommended refinement (PROVISIONAL) | New digital application (PROVISIONAL) |
|---|---|---|---|
| Logo | Tree + ψ outline, serif "Psico D.O.H.", deep red (OBSERVED, low-res) | Vector master; monochrome + reversed variants; simplified small-size mark | Favicon/app icon, portal header, login, PDF header, email header |
| Logo red | ~`#A73C37` ink (OBSERVED, approx.) | Adopt as accessible functional red (`coral-700`) | Primary buttons, links, focus ring |
| Palette | 6 colours (REPORTED, approx.) | Keep as brand reference; add accessible shades + tints | Semantic tokens per context (adult / child / professional) |
| Type | Playfair Display, Caveat, Nunito Sans (REPORTED as recommendation; original fonts not verified) | Strict roles; Caveat restricted | Fluid type scale, next/font loading |
| Illustration | Hand-drawn, red/coral line art (REPORTED) | Single-weight line echoing the logo stroke | Empty states, onboarding, child-mode activities |
| Photography | Real-life photography (REPORTED) | Warm natural light, rights-cleared | Portal/marketing only, never clinical areas |
| Templates | Unknown (likely Canva — unverified) | Obtain originals | Instagram ↔ portal continuity |

---

## 4. Logo

### 4.1 Observed description (OBSERVED — client file #7)
- **Symbol:** a tree drawn as one continuous outline (cloud-like canopy of rounded lobes, trunk flaring into roots);
  the Greek letter **ψ** sits centred in the canopy, its stem continuing visually into the trunk.
- **Ground line:** a slightly curved horizontal line under the trunk.
- **Wordmark:** "Psico D.O.H." in a classic serif (regular weight, upper/lower case, full stops after each initial),
  centred below the symbol. Typeface **not identified** (do not assume it is Playfair Display).
- **Layout:** stacked (symbol above wordmark). **Colour:** single deep red on white. **Stroke:** thin, uniform,
  monoline; ψ appears slightly heavier with tapered serifs.

### 4.2 Usage rules (PROVISIONAL — to confirm with vector master)
- **Clear space:** minimum = height of the capital "P" of the wordmark (call it *x*) on all sides; 2*x* in
  marketing compositions.
- **Minimum size:** stacked lockup ≥ **96 px wide** on screen / ≥ 25 mm in print. Symbol-only ≥ **32 px**.
  Below 32 px (favicon 16–24 px) the thin outline and ψ will fill in → a **simplified mark** is needed (e.g. ψ only,
  or tree with heavier stroke) — to be designed and approved, not improvised.
- **Colour:** logo red (`coral-700` ≈ `#A73C37`) on white or cream; charcoal `#292522` monochrome;
  white reversed on `coral-700` or charcoal.

| Do | Don't |
|---|---|
| Use the supplied master files only | Trace or redraw from the low-res PNG |
| Place on white, cream `#FFF9D9` or other flat light surfaces | Place on busy photos, pink/peach patterns or gradients |
| Keep proportions and stacked layout (until a horizontal lockup is approved) | Stretch, rotate, outline, add shadows/glows |
| Use monochrome charcoal for fax/print/stamps on reports | Recolour in coral `#D94A43`, pink, peach or blue gray |
| Use reversed white on `coral-700` or charcoal | Reverse on coral `#D94A43` (insufficient line contrast at small sizes) |

### 4.3 Variants required (assets still needed)
Full colour (red) · monochrome charcoal · monochrome black · reversed (white) · symbol-only · simplified small mark
(favicon 16/32, app icon 180/512) · horizontal lockup (symbol left of wordmark) for headers — **all PROVISIONAL
until produced from a vector master (SVG).**

### 4.4 In the product
- Practice/patient surfaces (portal, login, emails, PDFs): this logo (or the tenant's logo in white-label).
- Platform-admin and "powered by" areas: **SyV Solutions** identity only (§12).

---

## 5. Colour palette

### 5.1 Brand reference colours (REPORTED (client analysis) — approximations)

| Name | HEX | Role defined by client | Weight |
|---|---|---|---|
| Cream Yellow | `#FFF9D9` | Dominant brand background, large surfaces | Dominant |
| Coral Red | `#D94A43` | Primary brand colour: buttons, links, highlights, important actions | Accent |
| Pastel Pink | `#F5B9B4` | Secondary cards, decorative, soft highlights — **sparingly** | Minor |
| Peach | `#F8D9A7` | Complementary backgrounds, warm accents — **sparingly** | Minor |
| Blue Gray | `#AAB7C7` | Informational, secondary; balances warmth | Minor |
| Charcoal | `#292522` | Text, headings, icons | Structural |

Plus the **logo ink** (OBSERVED, approx.): `#A73C37` (range `#9F3C3C`–`#AE312B`).

### 5.2 Accessibility findings (computed 2026-11-08 — full table in `DESIGN_SYSTEM.md` §3.3)
- Coral `#D94A43`: white text on it **4.19:1**, as text on cream **3.95:1**, on white **4.19:1** → **fails AA for
  normal text**; passes for large text (≥24 px or ≥18.66 px bold) and non-text UI (≥3:1).
- Logo ink `#A73C37`: white on it **6.28:1**, on cream **5.92:1** → **passes AA**. 
- Pink, peach, blue gray, cream: **surfaces only**, always with charcoal text (9.03 / 11.20 / 7.46 / 14.33:1).
  Never as text or as the only boundary of a control (blue gray on white 2.04:1).

### 5.3 Recommended refinement (PROVISIONAL)
Keep the client's HEX as **brand reference colours** (illustration, marketing, large display). Use a
**functional accessible red** for anything that must be read or operated:

| Functional shade | HEX | Derived from | Use |
|---|---|---|---|
| `coral-700` (**primary**) | `#A73C37` | Logo ink (OBSERVED) | Button fills, link text, focus ring, active nav |
| `coral-800` | `#8A302C` | darker step | Hover/pressed |
| `coral-600` | `#C0403A` | between brand coral and ink | Large text, icons, child-mode accents (5.20:1 on white, 4.91:1 on cream) |
| `coral-500` (brand) | `#D94A43` | client | Line art, illustrations, large display, decorative highlights |

This ties the UI directly to the logo: the red people click is the red of the logo.

### 5.4 Usage weighting (PROVISIONAL — colours must not have equal weight)

| Share | Patient portal (adult / child) | Professional dashboard |
|---|---|---|
| ~60% | Cream `#FFF9D9` canvas + white cards | White / near-white work areas (cream ≤10%: sidebar, canvas edges) |
| ~30% | Charcoal type + soft tints (pink, peach, blue-gray tints — each small) | Charcoal type, neutral greys, blue-gray for info |
| ~10% | Red (`coral-700` actions, `coral-500` line art) | Red ≤5%: one primary action per view, active nav, focus |

Child mode may raise tints (pink/peach/blue gray) to ~20% of the 30%, never the red.

### 5.5 Colour rules
- Colour never carries meaning alone (icon + text always).
- One filled primary button per view.
- Errors must not look like brand emphasis: see error treatment in `DESIGN_SYSTEM.md` §3.5 (distinct crimson-wine
  hue, icon, label, tinted container, outline-style destructive buttons).
- No oversaturation, no hospital blue, no heavy gradients, heavy shadows or glassmorphism (REPORTED, client).

---

## 6. Typography

### 6.1 Families (REPORTED (client analysis) as recommendations — originals unverified; all Google Fonts, OFL)

| Family | Weights | Role |
|---|---|---|
| **Playfair Display** | 400, 500, 600, 700 | H1/H2, marketing, section titles, editorial statements |
| **Caveat** | 400, 500, 600 | Decorative short phrases only |
| **Nunito Sans** | 400, 500, 600, 700 | Body, navigation, buttons, forms, patient records, clinical docs, dashboard, labels |

### 6.2 Hierarchy (REPORTED, client)
H1 Playfair 600 · H2 Playfair 500/600 · H3 Nunito Sans 700 · Body Nunito Sans 400 · Buttons Nunito Sans 700 ·
Labels Nunito Sans 600 · Decorative Caveat 500. Sizes/line-heights: `DESIGN_SYSTEM.md` §4.

### 6.3 Caveat restrictions (mandatory)
**Never** for paragraphs, forms, labels, navigation, buttons, tables, clinical documents, notes, error messages,
legal text or any long content. Allowed: ≤ ~8 words, ≥ 20 px, decorative/emotional accents ("¡Lo lograste!",
"Un paso a la vez"). The same meaning must never depend on reading the Caveat text alone. Not in the
professional dashboard except possibly the empty-state flourish (PROVISIONAL, optional).

### 6.4 Additional rules (PROVISIONAL)
- Playfair Display only ≥ 24 px (high stroke contrast degrades at small sizes); never in tables or forms.
- Nunito Sans body min 16 px; clinical reading 17 px / 1.7.
- Spanish diacritics (á é í ó ú ñ ü ¿ ¡) are covered by all three; load `latin` + `latin-ext` for names.

---

## 7. Illustration & line art (PROVISIONAL, based on REPORTED style + OBSERVED logo)
- **Single-weight line art** in `coral-500` `#D94A43` (or `coral-700` on cream for stronger presence), echoing the
  logo's monoline tree: rounded caps and joins, no fills or only flat pastel fills (pink/peach/blue gray) behind
  the line, slightly imperfect hand-drawn feel.
- Motifs: trees, leaves, roots, hands, paths, sun, home, conversation bubbles. Avoid medical clichés and
  "brain" imagery; avoid images of distress as decoration.
- Adult portal: sparse — empty states, onboarding, a single hero line drawing. No childish characters.
- Child/adolescent mode: more illustrations, friendly characters allowed in activities and celebrations;
  still within line art + pastel fills. Not on every surface.
- Professional dashboard: line art only in empty states and onboarding, small and muted.
- Educational infographics (REPORTED): use charcoal text, line icons, one pastel fill per block.

## 8. Photography (PROVISIONAL, based on REPORTED "real-life photography")
- Real, warm, natural-light photos; Daniela's own professional portraits as the primary trust signal
  (written usage rights required).
- **Never** identifiable patients; no stock "doctor in white coat"; no images of crisis.
- Photos only in portal welcome/marketing surfaces, never inside clinical areas. Alt text always.

## 9. Iconography (PROVISIONAL)
- **Lucide** (ships with shadcn/ui). Outline only, **stroke 1.75 px** at 20–24 px to harmonise with the thin logo
  line (2 px at 16 px for legibility). Rounded caps/joins.
- Colour: charcoal by default; `coral-700` for active/primary; blue gray `#46586E` (`bluegray-700`) for info.
- Sizes 16 / 20 / 24; child mode 24–32 in a soft tinted circle (pink/peach/blue-gray-100).
- Every icon has a visible label or `aria-label`. No medical clichés.

---

## 10. Tone of voice (Spanish-first, bilingual)
REPORTED (client analysis): warm, educational, empathetic, professional. Captions were not read by the designer.
PROVISIONAL microcopy rules:
- Spanish (es) primary; English (en) natural, not literal.
- Default **"tú"** in the patient portal; neutral impersonal forms in professional UI. *Pending: tú vs usted.*
- Short, clear, kind, explanatory (educational). No jargon to patients. Never blaming.

| Context | Español | English |
|---|---|---|
| Portal greeting (adult) | "Hola, Ana. Qué bueno verte de nuevo." | "Hi Ana, good to see you again." |
| Portal greeting (child) | "¡Hola, Leo! ¿Listo para tu actividad?" | "Hi Leo! Ready for your activity?" |
| Empty state | "Aún no tienes actividades asignadas." | "You don't have any activities yet." |
| Locked note | "Nota finalizada. Puedes agregar una adenda." | "Note finalized. You can add an addendum." |
| Error | "Algo no salió bien. Tus datos están a salvo; inténtalo de nuevo." | "Something went wrong. Your data is safe; please try again." |
| Caveat accent (child) | "¡Lo lograste!" (+ text equivalent in body font) | "You did it!" |

---

## 11. Audience modes (REPORTED direction, PROVISIONAL specifics)

| Mode | Direction (REPORTED, client) | Application (PROVISIONAL) |
|---|---|---|
| **Adult portal** (`portal-adult`) | Minimal, calm, sophisticated, no childish illustration | Cream canvas, white cards, Playfair page titles, sparse line art, red only for actions |
| **Child / adolescent portal** (`portal-child`) | More illustrations, friendly interactive elements — but not a children's game everywhere | Larger targets, pastel tints, line-art characters in activities/celebrations, Caveat accents; navigation and forms stay plain |
| **Professional dashboard** (`professional`) | Professional, readable, efficient; brand colours used subtly; clinical usability first | White work areas, cream only as subtle frame, red ≤5%, dense-but-airy tables, no Caveat |

Open: whether adolescents (≈12–17) use `portal-child` or `portal-adult` (§16).

---

## 12. Daniela vs SyV Solutions — brand separation (REPORTED, client)

| Surface | Identity |
|---|---|
| Login, patient portal, activity player, emails to patients, PDFs, professional dashboard | **Practice brand** (Psico D.O.H. / Daniela — or tenant brand in white-label) |
| "Powered by SyV" footer (small, muted, one line) | SyV Solutions |
| Platform-admin console, technical docs, status pages, platform legal/terms | SyV Solutions |

Rules: never combine both logos in one lockup; never use Daniela's palette for SyV surfaces or vice-versa.
**SyV identity is not defined yet — assets pending.** Until then platform-admin uses a neutral system theme
(PROVISIONAL, `DESIGN_SYSTEM.md` §2.4).

---

## 13. Design principles (PROVISIONAL, aligned with client principles)
1. **Calma primero.** Generous whitespace, one task per screen, soft surfaces, subtle borders.
2. **Humano, no hospitalario.** Cream and warm red, no hospital blue, no sterile white-on-blue.
3. **Jerarquía clara.** One dominant colour, one accent; serif titles, sans everything functional.
4. **Redondeado, no infantil.** Rounded corners but not pill-shaped everything (REPORTED, client).
5. **Accesible por defecto.** WCAG 2.2 AA; functional shades used for text/actions.
6. **Mismo ADN, tres voces.** Adult, child/adolescent and professional share tokens, differ in density and tone.
7. **La marca del profesional al frente; SyV al fondo.**

---

## 14. Digital guidelines (PROVISIONAL)
- **Email/notifications:** text-first, logo + `coral-700` only; no clinical content in email bodies.
- **PDF exports:** monochrome or red logo, Nunito Sans body, no cream background (print-friendly).
- **Instagram ↔ portal continuity:** announcement posts reuse cream + red line art + Playfair so patients recognise
  the portal instantly.
- **White-label:** every value comes from tokens; no hard-coded Daniela colours in components.

### 14.1 Marketing direction (PROVISIONAL)
- Positioning: "Acompañamiento psicológico cercano y profesional, para adultos, niños y adolescentes" — to validate.
- Content pillars: psychoeducation, practical tools linked to portal activities, guidance for parents.
- Portal message: "Tus actividades entre sesiones, en un solo lugar seguro."
- Ethics: no identifying testimonials, no outcome promises; follow professional-association advertising rules
  `[NEEDS LEGAL VERIFICATION]`.

---

## 15. Assets still required (checklist)

- [ ] **Vector logo master (SVG**, plus AI/PDF/EPS if available) — current file is a low-res raster
- [ ] **Confirmation of practice name/wordmark** for the product: "Psico D.O.H.", "Daniela Ortega — Psicóloga", or both (and where each appears)
- [ ] Meaning of "D.O.H." and whether the Doctoralia listing "Daniela Ortega Higuita" is hers
- [ ] Logo variants if they exist (monochrome, reversed, symbol-only, horizontal)
- [ ] Name of the wordmark typeface (if known)
- [ ] **Original Canva (or other) templates** used for Instagram, with their fonts and colours
- [ ] **Exact fonts** actually used, if any differ from the recommended Playfair / Caveat / Nunito Sans
- [ ] Exact brand HEX values if defined anywhere (to replace approximations)
- [ ] 10–20 representative post screenshots + profile screenshot (to let the designer verify the client analysis)
- [ ] Line-art / illustration source files and their author/licence
- [ ] Professional photos with written usage rights
- [ ] Tone examples (5–10 captions); tú vs usted
- [ ] **SyV Solutions identity assets** (logo, colours, fonts) for "powered by" and platform admin
- [ ] Things Daniela dislikes / wants to avoid visually

---

## 16. Pending decisions / open questions for the client

1. Practice name/wordmark to use in the product ("Psico D.O.H." vs "Daniela Ortega — Psicóloga"); meaning of D.O.H.
2. Is the Doctoralia listing "Daniela Ortega Higuita" hers? (UNCONFIRMED; not used until confirmed.)
3. Approval of `coral-700` `#A73C37` (logo ink) as the functional primary, with `#D94A43` reserved for line art/display.
4. Adolescents: child mode, adult mode, or a separate lighter "teen" variant?
5. Child-mode trigger: age-based, professional toggle, or both.
6. "Tú" vs "usted"; regional Spanish variant (Colombia assumed — unconfirmed).
7. Dark mode deferred for the portal at launch (see `DESIGN_SYSTEM.md` §3.6) — confirm.
8. SyV Solutions identity: timeline for assets.
