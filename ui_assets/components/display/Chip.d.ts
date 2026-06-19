import * as React from "react";
export interface ChipProps {
  children?: React.ReactNode;
  /** Accent hue name ("blue"…"cyan") or any CSS color. Defaults to the theme accent. */
  accent?: string;
  style?: React.CSSProperties;
}
export declare function Chip(props: ChipProps): JSX.Element;
