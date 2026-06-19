import React from "react";

const SOLID = { blue: "var(--pd-blue)", emerald: "var(--pd-emerald)", violet: "var(--pd-violet)", amber: "var(--pd-amber)", rose: "var(--pd-rose)", cyan: "var(--pd-cyan)" };

/** Uppercase mono badge. Pass `accent` (hue name or CSS color) to tint it. */
export function Chip({ children, accent, style }) {
  const acc = accent ? (SOLID[accent] || accent) : "var(--accent)";
  return <span className="pd-chip" style={{ ["--acc"]: acc, ...style }}>{typeof children === "string" ? children.toUpperCase() : children}</span>;
}
