---
name: predixion-design
description: Use this skill to generate well-branded interfaces and assets for Predixion AI (voice-agent products), either for production or throwaway prototypes/mocks. Contains essential design guidelines, colors, type, fonts, the signature orb, assets, and UI kit components for prototyping.
user-invocable: true
---

Read the README.md file within this skill, and explore the other available files (tokens/, patterns/, components/, ui_kits/, guidelines/, assets/).

If creating visual artifacts (slides, mocks, throwaway prototypes), copy assets out and create static HTML files for the user to view — link `styles.css` and set `data-pd-theme="dark"` (or `"light"`) on a root wrapper, then use the shipped classes (`pd-btn`, `pd-talk`, `pd-chip`, `pd-orb orb-<hue>`, `pd-input`, `pd-card`, `pd-toggle`). If working on production code, copy assets and follow the rules here, importing the React components in `components/`.

Predixion is dark-first with a full light theme, a flat "operator console" aesthetic, the signature reactive voice **orb** (six hues), IBM Plex Mono uppercase labels over a Helvetica Neue UI, and glassy accent controls. Keep copy calm and precise; UPPERCASE mono for eyebrows/badges; line-SVG icons only from the Icon set (NO emoji anywhere, including CTAs — use the mic icon).

If the user invokes this skill without other guidance, ask what they want to build, ask a few questions, and act as an expert Predixion designer who outputs HTML artifacts or production code depending on the need.
