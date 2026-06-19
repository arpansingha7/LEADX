# CLAUDE.md — Predixion AI Design System

This project uses the **Predixion AI Design System**. Before writing UI, read `AI_CONTEXT.md` and `DOCUMENTATION.md`.

## Non-negotiables
- Link **only** `styles.css`. No other CSS framework, reset, or icon font.
- Set `data-pd-theme="dark"` (DEFAULT) or `"light"` on a root element. Use semantic CSS variables — never hard-code hex, font-family, or px radius.
- Reuse `pd-*` classes and the React components in `components/`. Don't rebuild existing controls.
- Always responsive: include the viewport meta; keep the 900/600/380px adaptive behavior.
- Helvetica Neue (body) + IBM Plex Mono (UPPERCASE labels). Line-SVG icons only (from the `Icon` set); **no emoji anywhere, including CTAs** (use the `mic` icon, not a microphone emoji).
- Calm, precise, enterprise copy.

## Where things live
- Tokens: `tokens/` · Patterns (CSS): `patterns/` · Components (React): `components/`
- Product layouts to mirror: `ui_kits/` (voice-demo, dashboard, analytics, agent-builder, marketing-site)
- Full reference: `DOCUMENTATION.md` · AI cheat-sheet: `AI_CONTEXT.md`

## Accents
One hue per agent (blue→emerald→violet→amber→rose→cyan). Solid `var(--pd-blue)` on light, tint `var(--pd-blue-200)` on dark.

## Dependencies / fallbacks
No build step, no npm. `color-mix()` + custom properties → evergreen browsers. IBM Plex Mono (Google Fonts → system mono fallback); Helvetica Neue is a system font (self-host for exact rendering).
