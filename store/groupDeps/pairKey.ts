/** Разделитель пары "донор→реципиент". */
export const SEP = "\u2192"; // →

/** Создать ключ пары "донор→реципиент". */
export function pairKey(donor: string, recipient: string): string {
  return `${donor}${SEP}${recipient}`;
}

/** Разобрать ключ обратно в [donor, recipient]. */
export function parsePairKey(key: string): [string, string] {
  const idx = key.indexOf(SEP);
  return [key.slice(0, idx), key.slice(idx + SEP.length)];
}
