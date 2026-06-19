import React from "react";

/** Live "breathing" status dot + optional label/timer. Green by default. */
export function StatusDot({ color, label, style }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 9, fontFamily: "var(--font-mono)", fontSize: 13, letterSpacing: ".12em", color: "var(--accent)", ...style }}>
      <span className="pd-status-dot" style={color ? { background: color, boxShadow: `0 0 9px ${color}` } : undefined} />
      {label}
    </span>
  );
}
