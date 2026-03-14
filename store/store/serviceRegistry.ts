import type { TranslateFn } from "./types";
import type { NotifyFn } from "../resolvePipeline";

/**
 * Хранит и делегирует сервисы перевода и уведомлений.
 *
 * `translate` и `notify` — стабильные ссылки, безопасно передавать в замыкания.
 * Внутренние `_translator` / `_notifier` обновляются через `setTranslator` / `setNotifier`.
 */
export class ServiceRegistry {
  private _translator: TranslateFn = (v) => v;
  private _notifier: NotifyFn = () => {};

  /** Стабильная функция перевода, делегирует в текущий translator. */
  readonly translate: TranslateFn = (...args: any[]) => this._translator(...args);

  /** Стабильная функция уведомления, делегирует в текущий notifier. */
  readonly notify: NotifyFn = (...args) => this._notifier(...args);

  /**
   * Установить функцию перевода.
   * @returns `true` если значение изменилось (вызывающий может инвалидировать кэши).
   */
  setTranslator(t: TranslateFn | null): boolean {
    const next: TranslateFn = typeof t === "function" ? t : (v) => v;
    if (this._translator === next) return false;
    this._translator = next;
    return true;
  }

  /** Установить функцию уведомления. */
  setNotifier(fn: NotifyFn | null): void {
    this._notifier = typeof fn === "function" ? fn : () => {};
  }
}
