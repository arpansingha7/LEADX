import * as React from "react";

/**
 * @startingPoint section="Components" subtitle="Success / error / empty state cards" viewport="440x260"
 */
export interface StatusCardProps {
  /** Which state to render. */
  variant?: "success" | "error" | "empty";
  /** Bold headline. */
  title: string;
  /** Optional supporting line. */
  message?: string;
  /** Optional action node (usually a <Button>). */
  action?: React.ReactNode;
}
export declare function StatusCard(props: StatusCardProps): JSX.Element;
