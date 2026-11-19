"use client";

import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import { AnimateIcon } from "@animate-ui/react/icons";
import { Sun } from "@/components/animate-ui/icons/sun";
import { Moon } from "@/components/animate-ui/icons/moon";

/* Alterna claro/escuro (o padrão segue o sistema). Alvo de 44 px. */
export function ThemeToggle({ className }: { className?: string }) {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const dark = mounted && resolvedTheme === "dark";
  return (
    <AnimateIcon animateOnHover animateOnTap asChild>
      <button
        type="button"
        aria-label={dark ? "Ativar modo claro" : "Ativar modo escuro"}
        title={dark ? "Modo claro" : "Modo escuro"}
        onClick={() => setTheme(dark ? "light" : "dark")}
        className={`theme-toggle${className ? ` ${className}` : ""}`}
      >
        {dark ? <Sun size={20} aria-hidden /> : <Moon size={20} aria-hidden />}
      </button>
    </AnimateIcon>
  );
}
