"use client";

import { useTranslations } from "next-intl";
import { Input } from "@/components/Input";

import { Section } from "@/modules/shared/Section";
import { usePaymentForm } from "@/config/appConfig";

export function ContactSection() {
  const t = useTranslations();
  const form = usePaymentForm();
  const lastModified = (form as any).lastModified?.value as number | undefined;

  return (
    <Section title={t("sections.contact")}>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Input {...form.name} />
        <Input {...form.email} type="email" />
        <div className="md:col-span-2">
          <Input {...form.phone} type="tel" />
        </div>
      </div>
      {lastModified ? (
        <p className="mt-2 text-xs text-zinc-400 dark:text-zinc-500">
          {t("onChange.lastModified")}{" "}
          <span className="font-mono text-zinc-500 dark:text-zinc-400">
            {new Date(lastModified).toLocaleTimeString()}
          </span>
          <span className="ml-2 text-zinc-400 dark:text-zinc-600">
            — {t("onChange.description")}
          </span>
        </p>
      ) : null}
    </Section>
  );
}
