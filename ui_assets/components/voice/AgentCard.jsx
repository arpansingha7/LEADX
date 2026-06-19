import React from "react";
import { Orb } from "./Orb.jsx";
import { Button } from "../buttons/Button.jsx";
import { Icon } from "../display/Icon.jsx";

const ACCENT = { blue: "var(--pd-blue)", emerald: "var(--pd-emerald)", violet: "var(--pd-violet)", amber: "var(--pd-amber)", rose: "var(--pd-rose)", cyan: "var(--pd-cyan)" };

/** An agent picker card: orb + name + objective chip + description + talk CTA. */
export function AgentCard({ name, objective, description, color = "blue", onTalk }) {
  const acc = ACCENT[color] || "var(--accent)";
  return (
    <div className="pd-card" style={{ padding: "30px 24px 26px", display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", gap: 14 }}>
      <Orb color={color} size="sm" />
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8, marginTop: 4 }}>
        <h2 style={{ margin: 0, fontSize: "var(--text-2xl)", fontWeight: "var(--weight-semibold)", color: "var(--text-heading)" }}>{name}</h2>
        {objective && <span className="pd-chip" style={{ ["--acc"]: acc }}>{objective.toUpperCase()}</span>}
      </div>
      {description && <p style={{ margin: "2px 0 0", flex: 1, fontSize: "var(--text-md)", color: "var(--text-muted)", lineHeight: "var(--leading-normal)", textWrap: "pretty" }}>{description}</p>}
      <Button variant="talk" accent={acc} style={{ marginTop: 6 }} onClick={onTalk}>
        <Icon name="mic" size={14} style={{ marginRight: 7 }} />Talk to {name}
      </Button>
    </div>
  );
}
