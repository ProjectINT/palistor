"use client";

import { Input } from "@/components/Input";
import { Section } from "../../shared/Section";
import { usePaymentForm } from "@/config/paymentForm";

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
          {...form.passport.number}
          className="md:col-span-2"
        />

        <Input
          {...form.passport.issueDate}
          type="date"
        />

        <Input
          {...form.passport.expiryDate}
          type="date"
        />
      </div>
      
      <div className="mt-2 text-sm text-gray-500">
        💡 Вложенные поля (nested fields). 
      </div>
    </Section>
  );
}
