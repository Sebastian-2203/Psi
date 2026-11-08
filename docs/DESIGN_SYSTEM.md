# Design System — Psi (Psicóloga Daniela Ortega, white-label ready)

> Status: **Phase 0 — v2, documentation only.** Replaces the v1 provisional sage palette. Brand inputs:
> logo file (**OBSERVED**, low-res) and the client's Instagram analysis (**REPORTED (client analysis)**; HEX and
> fonts are approximations/recommendations). Derived shades, semantic mappings, scales and component specs are
> **PROVISIONAL** designer proposals. See [`BRAND_GUIDELINES.md`](./BRAND_GUIDELINES.md) §1 for evidence.
> Stack target: Tailwind CSS + shadcn/ui + Lucide. **No code files exist or are created in Phase 0**; snippets
> below are specifications for the frontend agent in Phase 1. Last updated: 2026-11-08.

---

## 1. Principles

- **Semantic over literal.** Components consume `--primary`, never a HEX. No hard-coded HEX in components.
- **Two colour layers:** brand primitives (raw palette) → semantic tokens (roles). Component tokens only where
  shadcn requires them (`--sidebar-*`, `--chart-*`).
- **Brand colour ≠ functional colour.** Client HEX values are kept as brand references; text and controls use
  derived accessible shades (§3.2).
- **Three contexts** on one token set: `portal-adult`, `portal-child`, `professional` (+ a neutral
  `platform` context for SyV admin, pending SyV assets).
- **Accessible by construction:** every pair used for text/UI has a computed ratio (§3.3).

---

## 2. Token architecture

```
brand primitives   --cream-100, --coral-500, --coral-700 (logo ink), --pink-300 ...  (never used in components)
semantic tokens    --background, --foreground, --primary, --primary-foreground ...
component tokens   --sidebar-*, --chart-*  (only where shadcn needs them)
context selectors  [data-context="portal-adult" | "portal-child" | "professional" | "platform"]
tenant overrides   [data-tenant="<slug>"]  (generated server-side, §7)
```

### 2.1 Brand primitives

| Ramp | Step | HEX | Source / label |
|---|---|---|---|
| cream | 50 | `#FFFCEE` | Tint of client cream — PROVISIONAL |
| cream | **100** | **`#FFF9D9`** | **Client "Cream Yellow" — REPORTED** |
| cream | 200 | `#F7EFC9` | Hover/selected on cream — PROVISIONAL |
| coral | 50 | `#FDEDEB` | Tint — PROVISIONAL |
| coral | **500** | **`#D94A43`** | **Client "Coral Red" — REPORTED** (brand reference, decorative/large) |
| coral | 600 | `#C0403A` | Derived accessible — PROVISIONAL |
| coral | **700** | **`#A73C37`** | **Logo ink — OBSERVED (approx.)**; functional primary |
| coral | 800 | `#8A302C` | Derived (hover/pressed) — PROVISIONAL |
| coral | 900 | `#5E211E` | Derived (text on coral tints) — PROVISIONAL |
| pink | 100 | `#FCE7E4` | Tint — PROVISIONAL |
| pink | **300** | **`#F5B9B4`** | **Client "Pastel Pink" — REPORTED** |
| peach | 100 | `#FDF0D5` | Tint — PROVISIONAL |
| peach | **300** | **`#F8D9A7`** | **Client "Peach" — REPORTED** |
| bluegray | 100 | `#E8EDF3` | Tint — PROVISIONAL |
| bluegray | **300** | **`#AAB7C7`** | **Client "Blue Gray" — REPORTED** |
| bluegray | 700 | `#46586E` | Derived (info text/icons) — PROVISIONAL |
| bluegray | 800 | `#36465A` | Derived (text on info tint) — PROVISIONAL |
| neutral | 0 | `#FFFFFF` | White |
| neutral | 50 | `#FAF8F3` | Warm near-white (professional canvas) — PROVISIONAL |
| neutral | 100 | `#F7F3E6` | Muted surface — PROVISIONAL |
| neutral | 200 | `#E9E0CC` | Decorative border — PROVISIONAL |
| neutral | 500 | `#8A7D72` | Input border (UI ≥3:1) — PROVISIONAL |
| neutral | 600 | `#6A5F57` | Muted text — PROVISIONAL |
| **charcoal** | 900 | **`#292522`** | **Client "Charcoal" — REPORTED** |
| crimson | 50 / 700 / 800 | `#FCE8EC` / `#9B1C3A` / `#7A1630` | Error family, deliberately off-brand hue — PROVISIONAL |
| green | 50 / 700 / 800 | `#E5F2E8` / `#2F6B45` / `#24573A` | Success — PROVISIONAL |
| amber | 50 / 600 / 800 | `#FDEBC8` / `#B7791F` / `#7A4A00` | Warning — PROVISIONAL |

