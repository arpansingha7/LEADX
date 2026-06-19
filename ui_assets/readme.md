# Predixion AI — Design System

A dark-first (with full light theme) design system for **Predixion AI** voice
products. It codifies the look & feel of the public voice-agent demo — the
signature reactive **orb**, a flat "operator console" aesthetic, IBM Plex Mono
labels over a Helvetica Neue UI, and glassy accent controls — so every Predixion
product can be built from one consistent vocabulary.

**Source of truth:** the Predixion Voice Demo (this project's `Predixion Voice
Demo.dc.html` / `… - Light.dc.html`, and the React handoff in `export/`). The
tokens, patterns, and components here are extracted directly from it.

> **Set the file type to "Design System"** in the Share menu so your org can use it.

---

## Content fundamentals (copy & tone)

- **Voice:** calm, precise, enterprise. Confident but never hype-y. Short
  sentences. Second person ("talk to it live, exactly the way your customers
  would"). No exclamation marks in product chrome.
- **Casing:** Title case for headlines and agent names; **UPPERCASE mono** for
  eyebrows, badges, statuses, and metadata (`LIVE VOICE DEMO`, `CALL SUMMARY`,
  `BEFORE YOU START`, `PRESENTED FOR`).
- **Punctuation:** commas over em-dashes in body copy. Mono labels use
  middots / wide tracking, not sentence punctuation.
- **Emoji:** never. Zero emoji anywhere — all glyphs, including CTAs, are
  line-SVG icons from the `Icon` set (e.g. `mic` on "Talk to {agent}").
- **Numbers:** tabular, monospace (timers `1:52`). Outcomes are plain words
  ("Positive", "Resolved") — no decorative stat-slop.

## Visual foundations

- **Themes:** dark is default. Both are token-driven (`data-pd-theme="dark|light"`
  on a root wrapper). Switching morphs colors over ~0.32s.
- **Background:** flat near-black (`#08080B`) / soft paper (`#F6F7FA`) with a
  faint masked grid that slowly breathes, plus a 1px top sheen line and a soft
  top wash. No big gradients.
- **Surfaces:** mostly flat. Cards = hairline border + a 1px inset top sheen
  (`--shadow-card-inner`); shadows are reserved for modals and the primary-button
  lift. Panels (summary, modal, inputs) are solid `--panel`.
- **The orb:** a layered radial sphere (white highlight blob + colored shadow
  blob + drifting hue blob + slow conic sheen). Floats when idle, glows + shows
  two pulse rings when speaking, dims/desaturates when calm. Six hues, one per
  agent. Stays vivid in light mode (colored shading, never muddy black).
- **Color:** six accent families (blue, emerald, violet, amber, rose, cyan) each
  with a **solid** (deep, for light) and **tint** (pastel, for dark) value.
  Status: green success, amber warning/stars, rose danger.
- **Type:** Helvetica Neue (UI/body) + IBM Plex Mono (labels). Headlines 30px/600
  with tight tracking; agent names 20–25px; body 14px.
- **Radius:** soft — 10px buttons/inputs, 14–20px cards/modals; pill only for
  chips, the toggle, and status dots; circle for orbs/avatars.
- **Motion:** calm, brief, eased (no bounce). Orbs breathe slowly (6.5s float,
  16s sheen, 2.6s rings); UI reactions are 150–180ms; theme morph 320ms.
- **Hover/press:** buttons lift 1px and brighten; cards lift 3px + border
  brightens; press settles back to 0. Secondary/outline fill in faintly.
- **Sound:** a subtle Web-Audio "tap" on button press (filtered-noise transient +
  warm low body). Optional but part of the brand feel.

## Iconography

- **Line SVG icons** (1.9px stroke, rounded caps) from the `Icon` set — covers
  nav, integrations/secrets/webhooks/API, reveal (eye/eyeOff), directional
  (forward/back/arrows/chevrons), accept/reject/x/check, and common actions.
  **No icon font, no PNG icons, and no emoji anywhere — including CTAs** (use the
  `mic` icon, not a microphone emoji). Match this stroke style — Lucide / Feather
  are good matches for new glyphs (flag any substitution).
- **Logo:** the Predixion "α / PREDIXION AI" wordmark (`assets/predixion-logo.png`,
  white). On light surfaces it is auto-darkened with `filter: invert(1)` — no
  separate dark asset needed (`assets/predixion-logo-dark.png` is provided if you
  prefer a real file).

---

## Index / manifest

- `styles.css` — **the entry point.** Link this one file. `@import`s all tokens,
  fonts, and the orb/controls patterns.
- `tokens/` — `colors.css` (base palette + themed semantic aliases), `typography.css`,
  `spacing.css`, `radius.css`, `shadows.css`, `motion.css`, `fonts.css`.
- `patterns/` — `orb.css` (the orb), `controls.css` (buttons, chips, inputs,
  status dot, shimmer, toggle, cards). Shipped to consumers via `styles.css`.
- `components/` — React primitives (`.jsx` + `.d.ts` + `.prompt.md`):
  - `buttons/Button` · `display/Chip`, `display/ThemeToggle`
  - `forms/Input`, `forms/Textarea`, `forms/StarRating`
  - `voice/Orb`, `voice/AgentCard`, `voice/StatusDot`
  - `feedback/StatusCard` (success / error / empty terminal states)
- `ui_kits/voice-demo/` — the full interactive product recreation (landing →
  before-you-start → live call → summary + feedback → submitted), with the theme
  toggle. Also registered as a Starting Point.
- `ui_kits/dashboard/` — agent operations overview (sidebar shell, stat tiles,
  live agents table).
- `ui_kits/analytics/` — conversation insights (volume bars, outcome donut,
  top-intents table, time-range tabs).
- `ui_kits/agent-builder/` — configure a voice agent (identity, voice, behavior)
  with a live preview orb that reacts to the chosen name + hue.
- `ui_kits/marketing-site/` — landing page (orb hero, logo wall, feature cards).
- Shared app-shell patterns (`patterns/app.css`): sidebar, topbar, stat tiles,
  tables, status pills, tabs, search — reuse these for any new product surface.
- `guidelines/` — foundation specimen cards (Colors, Type, Spacing, Radius,
  Elevation, Brand) shown in the Design System tab.
- `assets/` — logo (white + dark).
- `theme.js` — optional theme persistence helper (defaults to dark).
- `DOCUMENTATION.md` — full developer guide (foundations, components, responsive, dependencies, fallbacks).
- `AI_CONTEXT.md` / `CLAUDE.md` / `.cursorrules` — drop-in rules for AI coding tools.
- `Predixion-Design-System-Guide.html` — branded, print-ready PDF source (open & Save as PDF).
- `export/` — the production `PublicDemo.tsx` handoff + standalone HTML references
  (dev package; **not** part of the component bundle).

## Using it

```html
<link rel="stylesheet" href="styles.css">
<div data-pd-theme="dark"> … your app … </div>
```
Then either use the React components, or apply the shipped classes directly
(`pd-btn pd-btn--primary`, `pd-talk`, `pd-chip`, `pd-orb orb-blue speaking`,
`pd-input`, `pd-toggle`, `pd-card`). All colors come from CSS variables, so the
same markup works in both themes.

## Caveats

- **Helvetica Neue** is a system font (not webfont-hosted); platforms without it
  fall back to Arial/system-ui. Self-host it for pixel-identical rendering.
- Component preview cards are rendered with the shipped pattern classes (not the
  React bundle) so they're robust in the Design System tab; the `.jsx` components
  are still bundled for consumers and Starting Points.
