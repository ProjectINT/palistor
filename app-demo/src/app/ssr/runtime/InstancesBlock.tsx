"use client";

import { useTranslations } from "next-intl";
import { useForm, usePalistor } from "@palistor";
import type { FieldProxyNode, PalistorProxy } from "@palistor";

import { Block, Counter } from "../shared/Block";
import type { Teammate } from "./backend";
import { teammateConfig } from "./runtimeConfig";
import { Button, Panel } from "./ui";

/** Block 3. One component, rendered once per teammate the server page passed. */
export function InstancesBlock({ teammates }: { teammates: Teammate[] }) {
  const t = useTranslations("ssr.runtime.instances");

  return (
    <Block testId="runtime-instances" title={t("title")} hint={t("hint")}>
      <div className="grid gap-3 sm:grid-cols-2">
        {/* A new teammate is a new instance (key), and so a new store with its data. */}
        {teammates.map((teammate) => (
          <TeammateCard key={teammate.id} teammate={teammate} />
        ))}
      </div>
    </Block>
  );
}

const INPUT =
  "w-full px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-sm text-zinc-900 dark:text-zinc-100";

function TeammateCard({ teammate }: { teammate: Teammate }) {
  // A store per instance: this card's props go into this card's constructor,
  // and nowhere else. The function runs once, when the store is built.
  const store = usePalistor(() => ({
    config: teammateConfig,
    context: { teammateId: teammate.id },
    initialData: { teammate: { name: teammate.name, role: teammate.role } },
  }));
  // Only navigates: the card's group goes down as a prop.
  const form = useForm(store);
  const prefix = `runtime-teammate-${teammate.id}`;

  return (
    <Panel testId={prefix} title={teammate.id}>
      <TeammateFields teammate={form.teammate} prefix={prefix} />
      <div className="text-xs text-zinc-400 dark:text-zinc-500">
        <Counter event={`runtime.teammate.${teammate.id}`} testId={`${prefix}-requests`} />
      </div>
    </Panel>
  );
}

function TeammateFields({ teammate, prefix }: { teammate: PalistorProxy<Omit<Teammate, "id">>; prefix: string }) {
  const t = useTranslations("ssr.runtime.instances");
  // Reads the group's `dirty`: re-renders when it flips, not on every keystroke.
  const card = useForm(teammate);

  return (
    <>
      <CardField field={card.name} testId={`${prefix}-name`} />
      <CardField field={card.role} testId={`${prefix}-role`} />
      <div className="flex items-center justify-between gap-2">
        <span
          data-testid={`${prefix}-dirty`}
          className={`text-xs font-medium ${
            card.dirty ? "text-amber-600 dark:text-amber-400" : "text-zinc-400 dark:text-zinc-500"
          }`}
        >
          {card.dirty ? t("edited") : t("asServed")}
        </span>
        {/* initialData is the baseline: reset() returns to what the server sent. */}
        <Button testId={`${prefix}-reset`} onClick={() => card.reset()}>
          {t("reset")}
        </Button>
      </div>
    </>
  );
}

function CardField({ field, testId }: { field: FieldProxyNode<string>; testId: string }) {
  const f = useForm(field);

  return (
    <label className="block">
      <span className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1">{f.label}</span>
      <input data-testid={testId} value={f.value} onChange={(e) => f.onValueChange(e.target.value)} className={INPUT} />
    </label>
  );
}
