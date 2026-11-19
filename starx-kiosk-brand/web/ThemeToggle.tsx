"use client";

import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import { AnimateIcon } from "@animate-ui/react/icons";
// npx shadcn@latest add @animate-ui/icons-lucide-sun @animate-ui/icons-lucide-moon
import { Sun } from "@/components/animate-ui/icons/sun";
import { Moon } from "@/components/animate-ui/icons/moon";

/* Alterna claro/escuro. O padrão do app é seguir o sistema (ThemeProvider defaultTheme="system"). */
export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const dark = mounted && resolvedTheme === "dark";
  return (
    <AnimateIcon animateOnHover animateOnTap asChild>
      <button
        type="button"
        aria-label={dark ? "Ativar modo claro" : "Ativar modo escuro"}
        onClick={() => setTheme(dark ? "light" : "dark")}
        className="flex size-11 items-center justify-center rounded-field border border-line bg-surface text-ink"
      >
        {dark ? <Sun size={20} /> : <Moon size={20} />}
      </button>
    </AnimateIcon>
  );
}
