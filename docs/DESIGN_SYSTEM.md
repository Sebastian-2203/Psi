# Design System — Psi (Daniela Ortega · Psicóloga, white-label ready)

> Status: **Phase 0 — PROVISIONAL.** All values are proposals pending brand evidence (see
> [`BRAND_GUIDELINES.md`](./BRAND_GUIDELINES.md) §1 — Instagram returned HTTP 429; no visual assets observed).
> Stack target: Tailwind CSS + shadcn/ui, CSS variables, semantic tokens. Frontend implements; this doc defines.
> Last updated: 2026-11-08.

---

## 1. Principles

- **Semantic over literal.** Components consume `--primary`, never `#3D6B5E`.
- **Three layers:** primitives (raw palette) → semantic tokens (role) → component tokens (optional, sparing).
- **Tenant-overridable:** an organization can override a defined subset of semantic tokens; everything else is derived.
- **Accessible by construction:** every text/background pair ships with a verified contrast ratio (§3.4).
- **Modes:** `adult` (default) and `child` are *density/personality* modes on the same token set; `light`/`dark` are *color schemes*.

---

## 2. Token architecture

### 2.1 Layers

```
primitives      --sage-700, --sand-100, --clay-800 ...   (HEX; never used directly in components)
semantic        --background, --foreground, --primary, --primary-foreground ...
component       --sidebar-background, --chart-1 ... (only where shadcn requires)
mode modifiers  [data-mode="child"]  [data-theme="dark"]  [data-tenant="<slug>"]
```

### 2.2 Semantic token list (shadcn-compatible)

| Token | Pair | Purpose |
|---|---|---|
| `--background` / `--foreground` | ✓ | App canvas and body text |
| `--card` / `--card-foreground` | ✓ | Cards, panels |
| `--popover` / `--popover-foreground` | ✓ | Menus, popovers (= card) |
| `--primary` / `--primary-foreground` | ✓ | Main action, links, active nav |
| `--secondary` / `--secondary-foreground` | ✓ | Secondary actions, chips |
| `--accent` / `--accent-foreground` | ✓ | Hover/selected rows, highlights |
| `--muted` / `--muted-foreground` | ✓ | Subtle fills; secondary text |
| `--border` | — | Decorative dividers (not required to hit 3:1) |
| `--input` | — | Form control borders (must hit ≥3:1 vs background) |
| `--ring` | — | Focus ring (≥3:1) |
| `--destructive` / `--destructive-foreground` | ✓ | Delete, errors |
| `--success` / `--success-foreground` | ✓ | Saved, completed |
| `--warning` / `--warning-foreground` | ✓ | Caution (bg tint + dark text) |
| `--info` / `--info-foreground` | ✓ | Neutral information |
| `--radius` | — | Base radius |

shadcn convention stores HSL channels; we store **HEX in docs, HSL channels in CSS** (frontend converts). Example below uses HSL-free hex via `color` for readability; implementation may use `hsl(var(--x))` per shadcn version in use.

### 2.3 CSS (PROVISIONAL reference)

```css
:root {                         /* light · adult · default tenant */
  --background:#FBF8F4; --foreground:#2E2A27;
  --card:#FFFFFF;       --card-foreground:#2E2A27;
  --popover:#FFFFFF;    --popover-foreground:#2E2A27;
  --primary:#3D6B5E;    --primary-foreground:#FFFFFF;
  --secondary:#EFE6DB;  --secondary-foreground:#4A3F35;
  --accent:#F7E4D8;     --accent-foreground:#7A3E26;
  --muted:#F2EDE7;      --muted-foreground:#6B625A;
  --border:#E3DBD1;     --input:#8C8178;  --ring:#3D6B5E;
  --destructive:#B3261E; --destructive-foreground:#FFFFFF;
  --success:#2F6B45;    --success-foreground:#FFFFFF;
  --warning:#FFF2D6;    --warning-foreground:#7A4E00;
  --info:#2D5B8A;       --info-foreground:#FFFFFF;
  --radius:0.75rem;
  --font-sans:"Inter",system-ui,sans-serif;
  --font-heading:"Fraunces",Georgia,serif;
}
[data-theme="dark"] {
  --background:#1B1A19; --foreground:#F1ECE6;
  --card:#252321;       --card-foreground:#F1ECE6;
  --popover:#252321;    --popover-foreground:#F1ECE6;
  --primary:#8EC2B1;    --primary-foreground:#12241F;
  --secondary:#3A332C;  --secondary-foreground:#EDE4DA;
  --accent:#4A2C20;     --accent-foreground:#F6D3C1;
  --muted:#2E2B28;      --muted-foreground:#ABA197;
  --border:#3A3633;     --input:#7D736A;  --ring:#8EC2B1;
  --destructive:#F2A099; --destructive-foreground:#1B1A19;
  --success:#8FCBA3;    --success-foreground:#10251A;
  --warning:#E8BE6A;    --warning-foreground:#2A1C00;
  --info:#9CC1E8;       --info-foreground:#0F1E2E;
}
[data-mode="child"] {
  --background:#FFFBF5;
  --primary:#2F7466;    --primary-foreground:#FFFFFF;
  --kid-sun:#F4C25B;    --kid-sun-foreground:#3A2A00;
  --kid-coral:#F2A285;  --kid-coral-foreground:#4A1E10;
  --kid-sky:#BFDDF2;    --kid-sky-foreground:#0F2C44;
  --radius:1.25rem;
  --font-heading:"Nunito",system-ui,sans-serif;
}
```

