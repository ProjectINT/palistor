"use client";

import { useTranslations } from "next-intl";
import type { FieldProxyNode } from "@palistor";

import { TextField } from "@/components/TextField";
import { Section } from "@/modules/shared/Section";

export function CommentSection({ comment }: { comment: FieldProxyNode<string> }) {
  const t = useTranslations();

  return (
    <Section title={t("sections.comment")}>
      <TextField field={comment} />
    </Section>
  );
}