### 2.2 Semantic tokens per context (PROVISIONAL)

| Token | `portal-adult` | `portal-child` | `professional` |
|---|---|---|---|
| `--background` | cream-100 `#FFF9D9` | cream-100 `#FFF9D9` | neutral-50 `#FAF8F3` |
| `--foreground` | charcoal `#292522` | charcoal | charcoal |
| `--card` / `--popover` | white | white | white |
| `--card-foreground` | charcoal | charcoal | charcoal |
| `--primary` | coral-700 `#A73C37` | coral-600 `#C0403A` | coral-700 `#A73C37` |
| `--primary-hover` | coral-800 `#8A302C` | coral-700 `#A73C37` | coral-800 `#8A302C` |
| `--primary-foreground` | white | white | white |
| `--secondary` / `-foreground` | pink-100 `#FCE7E4` / charcoal | peach-100 `#FDF0D5` / charcoal | neutral-100 `#F7F3E6` / charcoal |
| `--accent` / `-foreground` (hover, selected) | cream-200 `#F7EFC9` / charcoal | pink-100 `#FCE7E4` / charcoal | cream-50 `#FFFCEE` / charcoal |
| `--muted` / `-foreground` | neutral-100 / neutral-600 | neutral-100 / neutral-600 | neutral-100 / neutral-600 |
| `--border` (decorative) | neutral-200 `#E9E0CC` | neutral-200 | neutral-200 |
| `--input` (control outline) | neutral-500 `#8A7D72` | neutral-500 | neutral-500 |
| `--ring` | coral-700 | coral-700 | coral-700 |
| `--brand` (decorative line art, large display only) | coral-500 `#D94A43` | coral-500 | coral-500 (rare) |
| `--sidebar` | — | — | cream-50 `#FFFCEE` |
| `--destructive` / `-foreground` | crimson-700 `#9B1C3A` / white | same | same |
| `--destructive-surface` | crimson-50 `#FCE8EC` (text crimson-700) | same | same |
| `--success` / `-foreground` | green-700 / white | same | same |
| `--success-surface` | green-50 (text green-800) | same | same |
| `--warning-surface` / `-foreground` / `-border` | amber-50 / amber-800 / amber-600 | same | same |
| `--info` / `-foreground` | bluegray-700 `#46586E` / white | same | same |
| `--info-surface` | bluegray-100 (text bluegray-800) | same | same |
| `--fun-pink` / `--fun-peach` / `--fun-sky` | — | pink-300 / peach-300 / bluegray-300 (charcoal text only) | — |
| `--radius` | 0.75rem (12px) | 1.125rem (18px) | 0.625rem (10px) |

Tenants override only `--primary` family, `--secondary`, `--accent`, `--brand`, logo and (allow-listed) fonts — §7.
Status colours, `--foreground`, `--background` contrast relationships and `--input` are platform-controlled.

### 2.3 Tokens stylesheet — Phase 1 specification (do not create now)

One file (e.g. `app/styles/tokens.css`, path to be confirmed by architect/frontend) contains **all** colour
values. Shape:

```css
:root {                                   /* primitives */
  --cream-100:#FFF9D9; --coral-500:#D94A43; --coral-700:#A73C37; --charcoal-900:#292522; /* … all of §2.1 */
}
:root, [data-context="portal-adult"] {    /* semantic — default */
  --background:var(--cream-100); --foreground:var(--charcoal-900);
  --primary:var(--coral-700); --primary-foreground:#FFFFFF; --ring:var(--coral-700); /* … §2.2 */
}
[data-context="portal-child"]  { --primary:var(--coral-600); --radius:1.125rem; /* … */ }
[data-context="professional"]  { --background:var(--neutral-50); --radius:0.625rem; /* … */ }
```

- Value format follows the shadcn version chosen in Phase 1 (HSL channels or OKLCH); names stay the same.
- Tailwind theme maps `colors.primary.DEFAULT = 'var(--primary)'`, `primary.foreground`, plus `brand`,
  `success`, `warning`, `info`, `destructive-surface`, `fun-*`; `borderRadius.lg = var(--radius)`,
  `md = calc(var(--radius) - 2px)`, `sm = calc(var(--radius) - 4px)`.
- Lint rule (Phase 1 proposal): forbid HEX/rgb literals and Tailwind arbitrary colours (`bg-[#…]`) in
  `components/` and `app/` outside the tokens file.