Tailwind maps each token: `colors.primary.DEFAULT = 'var(--primary)'`, `colors.primary.foreground = 'var(--primary-foreground)'`, plus `success`, `warning`, `info` extensions; `borderRadius.lg = 'var(--radius)'`, `md = calc(var(--radius) - 2px)`, `sm = calc(var(--radius) - 4px)`.

---

## 3. Color

### 3.1 Primitive palette (PROVISIONAL)

| Ramp | 50 | 100 | 300 | 500 | 700 | 900 |
|---|---|---|---|---|---|---|
| sage | `#EEF4F1` | `#D6E6E0` | `#8EC2B1` | `#5A8C7D` | `#3D6B5E` | `#12241F` |
| sand | `#FBF8F4` | `#EFE6DB` | `#D9CCBD` | `#8C8178` | `#4A3F35` | `#2E2A27` |
| clay | `#FBF1EB` | `#F7E4D8` | `#E8A98C` | `#C46F4E` | `#7A3E26` | `#4A2C20` |

### 3.2 White-label override (per tenant)

Source: `organization_branding` row (fields defined by backend; designer requirement):

| Field | Required | Maps to |
|---|---|---|
| `logo_url` (SVG/PNG), `logo_mark_url`, `favicon_url` | logo yes | header, auth, PDF |
| `primary_color` (HEX) | yes | `--primary`, `--ring` |
| `secondary_color` (HEX) | optional | `--secondary` |
| `accent_color` (HEX) | optional | `--accent` |
| `heading_font` / `body_font` (from an allow-listed set of Google Fonts) | optional | `--font-heading` / `--font-sans` |
| `child_mode_enabled` | optional | enables `[data-mode="child"]` in portal |

**Pipeline:**
1. Server reads tenant branding → validates → emits `<style>[data-tenant="slug"]{--primary:…}</style>` (SSR, no flash).
2. **Auto-derived foregrounds:** for each tenant color `C`, compute `contrast(C,#FFFFFF)` and `contrast(C,#2E2A27)`; choose whichever is higher as `--*-foreground`.
3. **Contrast guard (reject rule):** a tenant color is **rejected** in the settings UI if the better of the two foregrounds is < **4.5:1**, or if `--primary` vs `--background` is < **3:1** (needed for focus ring/links as UI). The UI explains why and proposes the nearest passing shade (shift lightness in OKLCH in 2% steps until it passes).
4. Secondary/accent used as *fills*: their derived foreground must also hit 4.5:1; else reject.
5. Dark mode for tenants: derive by raising lightness of primary to L≈75% (OKLCH) and re-running the guard; if impossible, fall back to default dark primary.
6. Tenants **cannot** override destructive/success/warning/info, `--background`, `--foreground` (keeps semantics and readability stable).

Pseudo-code:
```
fg = argmax(contrast(c, '#FFFFFF'), contrast(c, '#2E2A27'))
if contrast(c, fg) < 4.5 or contrast(c, background) < 3.0: reject(c, suggest=nearest_passing(c))
```

### 3.3 Dark mode stance

- **Professional dashboard:** light and dark offered (respect `prefers-color-scheme`, user toggle persists).
- **Patient portal adult:** light default; dark available — *pending decision* (BRAND_GUIDELINES §16).
- **Child mode:** light only at launch (illustrations/accent colors tuned for light).
- Dark surfaces are warm (`#1B1A19`), never pure black; elevation by lighter surface, not shadow.

