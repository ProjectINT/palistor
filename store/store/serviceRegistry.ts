import type { TranslateFn } from "./types";
import type { NotifyFn } from "../resolvePipeline";

/**
 * Holds and delegates the translation and notification services.
 *
 * `translate` and `notify` are stable references, safe to pass into closures.
 * The internal `_translator` / `_notifier` are swapped via `setTranslator` / `setNotifier`.
 */
export class ServiceRegistry {
  private _translator: TranslateFn = (v) => v;
  private _notifier: NotifyFn = () => {};

  /** Stable translation function, delegates to the current translator. */
  readonly translate: TranslateFn = (...args: any[]) => this._translator(...args);

  /** Stable notification function, delegates to the current notifier. */
  readonly notify: NotifyFn = (...args) => this._notifier(...args);

  /**
   * Set the translation function.
   * @returns `true` when the value changed (caller may invalidate caches).
   */
  setTranslator(t: TranslateFn | null): boolean {
    const next: TranslateFn = typeof t === "function" ? t : (v) => v;
    if (this._translator === next) return false;
    this._translator = next;
    return true;
  }

  /** Set the notification function. */
  setNotifier(fn: NotifyFn | null): void {
    this._notifier = typeof fn === "function" ? fn : () => {};
  }
}
