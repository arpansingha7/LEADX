The hero voice visual for any Predixion agent surface. Use it large in a live-call view, small on an agent picker card.

```jsx
<Orb color="blue" size="lg" state={speaking ? "speaking" : undefined} />
<Orb color="emerald" size="sm" />        {/* agent card */}
<Orb color="violet" size="lg" state="calm" />  {/* call ended */}
```

Notes
- Six hues: blue, emerald, violet, amber, rose, cyan — assign one per agent (by list order in the demo).
- `state="speaking"` turns on the pulse rings + colored glow; `calm` dims/desaturates; omit for the idle float.
- Stays vivid in both themes (light mode uses colored rather than near-black shading).
