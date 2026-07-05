const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

function randomStr(len: number): string {
  let result = '';
  for (let i = 0; i < len; i++) {
    result += CHARS[Math.floor(Math.random() * CHARS.length)];
  }
  return result;
}

let seq = 0;

/**
 * Generates a temporary ID with the `_tmp_` prefix.
 * Used when an entity is upserted without an explicit id.
 * Format: _tmp_<timestamp_base36>_<8 random chars>_<seq>
 */
export function generateTmpId(): string {
  return `_tmp_${Date.now().toString(36)}_${randomStr(8)}_${++seq}`;
}