### 3.4 WCAG contrast — computed

Computed with the WCAG 2.x relative luminance formula (python, 2026-11-08). Thresholds: text 4.5:1 (AA),
large text/UI 3:1, AAA 7:1.

| Pair (L = light, D = dark, C = child) | Text | Background | Ratio | Result |
|---|---|---|---|---|
| L foreground / background | `#2E2A27` | `#FBF8F4` | 13.43:1 | AAA |
| L foreground / card | `#2E2A27` | `#FFFFFF` | 14.22:1 | AAA |
| L muted-fg / background | `#6B625A` | `#FBF8F4` | 5.64:1 | AA |
| L muted-fg / muted | `#6B625A` | `#F2EDE7` | 5.13:1 | AA |
| L primary-fg / primary | `#FFFFFF` | `#3D6B5E` | 6.06:1 | AA |
| L primary (link text) / background | `#3D6B5E` | `#FBF8F4` | 5.73:1 | AA |
| L secondary-fg / secondary | `#4A3F35` | `#EFE6DB` | 8.28:1 | AAA |
| L accent-fg / accent | `#7A3E26` | `#F7E4D8` | 6.70:1 | AA |
| L destructive-fg / destructive | `#FFFFFF` | `#B3261E` | 6.54:1 | AA |
| L destructive (text) / background | `#B3261E` | `#FBF8F4` | 6.17:1 | AA |
| L success-fg / success | `#FFFFFF` | `#2F6B45` | 6.34:1 | AA |
| L warning-fg / warning | `#7A4E00` | `#FFF2D6` | 6.49:1 | AA |
| L info-fg / info | `#FFFFFF` | `#2D5B8A` | 7.06:1 | AAA |
| L input border / background (UI) | `#8C8178` | `#FBF8F4` | 3.59:1 | UI ≥3 ✓ |
| L ring / background (UI) | `#3D6B5E` | `#FBF8F4` | 5.73:1 | UI ≥3 ✓ |
| L border / background (decorative) | `#E3DBD1` | `#FBF8F4` | 1.29:1 | Decorative only — never sole boundary of a control |
| D foreground / background | `#F1ECE6` | `#1B1A19` | 14.80:1 | AAA |
| D foreground / card | `#F1ECE6` | `#252321` | 13.33:1 | AAA |
| D muted-fg / background | `#ABA197` | `#1B1A19` | 6.85:1 | AA |
| D muted-fg / muted | `#ABA197` | `#2E2B28` | 5.55:1 | AA |
| D primary-fg / primary | `#12241F` | `#8EC2B1` | 8.09:1 | AAA |
| D primary (link) / background | `#8EC2B1` | `#1B1A19` | 8.69:1 | AAA |
| D secondary-fg / secondary | `#EDE4DA` | `#3A332C` | 9.89:1 | AAA |
| D accent-fg / accent | `#F6D3C1` | `#4A2C20` | 8.97:1 | AAA |
| D destructive-fg / destructive | `#1B1A19` | `#F2A099` | 8.49:1 | AAA |
| D success-fg / success | `#10251A` | `#8FCBA3` | 8.64:1 | AAA |
| D warning-fg / warning | `#2A1C00` | `#E8BE6A` | 9.49:1 | AAA |
| D info-fg / info | `#0F1E2E` | `#9CC1E8` | 9.00:1 | AAA |
| D input border / background (UI) | `#7D736A` | `#1B1A19` | 3.75:1 | UI ≥3 ✓ |
| C primary-fg / primary | `#FFFFFF` | `#2F7466` | 5.51:1 | AA |
| C sun-fg / sun | `#3A2A00` | `#F4C25B` | 8.41:1 | AAA |
| C coral-fg / coral | `#4A1E10` | `#F2A285` | 6.93:1 | AA |
| C sky-fg / sky | `#0F2C44` | `#BFDDF2` | 10.14:1 | AAA |
| C foreground / background | `#2E2A27` | `#FFFBF5` | 13.79:1 | AAA |

Rule: never put white text on sun/coral/sky; never use `--border` as the only outline of an input, checkbox or card that is interactive.

---

## 4. Typography (PROVISIONAL — open-source Google Fonts)

