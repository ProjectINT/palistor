"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/Button";

import { paymentStore } from "@/config/paymentForm";

export function FormActions() {
  const t = useTranslations();
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    const values = paymentStore.getValues();
    console.log("[onSubmit] Form values:", values);
    setSubmitting(true);
    await new Promise((resolve) => setTimeout(resolve, 1500));
    setSubmitting(false);
    alert("Форма отправлена!\n\n" + JSON.stringify(values, null, 2));
  };

  return (
    <div className="flex gap-4 pt-4 border-t border-zinc-200 dark:border-zinc-800">
      <Button
        type="submit"
        color="primary"
        isLoading={submitting}
        onClick={handleSubmit}
      >
        {t("buttons.pay")}
      </Button>
    </div>
  );
}

