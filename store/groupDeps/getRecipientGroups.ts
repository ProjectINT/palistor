import { parsePairKey } from "./pairKey";

/**
 * Get all recipient groups for a given donor (excluding the self-dependency).
 */
export function getRecipientGroups(deps: Set<string>, donorPath: string): string[] {
  const recipients: string[] = [];
  for (const pair of deps) {
    const [donor, recipient] = parsePairKey(pair);
    if (donor === donorPath && recipient !== donorPath) {
      recipients.push(recipient);
    }
  }
  return recipients;
}
