# Predixion AI — Design System · Developer Guide

> **Version 1.0** · Dark-first voice-AI design system
> Single source of truth for color, type, spacing, motion, components, and
> product layouts across all Predixion AI products.

---

## 1. Quick start

```html
<!doctype html>
<html data-pd-theme="dark">      <!-- DEFAULT IS DARK -->
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1"> <!-- required for responsive -->
    <script src="theme.js"></script>          <!-- optional: persistence + no-flash -->
    <link rel="stylesheet" href="styles.css">  <!-- the ONLY stylesheet you link -->
  </head>
  <body>
    <button class="pd-btn pd-btn--primary">Talk to Aria</button>
  </body>
</html>
```

That's it. `styles.css` `@import`s every token and pattern. Use the shipped
classes directly, or the React components in `components/`.

**Two ways to consume:**
1. **Plain HTML/CSS** — use the `pd-*` classes (framework-agnostic, zero JS except the optional theme helper and any interactive widget like the dropdown).
2. **React** — import the components in `components/` (`.jsx` + `.d.ts` types + `.prompt.md` usage).

---

## 2. Theming — dark is the default

- The theme is controlled by a single attribute: **`data-pd-theme="dark"`** (default) or **`"light"`** on a root element (usually `<html>`).
- All colors are CSS variables that flip under `[data-pd-theme="light"]`. You never hard-code hex in product code — use the semantic variables (`var(--text)`, `var(--surface)`, `var(--accent)`…).
- **`theme.js`** applies dark immediately, honors a stored `light` choice, and exposes `PredixionTheme.set/toggle/get`. Load it in `<head>` to avoid a flash of the wrong theme.
- If you don't use `theme.js`, just hard-set `data-pd-theme="dark"` on `<html>`.

```js
PredixionTheme.toggle();           // dark <-> light
PredixionTheme.set("light");
PredixionTheme.get();              // "dark"
```

The `ThemeToggle` component (sun/moon segmented control) is the standard UI for switching.

---

## 3. Foundations

### 3.1 Color
- **Neutrals:** warm near-black ramp (`#08080B` → white) for dark; near-white paper (`#FCFCFE`) + white surfaces for light.
- **Accents (6 agent families):** blue, emerald, violet, amber, rose, cyan — each has a **solid** (deep, for light surfaces) and **tint** (pastel, for dark surfaces) value. Assign one per agent.
- **Status:** success `#3ECF8E`, warning/stars `#F0B35B`, danger `#F43F5E`.
- **Semantic variables** (use these, not raw hex): `--bg --text --text-strong --text-heading --text-muted --text-label --accent --surface --panel --input-bg --border --border-input` … (full list in `tokens/colors.css`).

### 3.2 Typography
- **UI / body:** `--font-sans` → **Helvetica Neue**, Helvetica, Arial, system-ui, sans-serif.
- **Labels / metadata / timers:** `--font-mono` → **IBM Plex Mono** (loaded from Google Fonts). Always UPPERCASE + wide tracking for eyebrows, badges, statuses.
- **Scale (px):** 2xs 9.5 · xs 10.5 · sm 12.5 · md 13.5 · base 14 · lg 15 · xl 17 · 2xl 20 · 3xl 25 · 4xl 30.
- **Weights:** 400 / 500 / 600 (no 700+). **Headlines:** 600 + tight tracking (`-0.01em`). **Body:** 400, line-height 1.6.
- Full tokens in `tokens/typography.css`.

### 3.3 Spacing & sizing
- **4px base grid** (`--space-1`…`--space-28`).
- **Standard control heights:** sm 36 · md 42 · lg 48. **Min tap target: 44px.**
- **Icon sizes:** 13 / 15 / 18 / 24. **Orb sizes:** sm 108 · md 152 · lg 184.
- **Layout widths:** container 1040 · card 472 · two-column 912.

### 3.4 Radius
xs 7 · sm 9 · md 10 (buttons/inputs) · lg 14 · xl 18 (cards/modals) · 2xl 20 · pill 999 (chips/toggles/dots) · circle (orbs/avatars).

### 3.5 Shadows & elevation
Mostly flat — hairline borders + a 1px inset top sheen on cards (`--shadow-card-inner`). Shadows are reserved for **modals** (`--shadow-modal`), **popovers** (`--shadow-pop`), the **primary-button lift**, and the **speaking-orb glow**.

### 3.6 Motion
Calm, brief, eased — **no bounce**. UI reactions 150–180ms; theme morph 320ms; orb transitions 500ms. Signature loops: orb float 6.5s, sheen 16s, pulse rings 2.6s, grid breathe 14s, status blink 1.3s. Tokens in `tokens/motion.css`.

### 3.7 Iconography
Inline **line SVGs**, 1.9px stroke, rounded caps/joins (Lucide/Feather style). No icon font and **no emoji anywhere — including CTAs** (use the `mic` icon, not a microphone emoji). The `Icon` component / `ICON_PATHS` map ships a broad set: nav, integrations/secrets/webhooks/API/tokens, reveal (eye/eyeOff), directional (forward/back/arrows/chevrons), accept/reject/x/check, and common actions (copy, refresh, send, trash, edit, more, filter, bell, etc.). Extend with Lucide paths (same style) as needed.

### 3.8 Sound (optional brand detail)
A subtle Web-Audio "tap" on button press (filtered-noise transient + warm low body). Optional; not required for the system to function.

---

## 4. Components & patterns

Pattern classes (CSS-only, in `patterns/`) and React wrappers (in `components/`):

