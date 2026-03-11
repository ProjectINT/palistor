import { parsePairKey } from "./pairKey";

/**
 * Получить все группы-реципиенты для данного донора (исключая self-зависимость).
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
