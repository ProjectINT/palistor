/**
 * Palistor — reactive form state manager for React.
 *
 * A store is created from a declarative config (`new Palistor({ config })`)
 * and consumed in React through `useForm(store)`, which returns a tracking
 * proxy: components re-render only when a field they actually read changes.
 *
 * @example
 * ```ts
 * // config/orderForm.ts — module level
 * import { Palistor } from "palistor";
 *
 * export const orderStore = new Palistor({
 *   config: {
 *     name:  { value: "", isRequired: true },
 *     email: { value: "", validate: (v) => (!v.includes("@") ? "Invalid email" : undefined) },
 *   },
 * });
 * ```
 *
 * ```tsx
 * // Component — subscribes via useForm
 * import { useForm } from "palistor";
 *
 * const form = useForm(orderStore);
 * return <input value={form.name.value} onChange={(e) => form.name.onValueChange(e.target.value)} />;
 * ```
 */

// On the cube-architecture branch the package runs on the Cube core
// (experiments/CubePlan.md, Gate 2): the same export list, every type still
// the store's. The store implementation stays reachable for the contract
// tests through index.store.ts until the switch-over (Phase 4).
export * from "./cube/index";