### 2.4 `platform` context (SyV Solutions — pending)
SyV identity is undefined. Platform-admin uses a neutral context: white background, charcoal text, neutral
greys, a neutral dark primary (e.g. charcoal `#292522` buttons, white text 15.20:1) and **no** cream, coral,
pink or peach. Replace when SyV assets arrive. "Powered by SyV" footer: `text-xs`, muted, no logo colour.

---

## 3. Colour

### 3.1 Usage weighting (PROVISIONAL; see BRAND_GUIDELINES §5.4)
Portal ≈ 60% cream/white · 30% charcoal type + soft tints · 10% red. Professional ≈ white work areas, cream ≤10%,
red ≤5%. Pink and peach are always minor; blue gray balances warmth (info, secondary metadata).

### 3.2 Derived accessible shades — why
Client coral `#D94A43` fails 4.5:1 with white text (4.19) and as text on cream (3.95). Rather than change the
brand colour, functional roles use **`coral-700` = logo ink `#A73C37`** (6.28 / 5.92), tying UI to the logo.
`coral-600 #C0403A` is a brighter step for child mode (5.20 / 4.91). `coral-500` stays for line art, large
display headings (≥24px) and decorative highlights.

### 3.3 WCAG 2.x contrast — computed (python, relative-luminance formula, 2026-11-08)

Legend: **T** = normal text ≥4.5 · **LT** = large text ≥3 (≥24px, or ≥18.66px bold) · **UI** = non-text
component/graphic ≥3 · **Dec** = decorative only · ✓ allowed · ✕ not allowed.

**Client colours (as supplied)**

| Foreground | Background | Ratio | T | LT | UI | Verdict |
|---|---|---|---|---|---|---|
| charcoal `#292522` | cream `#FFF9D9` | 14.33 | ✓ | ✓ | ✓ | Body text on canvas |
| charcoal | white | 15.20 | ✓ | ✓ | ✓ | Body text on cards |
| white | coral `#D94A43` | **4.19** | ✕ | ✓ | ✓ | No normal-size button labels on brand coral |
| coral `#D94A43` | white | **4.19** | ✕ | ✓ | ✓ | Large display / icons / line art only |
| coral `#D94A43` | cream | **3.95** | ✕ | ✓ | ✓ | Large display / line art only |
| coral `#D94A43` | pink `#F5B9B4` | 2.49 | ✕ | ✕ | ✕ | Dec |
| coral `#D94A43` | peach `#F8D9A7` | 3.09 | ✕ | ✓ | ✓ | Line art on peach only |
| charcoal | coral `#D94A43` | 3.63 | ✕ | ✓ | ✓ | Avoid (muddy); large only |
| charcoal | pink `#F5B9B4` | 9.03 | ✓ | ✓ | ✓ | Pink surfaces with charcoal text |
| charcoal | peach `#F8D9A7` | 11.20 | ✓ | ✓ | ✓ | Peach surfaces with charcoal text |
| charcoal | blue gray `#AAB7C7` | 7.46 | ✓ | ✓ | ✓ | Blue-gray surfaces with charcoal text |
| blue gray `#AAB7C7` | white | 2.04 | ✕ | ✕ | ✕ | Dec — never text or control boundary |
| blue gray | cream | 1.92 | ✕ | ✕ | ✕ | Dec |
| pink `#F5B9B4` | white / cream | 1.68 / 1.59 | ✕ | ✕ | ✕ | Dec (surfaces only) |
| peach `#F8D9A7` | white / cream | 1.36 / 1.28 | ✕ | ✕ | ✕ | Dec (surfaces only) |
| cream | white | 1.06 | — | — | ✕ | Cream vs white cards: needs border/shadow to separate |

**Logo ink and derived shades**

