"use client";

import { useTranslations } from "next-intl";
import { useForm } from "@palistor";
import type { FieldProxyNode } from "@palistor";

import { TextField } from "@/components/TextField";
import { Section } from "@/modules/shared/Section";

interface ContactSectionProps {
  name: FieldProxyNode<string>;
  email: FieldProxyNode<string>;
  phone: FieldProxyNode<string>;
  lastModified: FieldProxyNode<number>;
}

export function ContactSection({ name, email, phone, lastModified }: ContactSectionProps) {
  const t = useTranslations();

  return (
    <Section title={t("sections.contact")}>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <TextField field={name} />
        <TextField field={email} type="email" />
        <div className="md:col-span-2">
          <TextField field={phone} type="tel" />
        </div>
      </div>
      <LastEmailChange field={lastModified} />
    </Section>
  );
}

/** The time `email`'s onChange handler wrote into `lastModified`. */
function LastEmailChange({ field }: { field: FieldProxyNode<number> }) {
  const t = useTranslations();
  const { value } = useForm(field);
  if (!value) return null;

  return (
    <p className="mt-2 text-xs text-zinc-400 dark:text-zinc-500">
      {t("onChange.lastModified")}{" "}
      <span className="font-mono text-zinc-500 dark:text-zinc-400">{new Date(value).toLocaleTimeString()}</span>
      <span className="ml-2 text-zinc-400 dark:text-zinc-600">— {t("onChange.description")}</span>
    </p>
  );
}
