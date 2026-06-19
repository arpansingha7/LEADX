Predixion button — use for every clickable action; `primary` is the solid CTA, `secondary` the outline, `back` the charcoal return action, `danger` to end a call, `talk` the accent-tinted agent CTA.

```jsx
<Button variant="primary">Submit feedback</Button>
<Button variant="secondary">Try again</Button>
<Button variant="back"><Icon name="arrowLeft" size={14} style={{ marginRight: 6 }} />Back to agents</Button>
<Button variant="danger"><Icon name="x" size={14} style={{ marginRight: 6 }} />End call</Button>
<Button variant="talk" accent="var(--pd-emerald)"><Icon name="mic" size={14} style={{ marginRight: 7 }} />Talk to Max</Button>
<Button variant="primary" size="sm">Continue <Icon name="arrowRight" size={14} style={{ marginLeft: 6 }} /></Button>
```

Notes
- Theme-aware: colors come from CSS variables, so the same button reads correctly in dark and light.
- `talk` needs `accent` (one of the six agent hues) to tint its glass fill, border, and text.
- All native `<button>` props pass through (`onClick`, `disabled`, `type`, `style`).
