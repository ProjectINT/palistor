"use client";

import { useState } from "react";

import { NativeField } from "@/components/NativeField";
import { Badge } from "@/modules/shared";
import { useMappingForm, mappingStore } from "@/config/fieldMapping";
import { MappingTable } from "./MappingTable";

// Внутренние имена, которые переименовываются картой — подсвечиваем их в инспекторе
const RENAMED_EXTERNAL = new Set(["required", "disabled", "readOnly", "error", "helperText", "helpText"]);

export function FieldMappingDemo() {
  const form = useMappingForm();
  const [submitted, setSubmitted] = useState(false);

  // Живой снимок того, что реально видно через spread одного поля.
  // Ключи — уже external (переименованные): required, error, helperText…
  const spread = { ...form.email } as Record<string, unknown>;
  const spreadKeys = Object.keys(spread).filter((k) => typeof spread[k] !== "function");

  const handleSubmit = async () => {
    await mappingStore.submit();
    setSubmitted(true);
  };

  return (
    <div className="bg-white dark:bg-zinc-900 rounded-xl shadow-sm border border-zinc-200 dark:border-zinc-800 p-6 space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100">
          Field Mapping
        </h2>
        <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
          Переименование свойств поля под конвенцию UI-кита — прямо на границе proxy.
          Здесь поля спредятся в «нативный» компонент без единого адаптера.
        </p>
      </div>

      {/* Как настроен store */}
      <div className="rounded-lg bg-zinc-900 dark:bg-black p-4 overflow-auto">
        <pre className="text-xs leading-relaxed text-zinc-300">
{`new Palistor({
  config,
  fieldMapping: {
    isRequired:   "required",
    isDisabled:   "disabled",
    isReadOnly:   "readOnly",
    isInvalid:    "error",
    errorMessage: "helperText",
    description:  "helpText",
  },
});`}
        </pre>
      </div>

      <MappingTable />

      {/* Форма — спред external-имён прямо в компонент */}
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-medium text-zinc-500 dark:text-zinc-400">
            {"<NativeField {...form.field} />"}
          </h3>
          <Badge color="green">no adapters</Badge>
        </div>

        <NativeField {...form.email} />
        <NativeField {...form.password} />
        <NativeField {...form.nickname} />

        <button
          onClick={handleSubmit}
          className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium transition-colors"
        >
          Submit (trigger validation)
        </button>
        {submitted && (
          <p className="text-xs text-zinc-400">
            После submit пустые поля дают <code>error === true</code> и{" "}
            <code>helperText</code> — оба под external-именами.
          </p>
        )}
      </div>

      {/* Живой инспектор spread */}
      <div>
        <div className="flex items-center gap-2 mb-2">
          <h3 className="text-sm font-medium text-zinc-500 dark:text-zinc-400">
            {"Object.keys({ ...form.email })"}
          </h3>
          <Badge color="blue">live</Badge>
        </div>
        <div className="flex flex-wrap gap-1.5 mb-3">
          {spreadKeys.map((k) => (
            <span
              key={k}
              className={`px-2 py-0.5 rounded text-xs font-mono ${
                RENAMED_EXTERNAL.has(k)
                  ? "bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300 font-semibold"
                  : "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400"
              }`}
            >
              {k}
            </span>
          ))}
        </div>
        <p className="text-xs text-zinc-400 dark:text-zinc-500">
          Подсвеченные ключи — переименованные картой. Внутренних имён
          (<code>isRequired</code>, <code>isInvalid</code>, <code>errorMessage</code>)
          в spread больше нет.
        </p>
      </div>
    </div>
  );
}
