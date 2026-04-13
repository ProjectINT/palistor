/**
 * Конфиг для вложенного поля passport
 * Демонстрирует nested структуру + group submit pipeline (Phase 5)
 */

import type { FormConfig, TranslateFn } from "@palistor";
import type { PaymentFormValues } from "./types";

// Mock API — имитация сохранения паспорта на сервере
async function mockSavePassport(_values: { id: string | null; number: string; issueDate: string; expiryDate: string }): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 800));
  if (Math.random() < 0.2) {
    throw new Error("Server error: failed to save passport");
  }
}

export const passport: FormConfig<PaymentFormValues> = {
  passport: {
    nested: true,
    isVisible: (values: PaymentFormValues) => values.paymentType === "bank", // Показываем только для банковских переводов
    
    id: {
      value: null,
      isVisible: false, // Скрытое поле
    },
    
    number: {
      value: "",
      label: (t: TranslateFn) => t("form.passport.number"),
      placeholder: (t: TranslateFn) => t("form.passport.numberPlaceholder"),
      isRequired: true,
      validate: (value: string, _values: PaymentFormValues, t: TranslateFn) => {
        if (!value || value.length < 6) {
          return t("form.passport.numberTooShort");
        }
        return undefined;
      },
      types: {
        dataType: "String" as const,
        type: "text"
      }
    },
    
    issueDate: {
      value: "",
      label: (t: TranslateFn) => t("form.passport.issueDate"),
      isRequired: true,
      validate: (value: string, _values: PaymentFormValues, t: TranslateFn) => {
        if (!value) {
          return t("validation.required");
        }
        // Проверяем что дата не в будущем
        const date = new Date(value);
        if (date > new Date()) {
          return t("form.passport.issueDateFuture");
        }
        return undefined;
      },
      types: {
        dataType: "String" as const,
        type: "date"
      }
    },
    
    expiryDate: {
      value: "",
      label: (t: TranslateFn) => t("form.passport.expiryDate"),
      validate: (value: string, values: PaymentFormValues, t: TranslateFn) => {
        if (!value) return undefined;
        
        // Проверяем что дата не в прошлом
        const date = new Date(value);
        if (date < new Date()) {
          return t("form.passport.expiryDatePast");
        }
        
        // Проверяем что дата выдачи раньше даты окончания
        if (values.passport?.issueDate) {
          const issueDate = new Date(values.passport.issueDate);
          if (date <= issueDate) {
            return t("form.passport.expiryDateBeforeIssue");
          }
        }
        
        return undefined;
      },
      dependencies: ["passport.issueDate"], // Зависимость от другого вложенного поля!
      types: {
        dataType: "String" as const,
        type: "date"
      }
    },

    // -------------------------------------------------------------------------
    // Group Submit Pipeline (Phase 5 Demo)
    // -------------------------------------------------------------------------

    // Preprocess values before submission — strip spaces from passport number
    beforeSubmit: (values: any) => ({
      ...values,
      number: String(values.number ?? "").replace(/\s/g, ""),
    }),

    // Mock async save to server
    onSubmit: async (passportValues: any) => {
      await mockSavePassport(passportValues);
    },

    // Called after successful submit — `ctx.reset()` resets the group if needed
    afterSubmit: (_result: any, _ctx: any) => {
      // Optional: _ctx.reset() to clear after save
    },

    // Custom reset — clears dates but keeps the id
    reset: (defaults: any) => ({
      ...defaults,
      issueDate: "",
      expiryDate: "",
    }),
  } as any
};
