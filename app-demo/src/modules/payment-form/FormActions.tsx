"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/Button";

import { paymentStore, usePaymentForm } from "@/config/appConfig";

export function FormActions() {
  const t = useTranslations();

  const { submit } = usePaymentForm();

  const handleSubmit = async () => {
    const values = paymentStore.getValues();
    const res = await submit();
    if (res.errors.length > 0) {
      console.error('Submit errors:', res.errors);
      alert("Ошибка при отправке формы!\n\n" + JSON.stringify(res.errors, null, 2));
      return;
    }

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

