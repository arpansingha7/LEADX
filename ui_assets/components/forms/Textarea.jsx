import React from "react";
/** Multi-line text input (vertical resize), token-styled. Forwards all native props. */
export function Textarea({ style, ...rest }) {
  return <textarea className="pd-textarea" style={style} {...rest} />;
}