| Foreground | Background | Ratio | T | LT | UI | Verdict |
|---|---|---|---|---|---|---|
| white | coral-700 `#A73C37` (logo ink) | 6.28 | ✓ | ✓ | ✓ | **Primary button** |
| coral-700 | white | 6.28 | ✓ | ✓ | ✓ | Links, ring on cards |
| coral-700 | cream | 5.92 | ✓ | ✓ | ✓ | Links, ring on canvas |
| coral-700 | neutral-50 `#FAF8F3` | 5.92 | ✓ | ✓ | ✓ | Professional links/ring |
| coral-700 | pink-100 `#FCE7E4` | 5.29 | ✓ | ✓ | ✓ | Links on secondary |
| coral-700 | cream-200 `#F7EFC9` | 5.43 | ✓ | ✓ | ✓ | Active nav text |
| coral-700 | coral-50 `#FDEDEB` | 5.53 | ✓ | ✓ | ✓ | Selected chip |
| coral-700 | pink-300 `#F5B9B4` | 3.73 | ✕ | ✓ | ✓ | Ring/icon on pink only |
| coral-700 | peach-300 `#F8D9A7` | 4.63 | ✓ | ✓ | ✓ | OK |
| coral-700 | charcoal (as adjacent body text) | 2.42 | — | — | — | <3:1 → **links must be underlined** (WCAG 1.4.1) |
| ink samples `#AE312B` / `#9F3C3C` | white | 6.41 / 6.59 | ✓ | ✓ | ✓ | Any sample would pass |
| logo edge `#DC9C9A` | white | 2.27 | ✕ | ✕ | ✕ | Anti-aliasing only |
| white | coral-600 `#C0403A` | 5.20 | ✓ | ✓ | ✓ | Child primary button |
| coral-600 | cream | 4.91 | ✓ | ✓ | ✓ | Child links |
| coral-600 | peach-100 `#FDF0D5` | 4.61 | ✓ | ✓ | ✓ | Child secondary |
| coral-600 | pink-100 | **4.38** | ✕ | ✓ | ✓ | Use coral-800 text on pink tints |
| white | coral-800 `#8A302C` | 8.27 | ✓ | ✓ | ✓ | Hover/pressed |
| coral-800 | pink-100 | 6.96 | ✓ | ✓ | ✓ | Text on pink tint |
| coral-900 `#5E211E` | coral-50 | 10.80 | ✓ | ✓ | ✓ | Text on coral tint |

**Neutrals and status**

| Foreground | Background | Ratio | T | LT | UI | Verdict |
|---|---|---|---|---|---|---|
| charcoal | cream-50 / neutral-50 / neutral-100 | 14.77 / 14.32 / 13.69 | ✓ | ✓ | ✓ | |
| charcoal | pink-100 / peach-100 / bluegray-100 / cream-200 | 12.80 / 13.46 / 12.91 / 13.13 | ✓ | ✓ | ✓ | |
| neutral-600 `#6A5F57` | white / cream / neutral-50 | 6.20 / 5.85 / 5.84 | ✓ | ✓ | ✓ | Muted text |
| neutral-600 | neutral-100 / cream-200 / pink-100 / peach-100 / bluegray-100 | 5.58 / 5.36 / 5.22 / 5.49 / 5.27 | ✓ | ✓ | ✓ | Muted text on tints |
| neutral-500 `#8A7D72` | white / cream / neutral-50 | 3.99 / 3.77 / 3.76 | ✕ | ✓ | ✓ | **Input borders only** |
| neutral-200 `#E9E0CC` | white / cream | 1.31 / 1.24 | ✕ | ✕ | ✕ | Dec dividers; never sole control boundary |
| white | crimson-700 `#9B1C3A` | 8.01 | ✓ | ✓ | ✓ | Destructive confirm button |
| crimson-700 | white / cream / crimson-50 | 8.01 / 7.56 / 6.83 | ✓ | ✓ | ✓ | Error text |
| crimson-800 | crimson-50 | 9.01 | ✓ | ✓ | ✓ | Error banner text |
| white | green-700 `#2F6B45` | 6.34 | ✓ | ✓ | ✓ | |
| green-700 | cream / green-50 | 5.98 / 5.50 | ✓ | ✓ | ✓ | |
| green-800 | green-50 | 7.28 | ✓ | ✓ | ✓ | Success banner |
| amber-800 `#7A4A00` | amber-50 / cream | 6.37 / 7.06 | ✓ | ✓ | ✓ | Warning text |
| amber-600 `#B7791F` | white / cream / amber-50 | 3.64 / 3.43 / 3.10 | ✕ | ✓ | ✓ | Warning border/icon only |
| white | bluegray-700 `#46586E` | 7.29 | ✓ | ✓ | ✓ | Info badge solid |
| bluegray-700 | white / cream / bluegray-100 | 7.29 / 6.87 / 6.19 | ✓ | ✓ | ✓ | Info text/icons |
| bluegray-800 | bluegray-100 | 8.18 | ✓ | ✓ | ✓ | Info banner |
| crimson-700 vs coral-700 (adjacent) | — | 1.28 | — | — | — | Luminance nearly equal → **hue + non-colour cues required** (§3.5) |

### 3.4 Usage summary
- **Text allowed:** charcoal anywhere listed; neutral-600; coral-700/800/900; coral-600 except on pink tints;
  status 700/800 shades.
- **Large text / non-text UI only:** coral-500 `#D94A43`, neutral-500, amber-600.
- **Decorative / surface only:** cream, pink-300, peach-300, bluegray-300, all *-50/100 tints, neutral-200.

