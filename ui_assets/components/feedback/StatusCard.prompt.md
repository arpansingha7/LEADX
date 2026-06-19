Centered card for terminal states — feedback submitted (success), demo unavailable (error), or nothing-here (empty).

```jsx
<StatusCard variant="success" title="Thank you for your feedback"
  message="Your input goes straight to our product team."
  action={<Button>Back to agents</Button>} />

<StatusCard variant="error" title="This demo is unavailable"
  message="Check your link or try again in a moment."
  action={<Button variant="secondary">Try again</Button>} />
```
