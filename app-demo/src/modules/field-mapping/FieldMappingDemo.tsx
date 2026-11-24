"use client";

import { useForm } from "@palistor";

import { NativeField } from "@/components/NativeField";
import { mappingStore, uiFieldMapping } from "@/config/fieldMapping";
import { Badge } from "@/modules/shared";
import { MappingTable } from "./MappingTable";

const RENAMED = new Set<string>(Object.values(uiFieldMapping));

const CONFIG_SAMPLE = `fieldMapping: { isRequired: "required", isReadOnly: "readOnly",
                errorMessage: "helperText", description: "helpText", … }

// the config, in the map's names:
email: { value: "", label: "Email",
         required: true,                // not isRequired
         helpText: "We never share it" } // not description

// reads, in the same names:
form.email.required   // true
form.email.helperText // the validation message`;

/**
 * The root of the tab: the only component that sees the store.
 *
 * The fields are spread here instead of being handed to child components: a
 * field of a mapped store carries the renamed props, so it is not a
 * FieldProxyNode and `useForm(field)` in a child does not compile
 * (palistor-field-mapping skill, "useForm(subtree) in a mapped store"). The
 * price is that an edit re-renders this component.
 */
export function FieldMappingDemo() {
  const form = useForm(mappingStore);
  // What a field spread carries, setters left out: the map's names, not palistor's.
  const spreadKeys = Object.entries({ ...form.email })
    .filter(([, prop]) => typeof prop !== "function")
    .map(([key]) => key);

  return (
    <div className="bg-white dark:bg-zinc-900 rounded-xl shadow-sm border border-zinc-200 dark:border-zinc-800 p-6 space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100">Field Mapping</h2>
        <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
          A single public vocabulary of field names: the config is <b>written</b> in the same names it is{" "}
          <b>read</b> with. Each field spreads into one adapter that uses those names.
        </p>
      </div>

      <div className="rounded-lg bg-zinc-900 dark:bg-black p-4 overflow-auto">
        <pre className="text-xs leading-relaxed text-zinc-300">{CONFIG_SAMPLE}</pre>
      </div>

      <MappingTable mapping={uiFieldMapping} />

      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-medium text-zinc-500 dark:text-zinc-400">{"<NativeField {...form.email} />"}</h3>
          <Badge color="green">plain spread</Badge>
        </div>

        <NativeField {...form.email} type="email" />
        <NativeField {...form.password} type="password" />
        <NativeField {...form.nickname} />

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => void form.submit()}
            className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium transition-colors"
          >
            Submit (trigger validation)
          </button>
          <p className="text-xs text-zinc-400">
            Errors show from the first submit on, as <code>error</code> and <code>helperText</code>.
          </p>
        </div>
      </div>

      <div>
        <div className="flex items-center gap-2 mb-2">
          <h3 className="text-sm font-medium text-zinc-500 dark:text-zinc-400">{"Object.keys({ ...form.email })"}</h3>
          <Badge color="blue">live</Badge>
        </div>
        <div className="flex flex-wrap gap-1.5 mb-3">
          {spreadKeys.map((key) => (
            <span
              key={key}
              className={`px-2 py-0.5 rounded text-xs font-mono ${
                RENAMED.has(key)
                  ? "bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300 font-semibold"
                  : "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400"
              }`}
            >
              {key}
            </span>
          ))}
        </div>
        <p className="text-xs text-zinc-400 dark:text-zinc-500">
          The highlighted keys are the ones renamed by the map. The internal names (<code>isRequired</code>,{" "}
          <code>isInvalid</code>, <code>errorMessage</code>) are no longer in the spread.
        </p>
      </div>
    </div>
  );
}
