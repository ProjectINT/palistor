"use client";

import { useTranslations } from "next-intl";
import { Button } from "@/components/Button";

import { paymentStore, usePaymentForm } from "@/config/appConfig";

export function FormActions() {
  const t = useTranslations();
  const form = usePaymentForm();

  const handleSubmit = async () => {
    const values = paymentStore.getValues();
    const res = await form.submit();
    if (res.errors.length > 0) {
      console.error('Submit errors:', res.errors);
      alert("Ошибка при отправке формы!\n\n" + JSON.stringify(res.errors, null, 2));
      return;
    }

    alert("Форма отправлена!\n\n" + JSON.stringify(values, null, 2));
  };

  const handleReset = () => {
    form.reset();
  };

  const handleFillDemoData = () => {
    form.setValues({
      name: "John Doe",
      email: "john@example.com",
      phone: "+1234567890",
      country: "us",
      city: "newyork",
    });
  };

  const isDirty: boolean = form.dirty;
  const isSubmitting: boolean = form.submitting;

  return (
    <div className="space-y-3 pt-4 border-t border-zinc-200 dark:border-zinc-800">
      <div className="flex flex-wrap gap-3">
        <Button
          type="submit"
          color="primary"
          isLoading={isSubmitting}
          isDisabled={isSubmitting}
          onPress={handleSubmit}
        >
          {t("buttons.pay")}
        </Button>

        <Button
          variant="flat"
          color="default"
          isDisabled={isSubmitting}
          onPress={handleReset}
        >
          {t("buttons.reset")}
        </Button>

        <Button
          variant="bordered"
          color="secondary"
          isDisabled={isSubmitting}
          onPress={handleFillDemoData}
        >
          Fill Demo Data
        </Button>
      </div>

      {isDirty && (
        <p className="text-xs text-amber-600 dark:text-amber-400">
          ⚡ {t("form.unsavedChanges")}
        </p>
      )}

      <p className="text-xs text-zinc-400 dark:text-zinc-500">
        💡 <code className="font-mono">form.setValues(patch)</code> — bulk update · <code className="font-mono">form.reset()</code> — restore initial values
      </p>
    </div>
  );
}

