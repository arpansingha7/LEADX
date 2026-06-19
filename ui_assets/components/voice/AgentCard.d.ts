import * as React from "react";
import type { OrbColor } from "./Orb";

/**
 * @startingPoint section="Components" subtitle="Agent picker card — orb, name, objective, talk CTA" viewport="320x300"
 */
export interface AgentCardProps {
  /** Agent display name. */
  name: string;
  /** Short objective, shown as an uppercase mono chip (e.g. "Collections & Recovery"). */
  objective?: string;
  /** One- or two-line description. */
  description?: string;
  /** Orb accent family for this agent. */
  color?: OrbColor;
  /** Fired when the talk CTA is pressed. */
  onTalk?: () => void;
}
export declare function AgentCard(props: AgentCardProps): JSX.Element;
