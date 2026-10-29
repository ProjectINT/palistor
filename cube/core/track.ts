// ─────────────────────────────────────────────────────────────────────────────
// Reactive core: ONE mechanism for everything.
// "Who is observing right now" is a module-level slot. Every cube getter calls
// track(this). That covers three things at once, which in Palistor take four
// different tracking proxies plus the group dependency maps:
//   1) computed flags (isVisible: (v) => v.showAddress),
//   2) resolve dependencies,
//   3) which cubes a component read in useForm.
// ─────────────────────────────────────────────────────────────────────────────

import type { Cube } from "./cube";

export interface Observer {
  deps: Set<Cube>;
}

let current: Observer | null = null;

export const track = (c: Cube) => { current?.deps.add(c); };

export function observe<T>(obs: Observer, fn: () => T): T {
  const prev = current;
  current = obs;
  try { return fn(); } finally { current = prev; }
}

/**
 * Installs `obs` without restoring the previous observer: reads until the end
 * of the component body land in it. Only the sketch's useForm uses this; the
 * leak into the last frame is a known hole (CubePlan.md, Phase 1).
 */
export function enter(obs: Observer | null) { current = obs; }
