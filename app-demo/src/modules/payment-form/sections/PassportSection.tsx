"use client";

import { useState } from "react";
import { Input } from "@/components/Input";
import { Button } from "@/components/Button";
import { Section } from "../../shared/Section";
import { usePaymentForm } from "@/config/appConfig";

export function PassportSection() {
  const form = usePaymentForm();
  const [submitStatus, setSubmitStatus] = useState<"idle" | "success" | "error">("idle");
  const [submitError, setSubmitError] = useState<string | null>(null);

  // The passport is visible only when paymentType === "bank"
  if (!form.passport.isVisible) return null;

  const handleSubmit = async () => {
    setSubmitStatus("idle");
    setSubmitError(null);
    const res = await form.passport.submit();
    if (res.errors.length > 0) {
      setSubmitStatus("error");
      setSubmitError(res.errors.map((e: any) => e.message ?? String(e)).join(", "));
    } else {
      setSubmitStatus("success");
    }
  };

  const handleReset = () => {
    form.passport.reset();
    setSubmitStatus("idle");
    setSubmitError(null);
  };

  const isDirty: boolean = form.passport.dirty;
  const isSubmitting: boolean = form.passport.submitting;
  const isInvalid: boolean = form.passport.isInvalid;

  return (
    <Section title="Passport Information">
      {/* State badges */}
      <div className="flex flex-wrap gap-2 mb-3">
        {isDirty && (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-500 inline-block" />
            Unsaved changes
          </span>
        )}
        {isInvalid && (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300">
            Invalid
          </span>
        )}
        {submitStatus === "success" && (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300">
            ✓ Saved
          </span>
        )}
        {submitStatus === "error" && (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300">
            ✕ {submitError ?? "Error"}
          </span>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Dirty dot on dirty fields */}
        <div className="md:col-span-2 relative">
          {form.passport.number.dirty && (
            <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-amber-400 z-10" title="Field changed" />
          )}
          <Input {...form.passport.number} />
        </div>

        <div className="relative">
          {form.passport.issueDate.dirty && (
            <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-amber-400 z-10" title="Field changed" />
          )}
          <Input {...form.passport.issueDate} type="date" />
        </div>

        <div className="relative">
          {form.passport.expiryDate.dirty && (
            <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-amber-400 z-10" title="Field changed" />
          )}
          <Input {...form.passport.expiryDate} type="date" />
        </div>
      </div>

      {/* Submit / Reset buttons */}
      <div className="flex items-center gap-3 mt-4">
        <Button
          color="primary"
          size="sm"
          isLoading={isSubmitting}
          isDisabled={isInvalid || isSubmitting}
          onPress={handleSubmit}
        >
          Save Passport
        </Button>
        <Button
          variant="flat"
          size="sm"
          isDisabled={isSubmitting}
          onPress={handleReset}
        >
          Reset Passport
        </Button>
      </div>

      <div className="mt-2 text-xs text-zinc-400 dark:text-zinc-500 space-y-0.5">
        <p>💡 Group submit pipeline: <code className="font-mono bg-zinc-100 dark:bg-zinc-800 px-1 rounded">form.passport.submit()</code></p>
        <p>State: dirty=<code className="font-mono">{String(isDirty)}</code> submitting=<code className="font-mono">{String(isSubmitting)}</code> isInvalid=<code className="font-mono">{String(isInvalid)}</code></p>
      </div>
    </Section>
  );
}
