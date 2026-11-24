"use client";

import { Button } from "@heroui/react";
import { useTranslations } from "next-intl";
import { useForm } from "@palistor";
import type { PalistorProxy } from "@palistor";

import type { PaymentFormValues } from "@/config/appConfig";

/** Submit, reset and fill the whole form: the root node, handed down by PaymentForm. */
export function FormActions({ form }: { form: PalistorProxy<PaymentFormValues> }) {
  const t = useTranslations();
  // Reads the form's own flags only: re-renders when `dirty` or `submitting` flips, not on every edit.
  const f = useForm(form);

  const pay = async () => {
    // Invalid input resolves as { success: false, errors } and leaves onSubmit uncalled.
    const result = await f.submit();
    if (result.success) alert("Form submitted!\n\n" + JSON.stringify(result.result, null, 2));
    else alert("Form submission failed!\n\n" + JSON.stringify(result.errors, null, 2));
  };

  const fillDemoData = () => {
    f.setValues({ name: "John Doe", email: "john@example.com", phone: "+1234567890", country: "us", city: "newyork" });
  };

  return (
    <div className="space-y-3 border-t border-zinc-200 pt-4 dark:border-zinc-800">
      <div className="flex flex-wrap gap-3">
        <Button color="primary" isLoading={f.submitting} isDisabled={f.submitting} onPress={pay}>
          {t("buttons.pay")}
        </Button>
        <Button variant="flat" isDisabled={f.submitting} onPress={() => f.reset()}>
          {t("buttons.reset")}
        </Button>
        <Button variant="bordered" color="secondary" isDisabled={f.submitting} onPress={fillDemoData}>
          Fill Demo Data
        </Button>
      </div>

      {f.dirty && <p className="text-xs text-amber-600 dark:text-amber-400">⚡ {t("form.unsavedChanges")}</p>}

      <p className="text-xs text-zinc-400 dark:text-zinc-500">
        💡 <code className="font-mono">form.setValues(patch)</code> — bulk update ·{" "}
        <code className="font-mono">form.reset()</code> — restore initial values
      </p>
    </div>
  );
}
