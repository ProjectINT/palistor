"use client";

import { Button } from "@/components/ui";

type Locale = "ru" | "en";

interface LocaleSwitcherProps {
  locale: Locale;
  onLocaleChange: (locale: Locale) => void;
}

export function LocaleSwitcher({ locale, onLocaleChange }: LocaleSwitcherProps) {
  return (
    <div className="flex gap-2">
      <Button
        variant={locale === "ru" ? "primary" : "secondary"}
        size="sm"
        onClick={() => onLocaleChange("ru")}
      >
        🇷🇺 RU
      </Button>
      <Button
        variant={locale === "en" ? "primary" : "secondary"}
        size="sm"
        onClick={() => onLocaleChange("en")}
      >
        🇺🇸 EN
      </Button>
    </div>
  );
}