| Role | Family | Weights | Rationale |
|---|---|---|---|
| UI / body / tables | **Inter** | 400, 500, 600 | High x-height, screen-optimized, full Spanish diacritics, tabular figures (`font-variant-numeric: tabular-nums`) for dates and tables. |
| Headings (adult, marketing) | **Fraunces** (opsz, SOFT≈50, WONK 0) | 500, 600 | Warm humanist serif → care, not corporate. Used only ≥20px. |
| Headings (child mode) | **Nunito** | 600, 700, 800 | Rounded, friendly, very legible for early readers. |
| Monospace (IDs, codes) | system `ui-monospace` | — | No extra download. |

Load via `next/font/google` (or self-host) with `display: swap`, subsets `latin`, `latin-ext`.

### 4.1 Scale (rem, base 16px; ratio ≈1.2)

| Token | Size / line-height | Use |
|---|---|---|
| `text-xs` | 12 / 16 | Badges, meta (never body) |
| `text-sm` | 14 / 20 | Table cells, helper text |
| `text-base` | 16 / 24 | Body, inputs (min. on mobile to avoid zoom) |
| `text-note` | 17 / 28 | Session note editor, long reading |
| `text-lg` | 18 / 28 | Lead text, portal body |
| `text-xl` | 20 / 28 | Card titles |
| `text-2xl` | 24 / 32 | Section titles |
| `text-3xl` | 30 / 36 | Page titles |
| `text-4xl` | 36 / 44 | Portal hero / login |

Child mode shifts body to `text-lg` and headings one step up. Max line length 72ch (notes), 60ch (portal).

---

## 5. Spacing, radius, elevation, motion, breakpoints

**Spacing:** Tailwind 4px base. Preferred steps: 1 (4), 2 (8), 3 (12), 4 (16), 6 (24), 8 (32), 12 (48), 16 (64).
Page gutters: 16px mobile, 24px tablet, 32px desktop. Card padding: 16 (compact) / 24 (default). Child mode: +1 step.

**Radius:** `--radius` 12px adult (lg 12, md 10, sm 8; pills `9999px` for badges). Child 20px.

**Elevation (light):**
| Token | Value | Use |
|---|---|---|
| `shadow-0` | none + 1px `--border` | Default cards |
| `shadow-1` | `0 1px 2px rgb(46 42 39 / .06), 0 1px 3px rgb(46 42 39 / .08)` | Hover cards, sticky headers |
| `shadow-2` | `0 4px 12px rgb(46 42 39 / .10)` | Popovers, dropdowns |
| `shadow-3` | `0 12px 32px rgb(46 42 39 / .14)` | Dialogs, sheets |
Dark mode: replace shadows with lighter surfaces (`--card`, then `#2E2B28`).

**Motion:**
| Token | Duration | Easing | Use |
|---|---|---|---|
| `motion-fast` | 120ms | `cubic-bezier(.2,0,0,1)` | Hover, press |
| `motion-base` | 200ms | same | Popovers, toasts |
| `motion-slow` | 320ms | `cubic-bezier(.2,0,0,1)` | Dialogs, sheets, child celebrations |
`@media (prefers-reduced-motion: reduce)` → all transitions ≤ 1ms opacity only, no transforms, no confetti, no autoplay. No parallax, no looping animation anywhere.

**Breakpoints (Tailwind defaults):** `sm` 640, `md` 768, `lg` 1024, `xl` 1280, `2xl` 1536. Dashboard sidebar appears at `lg`; below it, top bar + sheet menu. Portal bottom nav below `md`.

---

## 6. Components (shadcn/ui based)

### 6.1 Buttons
| Variant | Style | Use |
|---|---|---|
| `default` | `bg-primary text-primary-foreground` | One main action per view |
| `secondary` | `bg-secondary text-secondary-foreground` | Alternative actions |
| `outline` | `border-input bg-background` | Tertiary, toolbars |
| `ghost` | transparent, `hover:bg-accent` | Icon buttons, nav |
| `destructive` | `bg-destructive text-destructive-foreground` | Delete — always with confirm dialog |
| `link` | `text-primary underline-offset-4` | Inline |
Sizes: sm 32px, default 40px, lg 48px (portal), child 56px. Min. touch target 44×44 (WCAG 2.5.8 requires 24; we exceed). States: hover (−6% lightness), active, focus-visible (2px `--ring` + 2px offset), disabled (50% opacity + `aria-disabled`), loading (spinner + label kept, width locked).

