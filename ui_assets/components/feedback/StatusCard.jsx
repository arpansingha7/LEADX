import React from "react";

const ICONS = {
  success: { fg: "var(--pd-success)", bg: "rgba(62,207,142,.1)", bd: "rgba(62,207,142,.35)", glyph: "✓" },
  error:   { fg: "var(--pd-danger-fg-light)", bg: "rgba(244,63,94,.1)", bd: "rgba(244,63,94,.35)", glyph: "!" },
  empty:   { fg: "var(--text-muted)", bg: "var(--input-bg)", bd: "var(--border-input)", glyph: "∅" },
};

/** Centered status card for success / error / empty states. */
export function StatusCard({ variant = "success", title, message, action }) {
  const i = ICONS[variant] || ICONS.success;
  return (
    <div className="pd-card" style={{ maxWidth: 400, width: "100%", padding: "38px 32px", display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", gap: 12 }}>
      <div style={{ width: 50, height: 50, borderRadius: variant === "error" ? "var(--radius-lg)" : "50%", background: i.bg, border: `1px solid ${i.bd}`, color: i.fg, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 24, fontWeight: 700 }}>{i.glyph}</div>
      <h2 style={{ margin: "6px 0 0", fontSize: 18, fontWeight: 600, color: "var(--text-heading)" }}>{title}</h2>
      {message && <p style={{ margin: "0 0 4px", fontSize: 13.5, color: "var(--text-muted)", lineHeight: 1.6 }}>{message}</p>}
      {action}
    </div>
  );
}
