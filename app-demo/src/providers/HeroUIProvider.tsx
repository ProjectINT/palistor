"use client";

import { HeroUIProvider as Provider, ToastProvider } from "@heroui/react";
import { ThemeProvider as NextThemesProvider } from "next-themes";
import { useRouter } from "next/navigation";

export function HeroUIProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();

  return (
    <NextThemesProvider attribute="class" defaultTheme="system">
      <Provider navigate={router.push}>
        <ToastProvider />
        {children}
      </Provider>
    </NextThemesProvider>
  );
}
