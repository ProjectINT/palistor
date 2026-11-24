"use client";

import { Button } from "@heroui/react";

import type { Locale } from "@/i18n/locale";

const OPTIONS: ReadonlyArray<{ locale: Locale; label: string }> = [
  { locale: "ru", label: "🇷🇺 RU" },
  { locale: "en", label: "🇺🇸 EN" },
];

interface LocaleSwitcherProps {
  locale: Locale;
  onLocaleChange: (locale: Locale) => void;
}

export function LocaleSwitcher({ locale, onLocaleChange }: LocaleSwitcherProps) {
  return (
    <div className="flex gap-2">
      {OPTIONS.map((option) => (
        <Button
          key={option.locale}
          size="sm"
          color={option.locale === locale ? "primary" : "default"}
          variant={option.locale === locale ? "solid" : "flat"}
          onPress={() => onLocaleChange(option.locale)}
        >
          {option.label}
        </Button>
      ))}
    </div>
  );
}
