import * as React from "react";
export interface StarRatingProps {
  /** Current rating (0–max). */
  value?: number;
  /** Fired with the clicked star (1-based). */
  onChange?: (value: number) => void;
  /** Number of stars. Default 5. */
  max?: number;
  /** Star px size. Default 28. */
  size?: number;
}
export declare function StarRating(props: StarRatingProps): JSX.Element;