### 3.5 Error / destructive treatment (must not read as brand emphasis)
Because the brand's own colour is red, errors use a **crimson-wine hue (`#9B1C3A`, bluer than the brick logo red)**
**and never rely on colour**:
1. Always an icon (`CircleAlert` for errors, `Trash2` for delete) + explicit text ("Error:", "Eliminar paciente").
2. Error messages sit in a tinted container (`--destructive-surface`) with a 4px left border, not bare red text.
3. Destructive buttons are **outline style** (white bg, crimson border + text + icon) in normal views; the only
   **filled** destructive button is inside the confirmation dialog, where no primary-filled button competes.
4. Field errors: crimson border 2px (vs 1px neutral) + icon + message linked via `aria-describedby`.

### 3.6 Dark mode stance
- **Deferred for all contexts at launch (recommendation).** Portal: the brand is defined by cream warmth;
  a dark portal would have no validated brand reference, child-mode illustrations are tuned for light, and the
  audience (patients, families) gains little. Professional: candidate for post-MVP (long sessions); the token
  architecture allows a `[data-theme="dark"]` layer later. No dark values are specified now to avoid
  unvalidated colours (v1 dark values are withdrawn).
- Respect OS high-contrast/forced-colours mode (`@media (forced-colors: active)`): borders and focus visible.

---

## 4. Typography

### 4.1 Families (REPORTED (client analysis) — Google Fonts, OFL)

| Token | Family | Weights | Use |
|---|---|---|---|
| `--font-display` | Playfair Display | 400, 500, 600, 700 | H1, H2, display, editorial statements |
| `--font-hand` | Caveat | 400, 500, 600 | Decorative short phrases only (BRAND §6.3) |
| `--font-sans` | Nunito Sans | 400, 500, 600, 700 | Everything functional |

Fallback stacks: display `Georgia, "Times New Roman", serif`; hand `"Comic Sans MS", cursive` is **not**
used — fallback is `var(--font-sans)` so a font failure degrades to plain text; sans `system-ui, -apple-system,
"Segoe UI", Roboto, sans-serif`. Monospace (IDs): `ui-monospace`.

### 4.2 Fluid scale (PROVISIONAL; base 16px; clamp for 360→1280px viewports)

| Token | Size | Line-height | Font / weight | Use |
|---|---|---|---|---|
| `display` | `clamp(2.25rem, 1.8rem + 2vw, 3.5rem)` | 1.1 | Playfair 600 | Portal hero, login, marketing |
| `h1` | `clamp(1.875rem, 1.6rem + 1.2vw, 2.5rem)` | 1.15 | Playfair 600 | Page title |
| `h2` | `clamp(1.5rem, 1.35rem + 0.7vw, 1.875rem)` | 1.2 | Playfair 500 (600 for emphasis) | Section title |
| `h3` | `clamp(1.125rem, 1.05rem + 0.35vw, 1.25rem)` | 1.35 | Nunito Sans 700 | Card titles, sub-sections |
| `h4` | `1rem` | 1.4 | Nunito Sans 700 | Group labels |
| `body-lg` | `1.125rem` | 1.6 | Nunito Sans 400 | Portal body, lead text |
| `body` | `1rem` | 1.6 | Nunito Sans 400 | Default body, inputs (≥16px avoids iOS zoom) |
| `note` | `1.0625rem` | 1.7 | Nunito Sans 400 | Clinical record & session notes (72ch) |
| `sm` | `0.875rem` | 1.45 | Nunito Sans 400/500 | Table cells, helper text |
| `xs` | `0.75rem` | 1.35 | Nunito Sans 600 | Badges, meta (never body) |
| `label` | `0.875rem` | 1.4 | Nunito Sans 600 | Form labels |
| `button` | `0.9375rem` (lg/child `1rem`) | 1 | Nunito Sans 700 | Buttons |
| `hand` | `clamp(1.25rem, 1.1rem + 0.6vw, 1.75rem)` | 1.2 | Caveat 500 | Decorative accents (≥20px) |

Context adjustments:
- `professional`: `h1` fixed `1.75rem`, `h2` `1.375rem` (Playfair), tables `sm`; no `display`, no `hand`.
- `portal-adult`: body uses `body-lg` on reading screens; max measure 60ch.
- `portal-child`: body `body-lg`, h3 `1.375rem`; `hand` allowed for celebrations only.
- Playfair never below 24px; letter-spacing 0 (Playfair) / 0.01em for `xs` caps labels.
- Numerals in tables/dates: `font-variant-numeric: tabular-nums` — **verify Nunito Sans supports `tnum`** in
  Phase 1; if not, accept proportional digits (do not add a fourth family without designer approval).

