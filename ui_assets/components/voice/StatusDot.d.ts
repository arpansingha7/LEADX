import * as React from "react";
export interface StatusDotProps {
  /** Dot color (defaults to the success green). */
  color?: string;
  /** Optional trailing label / timer, e.g. "1:52". */
  label?: React.ReactNode;
  style?: React.CSSProperties;
}
export declare function StatusDot(props: StatusDotProps): JSX.Element;