### 6.2 Inputs & forms
- Height 40px (48 portal); border `--input`; radius md; label always visible above (no placeholder-only labels).
- Helper text `text-sm text-muted-foreground`; error text `text-destructive` + icon + `aria-describedby`; error border `--destructive`.
- Required: "(obligatorio)" text, not just an asterisk.
- Group long forms into cards with section titles; sticky save bar on long clinical forms.
- Autosave indicator for drafts: "Guardado hace 5 s" (muted, `aria-live="polite"`).

### 6.3 Cards
`bg-card`, 1px `--border`, radius lg, padding 24, shadow-0; clickable cards get `shadow-1` on hover and a visible focus ring. Header: title (`text-xl` heading font) + optional action at right.

### 6.4 Navigation
- **Dashboard sidebar (≥lg):** 264px, collapsible to 72px icons; `bg-card`; items 40px, icon 20 + label; active = `bg-accent text-accent-foreground` + 3px left bar `--primary`. Sections: Inicio, Pacientes, Agenda/Sesiones, Actividades (Biblioteca, Constructor), Configuración. Tenant logo top, user menu bottom.
- **Dashboard top bar (<lg):** logo, search, menu button opening a Sheet with the same items.
- **Portal nav (≥md):** simple top bar: logo, Inicio, Mis actividades, Mis citas, Perfil.
- **Mobile bottom nav (<md, portal):** 4 items max, 64px tall, icon 24 + label 12px (always labeled), safe-area padding; active = primary color icon + label weight 600.

### 6.5 Tables
`text-sm`, header `bg-muted text-muted-foreground` 600 weight, row 48px, zebra off by default (hover `bg-accent/50`). Sticky header; tabular numerals; row actions in a kebab menu. Below `md`, tables collapse to stacked cards (name, key meta, status badge). Sorting announced via `aria-sort`.

### 6.6 Dialogs
Max width 480 (confirm) / 640 (form); radius lg; shadow-3; overlay `rgb(27 26 25 / .5)`. Focus trapped, Esc closes (except unsaved clinical edits → confirm). Destructive confirms name the object: "¿Eliminar la actividad 'Respiración 4-7-8'?". On mobile, forms open as bottom Sheet.

### 6.7 Toasts (sonner)
Bottom-right desktop, top-center mobile; 5s auto-dismiss (errors persist until closed); `role="status"` / `alert` for errors. Never include clinical content or patient names in toasts.

### 6.8 Empty / loading / error states
- **Empty:** small illustration or icon (muted), title, one sentence, one primary action. e.g. "Aún no hay pacientes · Agrega tu primer paciente".
- **Loading:** skeletons matching final layout (`bg-muted` pulse; static under reduced motion). Spinners only inside buttons. Show content after 300ms threshold to avoid flicker.
- **Error:** inline banner with icon, plain explanation, retry action; reassure about data ("Tus datos están a salvo"). Full-page error only for route failure, with link home.
- **Offline (portal):** persistent subtle banner `--warning`.

### 6.9 Badges
Pill, `text-xs` 500, 20px tall, icon optional. Variants: neutral (`secondary`), primary, success, warning, destructive, info, outline. Session status mapping: Borrador → warning; Finalizada → success + lock icon; Adenda → info. Patient status: Activo → success, En pausa → neutral, Alta → outline.

---

## 7. Child mode vs adult mode

| Aspect | Adult (default) | Child |
|---|---|---|
| Heading font | Fraunces | Nunito 700–800 |
| Body | 16px | 18px |
| Radius | 12px | 20px |
| Touch targets | ≥44px | ≥56px |
| Color | primary + neutrals | + sun / coral / sky accents (dark text only) |
| Icons | outline 20px | outline 28px in soft color circles |
| Feedback | text + check icon | friendly illustration, star/sticker, short celebratory message (static if reduced motion) |
| Copy | "Actividad completada" | "¡Lo lograste! 🌟" (emoji optional, with text) |
| Navigation | 4–5 items | 3 items max, big icons + labels |
| Density | comfortable | spacious, one task per screen |
Child mode is **only in the patient portal/player**; the professional always sees adult mode. Same tokens → same brand.

---

## 8. Screen layout guidance

**Login** — Centered card (max 400px) on `--background` with a soft organic shape in `--secondary` at one corner; tenant logo above; email + password, "¿Olvidaste tu contraseña?", primary "Iniciar sesión" full width. Language toggle (ES/EN) top-right. No stock hospital imagery. Errors inline, generic ("Correo o contraseña incorrectos").

