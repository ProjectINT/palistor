"use client";

import type { ReactNode } from "react";
import { useForm } from "@palistor";
import type { FieldProxyNode } from "@palistor";

import { Section } from "@/modules/shared/Section";

interface BranchSectionProps {
  title: string;
  /** A field of the branch: the section is shown while this field is. */
  shownWith: FieldProxyNode<string>;
  children: ReactNode;
}

/**
 * A section of one payment method. The config is flat, so there is no group
 * to hide: the section follows the `isVisible` of one of its fields instead
 * of repeating the rule. Only this wrapper subscribes to that field; the
 * inputs inside come from the parent and do not re-render with it.
 */
export function BranchSection({ title, shownWith, children }: BranchSectionProps) {
  const { isVisible } = useForm(shownWith);
  return isVisible ? <Section title={title}>{children}</Section> : null;
}
