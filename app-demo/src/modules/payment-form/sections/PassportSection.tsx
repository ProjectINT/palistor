"use client";

import { Input } from "@/components/Input";
import { Section } from "../../shared/Section";
import { usePaymentForm, fieldProps } from "@/config/paymentForm";

export function PassportSection() {
  const form = usePaymentForm();

  // Паспорт виден только когда paymentType === "bank"
  if (!form.passport.isVisible) return null;

  return (
    <Section
      title="Passport Information"
      // badge="Nested Fields Demo"
    >
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Input
          {...fieldProps(form.passport.number)}
          className="md:col-span-2"
        />

        <Input
          {...fieldProps(form.passport.issueDate)}
          type="date"
        />

        <Input
          {...fieldProps(form.passport.expiryDate)}
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
