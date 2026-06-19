The brand icon — inline line SVGs, 1.9px stroke, rounded caps/joins (Lucide/Feather style). **No icon font, no emoji anywhere in the system** (including CTAs — use `name="mic"` instead of a microphone emoji).

```jsx
<Icon name="mic" />
<Icon name="webhook" size={16} />
<Icon name="key" stroke="var(--accent)" />
<Icon name="eyeOff" />        {/* reveal/blur a secret */}
```

Groups available: nav (overview, mic, analytics, chat, users, settings, search), integrations/dev (integration, plug, webhook, api, code, terminal, key, secret, lock, unlock, token, shield, link, externalLink), reveal (eye, eyeOff), directional (arrowRight/Left/Up/Down, forward, back, chevronDown/Right/Left), accept/reject/status (x, check, accept, reject, plus, minus, info, alert), actions (copy, refresh, download, upload, send, trash, edit, more, filter, bell, calendar, file, phone, clock, play, pause), theme/rating (sun, moon, star).

Notes
- `currentColor` by default, so it inherits text color — set `color` on the parent or pass `stroke`.
- Extend by adding a path to `ICON_PATHS` (keep the 24×24 viewBox + 1.9px stroke). Pull from Lucide (same style) for anything missing.
