/**
 * Конфиг для вложенного поля passport
 * Демонстрирует nested структуру
 */

import type { FormConfig, TranslateFn } from "@palistor";
import type { PaymentFormValues } from "./types";

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
      validate: (value: string) => {
        if (!value || value.length < 6) {
          return "form.passport.numberTooShort";
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
      validate: (value: string) => {
        if (!value) {
          return "validation.required";
        }
        // Проверяем что дата не в будущем
        const date = new Date(value);
        if (date > new Date()) {
          return "form.passport.issueDateFuture";
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
      validate: (value: string, values: PaymentFormValues) => {
        if (!value) return undefined;
        
        // Проверяем что дата не в прошлом
        const date = new Date(value);
        if (date < new Date()) {
          return "form.passport.expiryDatePast";
        }
        
        // Проверяем что дата выдачи раньше даты окончания
        if (values.passport?.issueDate) {
          const issueDate = new Date(values.passport.issueDate);
          if (date <= issueDate) {
            return "form.passport.expiryDateBeforeIssue";
          }
        }
        
        return undefined;
      },
      dependencies: ["passport.issueDate"], // Зависимость от другого вложенного поля!
      types: {
        dataType: "String" as const,
        type: "date"
      }
    }
  } as any
};
