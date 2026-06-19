import React from "react";
/** Single-line text input, token-styled and theme-aware. Forwards all native props. */
export function Input({ style, ...rest }) {
  return <input className="pd-input" style={style} {...rest} />;
}
