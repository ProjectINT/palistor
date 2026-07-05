import { FIELD_STATE_PROPS } from "../constants";
import type { AnyConfigNode } from "./types";

/**
 * Checks whether a node has computed props (isVisible, isRequired… functions).
 * Needed for intermediate group nodes (passport.isVisible).
 */
export function hasComputedProps(node: AnyConfigNode): boolean {
  for (const key of FIELD_STATE_PROPS) {
    if (key === "value") continue;
    if (node[key] !== undefined) return true;
  }
  return false;
}
