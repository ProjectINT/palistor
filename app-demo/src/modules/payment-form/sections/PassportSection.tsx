"use client";

import { Input } from "@/components/Input";
import { Section } from "../../shared/Section";
import { usePaymentForm } from "@/config/paymentForm";

export function PassportSection({ formId }: { formId: string }) {
  const { getFieldProps } = usePaymentForm(formId);

  // Получаем props для вложенных полей с автокомплитом!
  const numberProps = getFieldProps("passport.number");
  const issueDateProps = getFieldProps("passport.issueDate");
  const expiryDateProps = getFieldProps("passport.expiryDate");

  // Паспорт виден только когда paymentType === "bank"
  if (!numberProps.isVisible) return null;

  return (
    <Section
      title="Passport Information"
      // badge="Nested Fields Demo"
    >
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Input
          {...numberProps}
          className="md:col-span-2"
        />
        
        <Input
          {...issueDateProps}
          type="date"
        />
        
        <Input
          {...expiryDateProps}
          type="date"
        />
      </div>
      
      <div className="mt-2 text-sm text-gray-500">
        💡 Это демонстрация вложенных полей (nested fields). 
        Доступ через точечную нотацию: <code className="bg-gray-100 px-1 rounded">passport.number</code>
      </div>
    </Section>
  );
}
