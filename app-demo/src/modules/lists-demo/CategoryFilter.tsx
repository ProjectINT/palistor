"use client";

import { Button } from "@heroui/react";
import { useForm } from "@palistor";
import type { FieldProxyNode } from "@palistor";

const CATEGORIES = [
  { value: "", label: "All" },
  { value: "electronics", label: "Electronics" },
  { value: "furniture", label: "Furniture" },
];

/**
 * Buttons on the `categoryFilter` field. A pick is a plain write: the products
 * resolver read the field, so it runs again by itself.
 */
export function CategoryFilter({ field }: { field: FieldProxyNode<string> }) {
  const category = useForm(field);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-sm text-zinc-500 dark:text-zinc-400">{category.label}:</span>
      {CATEGORIES.map((option) => {
        const selected = category.value === option.value;
        return (
          <Button
            key={option.value}
            size="sm"
            radius="full"
            color={selected ? "primary" : "default"}
            variant={selected ? "solid" : "flat"}
            aria-pressed={selected}
            onPress={() => category.onValueChange(option.value)}
          >
            {option.label}
          </Button>
        );
      })}
    </div>
  );
}
