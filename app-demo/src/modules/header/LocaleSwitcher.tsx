"use client";

import { Button } from "@/components/Button";

type Locale = "ru" | "en";

interface LocaleSwitcherProps {
  locale: Locale;
  onLocaleChange: (locale: Locale) => void;
}

export function LocaleSwitcher({ locale, onLocaleChange }: LocaleSwitcherProps) {
  return (
    <div className="flex gap-2">
      <Button
        color={locale === "ru" ? "primary" : "default"}
        variant={locale === "ru" ? "solid" : "flat"}
        size="sm"
        onClick={() => onLocaleChange("ru")}
      >
        🇷🇺 RU
      </Button>
      <Button
        color={locale === "en" ? "primary" : "default"}
        variant={locale === "en" ? "solid" : "flat"}
        size="sm"
        onClick={() => onLocaleChange("en")}
      >
        🇺🇸 EN
      </Button>
    </div>
  );
}
