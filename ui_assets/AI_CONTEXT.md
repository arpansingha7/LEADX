# Predixion AI — Design System · AI Context

You are working in a codebase that uses the **Predixion AI Design System**. Follow these rules when generating or editing UI. This file is the canonical context for AI coding tools (Claude Code, Cursor, Copilot, etc.).

## Golden rules
1. **Link only `styles.css`.** It `@import`s all tokens + patterns. Never add another CSS framework, reset, or icon font.
2. **Theme:** set `data-pd-theme="dark"` (DEFAULT) or `"light"` on a root element. Never hard-code theme colors — use semantic CSS variables.
3. **Never hard-code** hex colors, font families, or pixel radii in product code. Use tokens: `var(--text)`, `var(--surface)`, `var(--accent)`, `var(--font-sans)`, `var(--radius-md)`, `var(--space-4)`, etc.
4. **Reuse `pd-*` classes / the React components** in `components/`. Don't rebuild a control that exists.
5. **Responsive is mandatory.** Always include `<meta name="viewport" content="width=device-width, initial-scale=1">`. The app shell, grids, tables, cards, orbs, and charts already adapt at 900 / 600 / 380px — keep that behavior.
6. **Voice & visuals:** calm, precise, enterprise copy. UPPERCASE IBM Plex Mono for eyebrows/badges/labels/timers; Helvetica Neue for everything else. Line-SVG icons only (1.9px stroke) from the `Icon` set — **NO emoji anywhere, including CTAs** (use `Icon name="mic"`, never a microphone emoji).

## Vocabulary cheat-sheet
- Buttons: `pd-btn pd-btn--primary|secondary|back|danger` (+ `pd-btn--sm`); accent CTA: `pd-talk` with inline `--acc`.
- Chip/badge: `pd-chip` (inline `--acc` for hue).
- Orb: `pd-orb orb-{blue|emerald|violet|amber|rose|cyan} [sm|md] [speaking|calm]`.
- Forms: `pd-input` (`--sm`/`--lg`, `.invalid`), `pd-textarea`, `pd-select`, `pd-check`, `pd-radio`, `pd-switch`, `pd-segment`, `pd-field`/`pd-label`/`pd-help`/`pd-error`.
- Dropdown: `pd-dropdown` wrapper (toggle `data-open`) + `pd-dropdown-trigger` + `pd-menu` with `pd-menu-item`/`pd-menu-sep`/`pd-menu-label`.
- Search: `pd-search` (toolbar), `pd-search-lg` (page-level, ⌘K).
- App shell: `pd-app`, `pd-sidebar`, `pd-topbar`, `pd-nav`, `pd-main-pad`, `pd-pagehead`, `pd-stat`/`pd-stats`, `pd-section`/`pd-section-head`, `pd-table`, `pd-tabs`, `pd-pill-status`.
- Charts: `pd-bars`, `pd-line-svg`/`pd-line-stroke`(`.dashed`)/`pd-line-area`/`pd-line-dot`/`pd-chart-grid .line`(dotted), `pd-donut`, `pd-spark`, `pd-meter`, `pd-heat`.
- Surfaces: `pd-card`, `pd-panel`, `pd-section`. Status states: `StatusCard` (success/error/empty). Theme switch: `pd-toggle` / `ThemeToggle`.

## Accents
One hue per agent, in list order: blue → emerald → violet → amber → rose → cyan. Solid value `var(--pd-blue)` etc. on light surfaces; pastel `var(--pd-blue-200)` etc. on dark.

## Dependencies / fallbacks
- IBM Plex Mono via Google Fonts (fallback: system mono). Helvetica Neue is a system font (fallback: Arial/system-ui) — self-host for exact rendering.
- Uses `color-mix()` and CSS custom properties → evergreen browsers only. For older targets, swap `color-mix(...)` for the precomputed `*-200` tints.
- No build step, no npm. React is only needed for the `.jsx` component path; plain `pd-*` classes are framework-free.

## When unsure
Read `DOCUMENTATION.md` (full guide) and the relevant `components/**/*.prompt.md`. Mirror the existing `ui_kits/` layouts for new product screens.
