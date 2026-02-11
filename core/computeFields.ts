/**
 * Palistor - Система вычисления состояния полей (ComputedFieldState)
 *
 * Этот модуль отвечает за:
 * 1. Вычисление fieldState из FieldConfig + values
 * 2. Оптимизацию через массив dependencies
 * 3. Сравнение состояний для минимизации ре-рендеров
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * АРХИТЕКТУРА
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * FieldConfig (конфигурация)     ComputedFieldState (вычисленное)
 * ┌─────────────────────────┐    ┌────────────────────────────────┐
 * │ isVisible: (v) => ...   │ →  │ isVisible: true                │
 * │ isRequired: true        │ →  │ isRequired: true               │
 * │ label: (t) => t('key')  │ →  │ label: 'Номер карты'           │
 * │ dependencies: ['type']  │    │                                │
 * └─────────────────────────┘    └────────────────────────────────┘
 *
 * ПОТОК ВЫЧИСЛЕНИЯ:
 * ```
 * setValue('paymentType', 'bank')
 *    │
 *    ▼
 * shouldRecalculateField('cardNumber', 'paymentType', config)
 *    │ → config.cardNumber.dependencies = ['paymentType']
 *    │ → 'paymentType' в списке → true
 *    ▼
 * computeFieldState('cardNumber', values, config, translate)
 *    │ → isVisible = config.isVisible(values) → false
 *    │ → isRequired = config.isRequired(values) → false
 *    │ → label = config.label(translate) → 'Card Number'
 *    ▼
 * Новый ComputedFieldState для cardNumber
 * ```
 *
 * РЕФАКТОРИНГ: Все функции перенесены в ./compute/
 * Этот файл сохранён для обратной совместимости
 */

// Re-export всех функций из ./compute/
export type { ComputeContext } from "./compute";
export {
  computeFieldState,
  computeAllFieldStates,
  recomputeFieldStates,
  shouldRecalculateField,
  isFieldStateEqual,
  extractErrors,
  extractValues,
  defaultTranslate,
} from "./compute";
