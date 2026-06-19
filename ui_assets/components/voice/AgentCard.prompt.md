A selectable agent on the landing/picker screen. Lay several out in a responsive grid (`repeat(auto-fit,minmax(248px,1fr))`).

```jsx
<AgentCard name="Aria" objective="Collections & Recovery" color="blue"
  description="Empathetic, compliant outreach for early-stage delinquencies."
  onTalk={() => startWith("aria")} />
```

Notes
- Composes `Orb` (sm) + `Chip` + `Button variant="talk"`; pass a distinct `color` per agent.
- Equal-height by design — keep descriptions to ~2 lines for a tidy grid.
