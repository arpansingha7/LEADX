Sun/moon segmented control for switching theme. Place it on the heading row, top-right.

```jsx
const [theme, setTheme] = useState("dark");
<div data-pd-theme={theme}>
  <ThemeToggle theme={theme} onChange={setTheme} />
</div>
```
You own persistence/application — set `data-pd-theme` on your root wrapper so the tokens flip.
