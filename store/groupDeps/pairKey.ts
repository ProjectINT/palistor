/** Separator of the "donor→recipient" pair. */
export const SEP = "→"; // →

/** Create a "donor→recipient" pair key. */
export function pairKey(donor: string, recipient: string): string {
  return `${donor}${SEP}${recipient}`;
}

/** Parse a key back into [donor, recipient]. */
export function parsePairKey(key: string): [string, string] {
  const idx = key.indexOf(SEP);
  return [key.slice(0, idx), key.slice(idx + SEP.length)];
}