**Dashboard home** — Greeting ("Buenos días, Daniela") + date. Row 1: today's sessions (timeline card), pending drafts to finalize (warning badge count). Row 2: recent activity completions by patients; quick actions (Nueva sesión, Nuevo paciente, Crear actividad). 12-col grid; 8/4 split at `xl`; single column on mobile. Avoid KPI-heavy "analytics" look.

**Patient list** — Page title + primary "Nuevo paciente"; search, filters (estado, modalidad, adulto/niño) as chips; table: nombre, edad/grupo, próxima sesión, última sesión, estado badge, acciones. Mobile: cards. Empty state with CTA. Child patients show a small "Niño/a" neutral badge (not colored loudly).

**Patient profile** — Header card: name, age, group badge, contact (masked until clicked), portal access status. Tabs: Resumen · Historia clínica · Sesiones · Actividades · Documentos. Right rail (xl): upcoming session, assigned activities progress. Sensitive data areas show a small lock + "Visible solo para ti".

**Clinical record** — Structured sections in cards (motivo de consulta, antecedentes, evaluación, plan); read mode default with "Editar" per section; change history accessible. Typography `text-note`, 72ch measure.

**Session note editor** — Two states:
- *Draft:* full editor (rich text, templates), autosave indicator, badge "Borrador" (warning), sticky footer: "Guardar borrador" (secondary) + "Finalizar nota" (primary). Finalize opens confirm dialog explaining it will be locked.
- *Finalized/locked:* read-only, badge "Finalizada" + lock icon, timestamp and author; editor chrome removed; muted background stripe at top: "Nota finalizada el 08/11/2026 · No editable". Action "Agregar adenda" opens an addendum editor beneath; each addendum is a separate card with its own timestamp/author and "Adenda" info badge, chronologically appended, never merged into the original.

**Activity builder** — Three-pane on `xl`: left block palette (texto, pregunta, escala, respiración guiada, dibujo, checklist), center canvas (ordered blocks, drag handle + keyboard reorder buttons), right properties panel. Top: title, audience toggle (Adulto / Niño — previews child mode), "Vista previa", "Guardar". Mobile/tablet: single column with blocks as an accordion; builder primarily a desktop task.

**Activity library** — Grid of cards (title, audience badge, duration, tags) with filters (audiencia, tipo, etiquetas) and search; actions: Asignar, Duplicar, Editar. Toggle grid/list. Empty: "Crea tu primera actividad".

**Patient activity player** — Full-focus layout, no sidebar; progress indicator ("Paso 2 de 5") at top; one block per screen; large primary "Siguiente"; "Guardar y salir" always available. Adult: calm, text-forward. Child: child-mode tokens, illustrations, bigger controls, celebration at the end (static when reduced motion). Responses autosave.

**Portal home** — Warm greeting; next appointment card; "Tus actividades" (pending first, with progress); a short message from the professional (optional); bottom nav on mobile. No clinical notes are ever shown to patients.

**Organization branding settings** — Two-column: form left (logo upload with preview on light & dark, primary/secondary/accent color pickers with HEX input, font selects from allow-list, child mode toggle), **live preview** right (button, card, nav, badge, portal header). Contrast guard shows per-color status: "✓ Contraste 6.1:1 (AA)" or "✕ 2.8:1 — No cumple AA. Sugerencia: #3D6B5E" with "Usar sugerencia". Save disabled while any color fails. "Restablecer valores" secondary.

---

## 9. Accessibility checklist (all components)

- WCAG 2.2 AA: text 4.5:1, UI 3:1, focus visible (2.4.7/2.4.11), target size (2.5.8), no info by color only.
- Keyboard: full operation, logical order, skip link "Saltar al contenido".
- Screen readers: landmarks, labelled icons, `aria-live` for autosave/toasts, `lang="es"` / `lang="en"` set.
- Respect `prefers-reduced-motion`, `prefers-color-scheme`; zoom to 200% without loss; reflow at 320px.

---

## 10. Pending decisions

1. Replace all PROVISIONAL colors/fonts once Daniela's assets arrive (BRAND_GUIDELINES §14); re-run §3.4.
2. Dark mode in adult portal at launch (yes/no).
3. Tenant font override: allow-list size (proposal: 8 Google Fonts).
4. Child-mode trigger: age-based, professional toggle, or both.
5. Exact shadcn version (HSL channels vs OKLCH variables) — frontend to confirm; token names stay the same.