### 4.3 Loading — Phase 1 guidance (no code now)
- Use `next/font/google` in the root layout for **Playfair Display, Caveat, Nunito Sans**, each with
  `display: 'swap'`, `subsets: ['latin', 'latin-ext']` (latin covers Spanish á é í ó ú ñ ü ¿ ¡; latin-ext covers
  other names), and `variable: '--font-display' | '--font-hand' | '--font-sans'`.
- Prefer the variable-font versions (all three are expected to be variable on Google Fonts — verify); if static,
  request only the weights in §4.1. Caveat may be loaded with `preload: false` (decorative, rarely above the fold).
- Apply the three variable classes on `<html>`; Tailwind `fontFamily.display = ['var(--font-display)', …fallbacks]`,
  `fontFamily.hand`, `fontFamily.sans` (default body).
- Self-hosting via next/font means no runtime request to Google (privacy-friendly).
- Tenant fonts (white-label): allow-list of Google Fonts loaded the same way; not arbitrary URLs.

---

## 5. Spacing, radius, elevation, motion, breakpoints

**Spacing:** Tailwind 4px base; steps 1, 2, 3, 4, 6, 8, 12, 16. Gutters 16 / 24 / 32px (mobile / tablet / desktop).
Card padding 24 (portal), 16–20 (professional). Child mode +1 step. Generous whitespace is a brand trait.

**Radius (rounded, not pills — REPORTED principle):** professional 10px; adult 12px; child 18px. Buttons use
`md` (not full pills); only badges/chips may be pill-shaped. Inputs `md`.

**Borders & elevation (soft surfaces, subtle borders; no heavy shadows):**
| Token | Value | Use |
|---|---|---|
| `shadow-0` | none + 1px `--border` | Default cards (white card on cream needs the border: 1.06:1) |
| `shadow-1` | `0 1px 2px rgb(41 37 34 / .06), 0 2px 6px rgb(41 37 34 / .05)` | Hover cards, sticky bars |
| `shadow-2` | `0 6px 16px rgb(41 37 34 / .08)` | Popovers, menus |
| `shadow-3` | `0 16px 32px rgb(41 37 34 / .12)` | Dialogs, sheets |
No glassmorphism, no blur backdrops, no gradients on UI surfaces.

**Motion:** `fast` 120ms, `base` 200ms, `slow` 320ms, easing `cubic-bezier(.2,0,0,1)`. Under
`prefers-reduced-motion: reduce`: opacity-only ≤1ms, no transforms, no confetti, no autoplay.

**Breakpoints:** Tailwind defaults (`sm` 640, `md` 768, `lg` 1024, `xl` 1280). Professional sidebar at `lg`;
portal bottom nav below `md`. Reflow at 320px; zoom 200%.

---

## 6. Components (shadcn/ui based — updated for v2 palette/fonts)

### 6.1 Buttons (Nunito Sans 700)
| Variant | Style | Use |
|---|---|---|
| `default` | `bg-primary text-primary-foreground`, hover `--primary-hover` | One main action per view |
| `secondary` | `bg-secondary text-secondary-foreground` + 1px `--border` | Alternatives |
| `outline` | `bg-card border-input text-foreground` | Tertiary, toolbars |
| `ghost` | transparent, hover `bg-accent` | Icon buttons, nav |
| `destructive` | **outline**: `bg-card border-destructive text-destructive` + `Trash2` icon | Delete (opens confirm) |
| `destructive-solid` | `bg-destructive text-destructive-foreground` + icon | Only inside confirm dialogs |
| `link` | `text-primary underline underline-offset-4` | Inline |
Never `bg-brand` (`#D94A43`) with normal-size text. Sizes: sm 32, default 40, lg 48 (portal), child 56px.
Targets ≥44×44. States: hover, active (coral-800/900), focus-visible (§6.3), disabled (opacity 50% +
`aria-disabled`; WCAG exempts disabled controls from contrast, but keep labels legible), loading (spinner + label,
width locked).

### 6.2 Links
coral-700 on cream/white/neutral (≥5.29:1), **always underlined in running text** (coral-700 vs charcoal 2.42:1
fails the 3:1 link-distinction rule). Nav and button-like links may drop the underline if positioned as nav.
Visited: same colour. Hover: coral-800 + thicker underline. On pink tints use coral-800.

### 6.3 Focus ring
`outline: 2px solid var(--ring)` (coral-700) + `outline-offset: 2px`. Contrast of ring vs cream 5.92, white 6.28,
neutral-50 5.92, pink-300 3.73, peach-300 4.63 — all ≥3:1. On photos/illustrations use a double ring (2px white
inner + 2px coral-700 outer). Never remove focus styles; `:focus-visible` only for pointer users.

