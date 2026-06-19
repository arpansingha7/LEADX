# Predixion AI — Public Voice Demo (Redesigned, themable)

Drop-in replacement for the existing public demo screen (`PublicDemo.tsx`).
**Only the presentation layer changed.** Routing, API endpoints, the Vapi /
ElevenLabs SDK wiring, summary polling, and feedback submission are identical to
the screen you have today — so this is a safe swap.

The component is **themable**: it opens in **dark mode by default** and includes a
small dark/light toggle on the heading row. The user's choice is remembered
(localStorage).

---

## 1. What's in this package

| File | What it is |
|------|------------|
| `PublicDemo.tsx` | The production React component. **Replaces your current `src/pages/PublicDemo.tsx`.** Dark + light themes built in. |
| `Predixion Voice Demo.html` | Self-contained **dark** build — open in any browser to click through the design offline. Visual reference only. |
| `Predixion Voice Demo - Light.html` | Self-contained **light** build. (The two references cross-link via the in-page toggle.) |
| `assets/logo-white.png` | The white Predixion wordmark used in the header (already in your repo at `src/assets/logo-white.png`). |
| `README.md` | This file. |

> The `.html` files are for **visual reference / stakeholder review**. They include a
> bottom-left "Preview states" switcher to jump between Landing / Live / Summary /
> Passcode / Loading / Error. That switcher does **not** exist in `PublicDemo.tsx`.

---

## 2. How to install

1. Back up your current file, then replace it:
   ```
   src/pages/PublicDemo.tsx   ←  PublicDemo.tsx   (from this package)
   ```
2. Confirm the import paths at the top match your project:
   ```ts
   import { BASE } from "../api";               // your API base URL
   import logo from "../assets/logo-white.png"; // header logo (white wordmark)
   ```
   Adjust relative depth (`../` vs `../../`) to match where the file lives.
3. **No new dependencies.** Uses exactly what the old screen used: `react`,
   `react-router-dom`, `@vapi-ai/web`, `@elevenlabs/client`. The old
   `@heroicons/react` import is no longer needed (icons are inline SVG now) — remove
   it if nothing else uses it.
4. Build and run. No env, route, or backend changes required.

> **Light-mode logo:** the header logo is the white wordmark; in light mode it's
> auto-darkened with a CSS `filter: invert(1)`, so you don't need a second asset.

---

## 3. Backend contract (unchanged)

### Data types
```ts
interface Company {
  id: string; name: string; slug: string; logo_url: string;
  passcode: string; voice_platform: "vapi" | "elevenlabs" | string;
  is_published: number;
}
interface Agent {
  id: string; name: string; description: string; agent_id: string;
  avatar_url: string; objective: string; is_published: number;
}
```

### Endpoints used (all relative to `BASE`)
| Method | Endpoint | When |
|--------|----------|------|
| `GET`  | `/api/public/companies/:slug` | On mount — company + passcode flag |
| `GET`  | `/api/public/agents/:companyId` | On mount — agents (`is_published === 1`) |
| `POST` | `/api/voice/eleven-labs/session` | Start an ElevenLabs call |
| `POST` | `/api/voice/vapi/session` | Start a Vapi call |
| `GET`  | `/api/voice/vapi/call-summary?callId=…&sessionId=…` | Poll summary (Vapi) |
| `GET`  | `/api/voice/eleven-labs/call-summary?conversationId=…&sessionId=…` | Poll summary (ElevenLabs) |
| `GET`  | `/api/public/session/:sessionId` | Summary fallback (webhook-based) |
| `POST` | `/api/public/feedback` | Submit rating + feedback |

Summary poller still runs every 5s, up to 20 attempts (~100s), stopping as soon as
`{ success: true, summary }` returns — identical to the old behaviour.

---

## 4. What's different in the UI

| Area | Now |
|------|-----|
| **Theme** | Flat "operator console" look. **Dark by default**, with a sun/moon toggle on the heading row (top-right). Choice persists in `localStorage` under `pdTheme`. Switching morphs colors with a smooth ~0.32s transition. |
| **Agent picker** | A **card per agent** in a responsive grid; each card has its own colored 3-D orb + a "Talk to {name}" button. (Replaces the old single avatar + `<select>`.) |
| **Call visual** | A reactive **sphere orb** — floats when idle, glows + shows pulse rings while the agent speaks, dims when the call ends. No transcript shown. |
| **Header** | Logo top-left (aligned to content); "PRESENTED FOR / {company.name}" + initials chip top-right. |
| **Summary** | Summary paragraph only (no duration/sentiment/outcome chips). Shimmer skeleton + "Analyzing conversation…" while polling. On desktop the summary sits **beside** the agent card (two-column), so there's no extra scrolling. |
| **Feedback** | Stars + "tell us more" + anonymous toggle + name/email. Solid-black "Submit feedback" with a charcoal "Back to agents". |
| **Contact us** | Opens a **`mailto:`** to `harshal@predixion.ai` with a prefilled subject + body (old `/api/public/contact` form is not called). |
| **Sound** | A subtle, refined click "tap" (Web Audio) on button presses. Activates on first click (browsers require a user gesture to start audio). |
| **Fonts** | Helvetica Neue (body) + IBM Plex Mono (labels/badges/timer). |
| **Responsive** | Full mobile breakpoints (cards stack, header/logo/orb/headline shrink). |

### Behavioural notes
- **Orb colors** are assigned to agents by list order (blue → emerald → violet →
  amber → rose → cyan, then repeats). Edit `ORB_COLORS` / `ACCENT` / `SOLID`.
- **Call duration timer** is a local cosmetic counter (starts when `isConnected`).
- **Transcript is still captured** internally (`setTranscript`) from the SDK
  callbacks in case you want to surface it later — it's just not rendered.

---

## 5. Theming model (for future tweaks)

All theme colors are CSS custom properties defined on the root element under
`.pd-root[data-pd-theme="dark"]` and `.pd-root[data-pd-theme="light"]` (see the
`CSS` template string at the bottom of the file). Inline styles reference them as
`var(--token)`. To retune a theme, edit those two blocks — you rarely need to touch
the markup. Default theme is set here:

```ts
const [theme, setTheme] = useState<Theme>(() => {
  try { return (localStorage.getItem("pdTheme") as Theme) || "dark"; } catch { return "dark"; }
});
```

| Want to… | Do this |
|----------|---------|
| Change default theme | Change the `"dark"` fallback above |
| Retune a palette | Edit the `[data-pd-theme="dark"]` / `["light"]` variable blocks |
| Change the Contact email / message | Edit `CONTACT_EMAIL` / `openContact()` |
| Re-order / change orb colors | Edit `ORB_COLORS`, `ACCENT` (dark), `SOLID` (light) |
| Turn off the click sound | Remove the "click sound" `useEffect` |
| Show a transcript | Lines are in `transcript` state (write-only today); add a render block in the call view |
| Re-enable the old Contact form modal | Restore the `/api/public/contact` POST from your previous file and point "Contact us" at it instead of `openContact` |

---

_Questions on the redesign or handoff: harshal@predixion.ai_
