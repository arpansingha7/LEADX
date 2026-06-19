import * as React from "react";
export type IconName =
  | "overview" | "mic" | "analytics" | "chat" | "users" | "settings" | "search"
  | "integration" | "plug" | "webhook" | "api" | "code" | "terminal" | "key"
  | "secret" | "lock" | "unlock" | "token" | "shield" | "link" | "externalLink"
  | "eye" | "eyeOff"
  | "arrowRight" | "arrowLeft" | "arrowUp" | "arrowDown" | "forward" | "back"
  | "chevronDown" | "chevronRight" | "chevronLeft"
  | "x" | "check" | "accept" | "reject" | "plus" | "minus" | "info" | "alert"
  | "copy" | "refresh" | "download" | "upload" | "send" | "trash" | "edit"
  | "more" | "filter" | "bell" | "calendar" | "file" | "phone" | "clock" | "play" | "pause"
  | "sun" | "moon" | "star";

/**
 * @startingPoint section="Components" subtitle="Curated line-icon set (Lucide-style) — no emoji" viewport="760x260"
 */
export interface IconProps {
  /** Icon key. */
  name: IconName;
  /** Pixel size (square). Default 18. */
  size?: number;
  /** Stroke color. Default currentColor. */
  stroke?: string;
  /** Fill (default none). */
  fill?: string;
  /** Stroke width. Default 1.9. */
  strokeWidth?: number;
  style?: React.CSSProperties;
}
export declare function Icon(props: IconProps): JSX.Element;
export declare const ICON_PATHS: Record<IconName, string>;
