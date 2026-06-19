Standard text field (name, email, passcode). All native `<input>` props pass through.

```jsx
<Input placeholder="Your email (optional)" value={email} onChange={e => setEmail(e.target.value)} />
<Input type="password" placeholder="Passcode" />
```