### 6.4 Inputs & forms
Height 40 (48 portal, 56 child); bg white; 1px `--input` border (3.77–3.99:1); radius md; label above
(`label` token); helper `sm` muted; error per §3.5; required = "(obligatorio)" text. Caveat never in forms.
Sticky save bar on long clinical forms; autosave indicator `aria-live="polite"`.

### 6.5 Cards
`bg-card`, 1px `--border`, radius lg, `shadow-0`. Title `h3` (Nunito Sans 700); portal feature cards may use `h2`
Playfair. Secondary cards in portal may use `--secondary` (pink-100) or peach-100 — max one tinted card group per
view. Clickable cards: `shadow-1` on hover + focus ring.

### 6.6 Navigation
- **Professional sidebar (≥lg):** 264px (collapsible 72px), `bg-sidebar` (cream-50), items 40px, icon 20
  (stroke 1.75) + label `sm` 600; active = `bg-accent` + `text-primary` + 3px left bar coral-700. Practice logo
  top; user menu bottom; "Powered by SyV" in muted `xs` at the very bottom.
- **Professional top bar (<lg):** logo, search, menu → Sheet.
- **Portal top bar (≥md):** cream background, logo left, Nunito Sans 600 items; active = coral-700 text +
  2px underline bar.
- **Portal bottom nav (<md):** white bar with top border, 4 items max (child: 3), icon 24 + label 12px always
  visible; active = coral-700 icon + label 700.

### 6.7 Tables (professional)
White surface; header `bg-muted` + `text-muted-foreground` `xs` 600, sentence case; rows 48px, `sm`; hover
`bg-accent` (cream-50); selected row `coral-50` + 3px left bar coral-700; dividers `--border`. Sticky header,
`aria-sort`. Below `md`: stacked cards. No brand red in table body except links/actions.

### 6.8 Badges (pill allowed)
`xs` 600, 22px tall, icon optional, tinted surfaces with dark text (all ≥5.2:1):
neutral (neutral-100 / charcoal) · brand (coral-50 / coral-900) · success (green-50 / green-800) · warning
(amber-50 / amber-800 + amber-600 border) · error (crimson-50 / crimson-800) · info (bluegray-100 / bluegray-800).
Mapping: Borrador → warning + `PencilLine`; Finalizada → success + `Lock`; Adenda → info + `FilePlus`;
Activo → success; En pausa → neutral; Alta → neutral outline; Niño/a, Adolescente → neutral (not loud).

### 6.9 Dialogs, toasts
Dialogs: white, radius lg, `shadow-3`, overlay `rgb(41 37 34 / .45)`; title `h3`; destructive confirms name the
object and use `destructive-solid`. Toasts: white card + left status bar + icon; errors persist; no clinical
content or patient names.

### 6.10 States
- **Empty:** small coral line-art illustration (portal) or Lucide icon in a bluegray-100 circle (professional),
  title, one sentence, one primary action.
- **Loading:** skeletons `bg-muted` (static under reduced motion); spinners only in buttons; 300ms threshold.
- **Error:** §3.5 banner; "Tus datos están a salvo"; retry action.
- **Offline (portal):** warning banner (amber-50, icon, text).
- **Success:** green-50 banner with `CircleCheck` — no confetti in adult/professional.

### 6.11 Child-mode variations (`portal-child`)
| Aspect | Adult | Child |
|---|---|---|
| Primary | coral-700 | coral-600 (brighter, still 5.20:1) |
| Surfaces | cream + white, pink-100 sparingly | + peach-100, `--fun-*` tints for activity cards (charcoal text) |
| Radius | 12px | 18px (buttons still not full pills) |
| Targets | ≥44px | ≥56px |
| Icons | 20px outline | 28px outline in tinted circle |
| Illustration | sparse line art | line-art characters in activities, start/end screens |
| Caveat | none (optional single hero accent) | short celebrations, always duplicated in plain text for AT |
| Feedback | text + check | illustration + short message (static if reduced motion) |
| Navigation | 4–5 items | 3 items, big icons + labels |
Forms, navigation labels, consent and instructions remain Nunito Sans and plain — "not a children's game
everywhere". The professional always sees `professional`.

---

## 7. White-label override mapping (PROVISIONAL)

Source: `organization_branding` (fields owned by backend; designer requirement):
`logo_url`, `logo_mark_url`, `favicon_url`, `brand_color` (HEX, required), `secondary_color`, `accent_color`,
`display_font` / `body_font` (allow-list), `child_mode_enabled`.

