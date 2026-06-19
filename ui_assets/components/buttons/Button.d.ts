import * as React from "react";

/**
 * @startingPoint section="Components" subtitle="Primary, secondary, back, danger & talk buttons" viewport="700x150"
 */
export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** Visual style. `primary` = solid; `secondary` = outline; `back` = charcoal; `danger` = red-tinted; `talk` = accent glass. */
  variant?: "primary" | "secondary" | "back" | "danger" | "talk";
  /** Control size. */
  size?: "sm" | "md";
  /** Accent color for the `talk` variant only, e.g. "var(--pd-blue)". */
  accent?: string;
  children?: React.ReactNode;
}
export declare function Button(props: ButtonProps): JSX.Element;
