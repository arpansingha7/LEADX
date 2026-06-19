import * as React from "react";
export interface ThemeToggleProps {
  /** Active theme. */
  theme?: "dark" | "light";
  /** Fired with the chosen theme. Apply it by setting `data-pd-theme` on a root wrapper. */
  onChange?: (theme: "dark" | "light") => void;
}
export declare function ThemeToggle(props: ThemeToggleProps): JSX.Element;
