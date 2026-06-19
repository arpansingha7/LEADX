import React from "react";

/**
 * Predixion button. Token-driven; theme-aware automatically.
 * `talk` is the accent-tinted glassy variant used on agent cards —
 * pass `accent` (e.g. "var(--pd-blue)") to tint it.
 */
export function Button({ variant = "primary", size = "md", accent, children, style, ...rest }) {
  if (variant === "talk") {
    return (
      <button className="pd-talk" style={{ ["--acc"]: accent || "var(--accent)", ...style }} {...rest}>
        {children}
      </button>
    );
  }
  const cls = `pd-btn pd-btn--${variant}${size === "sm" ? " pd-btn--sm" : ""}`;
  return <button className={cls} style={style} {...rest}>{children}</button>;
}
