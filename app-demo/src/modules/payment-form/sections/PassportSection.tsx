"use client";

import { useState, type ReactNode } from "react";
import { Button } from "@heroui/react";
import { useTranslations } from "next-intl";
import { useForm } from "@palistor";
import type { FieldProxyNode, PalistorProxy } from "@palistor";

import { TextField } from "@/components/TextField";
import type { PassportValues } from "@/config/appConfig";
import { Section } from "@/modules/shared/Section";

/** The outcome of the last "Save Passport": what `submit()` resolved or rejected with. */
type SaveStatus = { kind: "idle" } | { kind: "saved" } | { kind: "failed"; message: string };

const IDLE: SaveStatus = { kind: "idle" };

export function PassportSection({ passport }: { passport: PalistorProxy<PassportValues> }) {
  const t = useTranslations();
  // Reads the group's own state (visibility, dirty, submitting), none of its fields':
  // typing re-renders the inputs, not this section.
  const p = useForm(passport);
  const [status, setStatus] = useState<SaveStatus>(IDLE);

  if (!p.isVisible) return null;

  // Validates and submits this group only; the rest of the form takes no part.
  const save = async () => {
    setStatus(IDLE);
    try {
      const result = await p.submit();
      setStatus(
        result.success ? { kind: "saved" } : { kind: "failed", message: result.errors.map((e) => e.message).join(", ") },
      );
    } catch (error) {
      // onSubmit threw (the mock server failed): submit() rejects with that error.
      setStatus({ kind: "failed", message: error instanceof Error ? error.message : String(error) });
    }
  };

  const reset = () => {
    p.reset();
    setStatus(IDLE);
  };

  return (
    <Section title={t("sections.passport")}>
      <div className="mb-3 flex flex-wrap gap-2">
        {p.dirty && (
          <Badge tone="amber">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-amber-500" />
            Unsaved changes
          </Badge>
        )}
        {status.kind === "saved" && <Badge tone="green">✓ Saved</Badge>}
        {status.kind === "failed" && <Badge tone="red">✕ {status.message}</Badge>}
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <PassportField field={p.number} className="md:col-span-2" />
        <PassportField field={p.issueDate} type="date" />
        <PassportField field={p.expiryDate} type="date" />
      </div>

      <div className="mt-4 flex items-center gap-3">
        <Button color="primary" size="sm" isLoading={p.submitting} isDisabled={p.submitting} onPress={save}>
          Save Passport
        </Button>
        <Button variant="flat" size="sm" isDisabled={p.submitting} onPress={reset}>
          Reset Passport
        </Button>
      </div>

      <div className="mt-2 space-y-0.5 text-xs text-zinc-400 dark:text-zinc-500">
        <p>
          💡 Group submit pipeline:{" "}
          <code className="rounded bg-zinc-100 px-1 font-mono dark:bg-zinc-800">form.passport.submit()</code>
        </p>
        <p>
          State: dirty=<code className="font-mono">{String(p.dirty)}</code> submitting=
          <code className="font-mono">{String(p.submitting)}</code>
        </p>
      </div>
    </Section>
  );
}

interface PassportFieldProps {
  field: FieldProxyNode<string>;
  type?: string;
  className?: string;
}

/** An input with a dot in its corner while the field differs from its initial value. */
function PassportField({ field, type, className = "" }: PassportFieldProps) {
  const { dirty } = useForm(field);

  return (
    <div className={`relative ${className}`}>
      {dirty && <span className="absolute -right-1 -top-1 z-10 h-2 w-2 rounded-full bg-amber-400" title="Field changed" />}
      <TextField field={field} type={type} />
    </div>
  );
}

const BADGE_TONES = {
  amber: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
  green: "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300",
  red: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
};

function Badge({ tone, children }: { tone: keyof typeof BADGE_TONES; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-medium ${BADGE_TONES[tone]}`}>
      {children}
    </span>
  );
}