**Pipeline (tenant brand colour → functional shades + contrast guard):**
1. Store the tenant's colour as `--brand` (decorative; used like coral-500).
2. Derive a ramp in OKLCH (same hue, adjusted L/C): 50, 100 (tints), 600, 700, 800.
3. **Pick `--primary`** = the lightest step `S` such that `contrast(white, S) ≥ 4.5` **and**
   `contrast(S, background_of_each_context) ≥ 4.5` (cream and neutral-50). If the brand colour itself passes,
   `--primary = --brand`. (Daniela: `#D94A43` fails → `#A73C37`.)
4. `--primary-hover` = next darker step; `--ring` = `--primary` (≥3:1 guaranteed by step 3).
5. If the tenant colour is too light for white text, try charcoal foreground (≥4.5); if neither works within the
   ramp, use the derived dark step and tell the admin.
6. Secondary/accent: used only as **tints** with charcoal text (must be ≥4.5; auto-lighten until true).
7. **Error distinction guard:** if tenant primary hue is within ±25° of crimson (≈350°) or the brand is red,
   keep §3.5 non-colour cues (they are always on) and show an info note in settings.
8. Tenants cannot override status colours, `--foreground`, `--input`, or the dark/light structure.
9. Emitted server-side as `<style>[data-tenant="slug"]{…}</style>` (no flash); never inline per component.

Settings UI shows both: "Color de marca #D94A43 (decorativo)" and "Color funcional #A73C37 · contraste 6.3:1 ✓".

---

## 8. Screen layout guidance (updated for v2)

**Login** — Cream canvas; white card (max 400px) with 1px border; practice logo (stacked) above; `h1` Playfair
"Bienvenida/o"; Nunito form; primary full-width button (coral-700). Optional single coral line-art tree at a
corner (≤10% of view). Language toggle top-right. "Powered by SyV" muted footer.

**Professional dashboard home** — neutral-50 canvas, white cards; greeting `h1` Playfair ("Buenos días, Daniela");
today's sessions, drafts to finalise (warning badge), recent activity completions, quick actions. No KPI-heavy look.

**Patient list / profile / clinical record / session notes** — White work areas; `note` typography 72ch;
locked notes: success badge + `Lock`, stripe `bg-muted` "Nota finalizada el 08/11/2026 · No editable";
addenda as separate cards with info badge. Private areas: `Lock` + "Visible solo para ti" (muted).

**Activity builder / library** — Professional context; audience toggle previews `portal-adult` / `portal-child`
tokens live.

**Patient activity player** — Full focus, no sidebar; progress "Paso 2 de 5"; one block per screen; large primary
"Siguiente"; "Guardar y salir" always visible. Child: child tokens, illustrations, Caveat celebration + text.

**Portal home** — Cream canvas, Playfair greeting, next appointment card (white), "Tus actividades" (pending first),
optional message from the professional on a pink-100 card. No clinical notes ever shown.

**Branding settings** — Form left (logo upload preview on cream/white, brand colour + derived functional colour
with contrast status, font allow-list, child-mode toggle), live preview right (button, link, card, nav, badge,
error banner). Save disabled while any guard fails.

**Platform admin (SyV)** — `platform` context (§2.4); no practice branding.

---

## 9. Accessibility checklist

- WCAG 2.2 AA: text 4.5, large text/UI 3, focus visible (2.4.7, 2.4.11), target size (2.5.8), no info by colour
  only (1.4.1 — underlined links, icon+text statuses), reflow 320px, zoom 200%.
- Keyboard: full operation, skip link "Saltar al contenido". Screen readers: landmarks, labelled icons,
  `aria-live` for autosave/toasts, `lang` set. Caveat text duplicated or marked decorative.
- Respect `prefers-reduced-motion`, `forced-colors`.
- Re-run §3.3 whenever a primitive changes (script: WCAG relative luminance; keep in Phase 1 tests as a token
  contrast unit test).

---

## 10. Pending decisions

**Decided by the client (2026-11-08):** coral-700 `#A73C37` approved as functional primary · displayed practice name
"Psicóloga Daniela Ortega" · **adolescents render with `portal-child`** (no third context; age-sensitive *copy*
and privacy explanations still differ, see PRD GRD-07).

Still open:
1. Exact brand HEX once the vector logo/templates arrive.
4. Dark mode deferral (§3.6).
5. Tenant font allow-list size (proposal: 8 Google Fonts).
6. shadcn version (HSL vs OKLCH variables) and tokens file path — frontend/architect in Phase 1.
7. Nunito Sans `tnum` support (verify).
8. SyV `platform` context colours when SyV identity exists.
