import React from "react";

/**
 * The signature Predixion voice orb. Floats when idle; pass state="speaking"
 * for the glow + pulse rings, or state="calm" to dim it after a call.
 */
export function Orb({ color = "blue", size = "lg", state }) {
  const sz = size === "sm" ? " sm" : size === "md" ? " md" : "";
  const st = state ? ` ${state}` : "";
  return (
    <div className={`pd-orb orb-${color}${sz}${st}`}>
      <div className="r1" /><div className="r2" />
      <div className="sphere">
        <div className="bA" /><div className="bB" /><div className="bC" /><div className="sheen" />
      </div>
    </div>
  );
}
