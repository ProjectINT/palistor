"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/Button";

import { paymentStore } from "@/config/paymentForm";

export function FormActions() {
  const t = useTranslations();

  const handleSubmit = async () => {
    const values = paymentStore.getValues();
    await new Promise((resolve) => setTimeout(resolve, 1500));
    alert("Форма отправлена!\n\n" + JSON.stringify(values, null, 2));
  };

  return (
    <div className="flex gap-4 pt-4 border-t border-zinc-200 dark:border-zinc-800">
      <Button
        type="submit"
        color="primary"
        onPress={handleSubmit}
      >
        {t("buttons.pay")}
      </Button>
    </div>
  );
}

