import * as React from "react";

export type OrbColor = "blue" | "emerald" | "violet" | "amber" | "rose" | "cyan";

/**
 * @startingPoint section="Components" subtitle="The signature voice orb — six hues, reactive states" viewport="700x260"
 */
export interface OrbProps {
  /** Accent family. Assign one per agent. */
  color?: OrbColor;
  /** lg = call view (184px), md = mobile (152px), sm = agent card (108px). */
  size?: "sm" | "md" | "lg";
  /** Reactive state: `speaking` glows + pulses, `calm` dims after a call, omit for idle float. */
  state?: "speaking" | "calm";
}
export declare function Orb(props: OrbProps): JSX.Element;