| Class / Component | What |
|---|---|
| `pd-btn pd-btn--{primary,secondary,back,danger}` · `pd-btn--sm` / `Button` | Buttons. Primary = solid; secondary = outline; back = charcoal; danger = red. |
| `pd-talk` / `Button variant="talk"` | Accent-tinted glassy agent CTA (pass `--acc`). |
| `pd-chip` / `Chip` | Uppercase mono badge (agent objectives, statuses). |
| `pd-orb orb-{hue} [sm\|md] [speaking\|calm]` / `Orb` | The signature voice orb. |
| `AgentCard` | Orb + name + objective + description + talk CTA. |
| `pd-input` `pd-textarea` `pd-select` / `Input` `Textarea` | Form fields (+ sizes, invalid/disabled states). |
| `pd-check` `pd-radio` `pd-switch` `pd-segment` | Checkbox, radio, switch, segmented control. |
| `pd-dropdown` + `pd-menu` | Click-to-open action/option popover (rotating chevron, items, separators, danger item). |
| `pd-search` `pd-search-lg` | Toolbar search + page-level ⌘K search. |
| `pd-status-dot` / `StatusDot` | Blinking live presence + timer. |
| `pd-toggle` / `ThemeToggle` | Sun/moon theme switch. |
| `pd-star` / `StarRating` | 5-star rating. |
| `pd-card` `pd-panel` `pd-section` | Surfaces. |
| `pd-stat` `pd-table` `pd-tabs` `pd-pill-status` `pd-nav` `pd-sidebar` `pd-topbar` | App-shell building blocks. |
| `pd-bars` `pd-line-*` `pd-donut` `pd-spark` `pd-meter` `pd-heat` | Charts (dotted gridlines, area, bars, donut, sparkline, meters, heat). |
| `StatusCard` | Success / error / empty terminal states. |
| `Icon` | Line-icon set. |

Every component has hover/focus states and is theme-aware.

---

## 5. Responsive — mobile & desktop equally

The system is **responsive by default**. Requirements & behavior:

- **Always include** `<meta name="viewport" content="width=device-width, initial-scale=1">`.
- **App shell** (`pd-sidebar` + `pd-topbar`): full sidebar ≥900px → icon-rail 600–900px → top horizontal nav <600px. Topbar wraps; main padding tightens.
- **Stat grids** auto-fit and drop to 2-up then 1-up on small screens.
- **Tables** scroll horizontally inside their card below 600px (never squash).
- **Voice demo / cards** stack to a single column; the summary+feedback two-column collapses below 840px.
- **Orbs & charts** scale down on small screens.
- **Touch targets** are ≥44px.

Breakpoints used: **900px** (tablet), **600px** (mobile), **380px** (small). Test both orientations.

---

## 6. Dependencies & fallbacks

| Dependency | Required? | Fallback |
|---|---|---|
| **IBM Plex Mono** (Google Fonts, in `tokens/fonts.css`) | Recommended | Falls back to `ui-monospace, SF Mono, Menlo, monospace`. Self-host for offline/strict-CSP. |
| **Helvetica Neue** | System font (NOT bundled) | Stack falls back to Helvetica → Arial → system-ui. **License & self-host for pixel-identical rendering across platforms.** |
| **CSS `color-mix()`** | Used for accent tints | Supported in all evergreen browsers (Chrome/Edge 111+, Safari 16.2+, Firefox 113+). For older targets, replace `color-mix(...)` with precomputed rgba (the accent `*-200` tints exist for this). |
| **CSS custom properties** | Core | No fallback — evergreen browsers only (IE not supported). |
| React | Only for the `components/*.jsx` path | Plain-HTML `pd-*` classes need no framework. |
| JavaScript | Only for interactive widgets (dropdown, theme toggle, star rating, orb state) | Static markup renders fine without JS; interactivity degrades gracefully. |

No build step, no npm packages, no CSS framework. `styles.css` + assets is the whole runtime.

---

## 7. File map

```
styles.css              ← entry point (link this)
theme.js                ← optional theme persistence (default dark)
tokens/                 ← colors, typography, spacing, radius, shadows, motion, fonts
patterns/               ← orb, controls, app shell, charts, forms (CSS)
components/             ← React: buttons, forms, voice, display, feedback (.jsx + .d.ts + .prompt.md)
ui_kits/                ← full product layouts: voice-demo, dashboard, analytics, agent-builder, marketing-site
guidelines/             ← visual specimen cards (color, type, spacing, radius, elevation, icons, brand)
assets/                 ← logo (white + dark)
readme.md               ← overview
DOCUMENTATION.md        ← this file
AI_CONTEXT.md           ← guidance for AI coding tools
CLAUDE.md / .cursorrules← drop-in AI assistant rules
```

---

## 8. Authoring rules (do / don't)

**Do**
- Link only `styles.css`; set `data-pd-theme` on a root element.
- Use semantic color variables and the type/spacing tokens.
- Reuse `pd-*` classes / components; assign one accent hue per agent.
- Keep copy calm; UPPERCASE mono for labels; line-SVG icons only.
- Include the viewport meta and test mobile + desktop.

**Don't**
- Hard-code hex colors, font families, or pixel radii in product code.
- Introduce a CSS framework, icon font, or any emoji (CTAs use the `mic` icon, never an emoji).
- Use font weights above 600 or bouncy/elastic motion.
- Build a custom control when a `pd-*` one exists.

---

*Questions: harshal@predixion.ai*
