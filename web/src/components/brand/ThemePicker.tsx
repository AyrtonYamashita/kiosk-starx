"use client";

import { useTheme } from "next-themes";
import { useHydrated } from "@/lib/client";

const OPTIONS = [
  { value: "light", label: "Claro" },
  { value: "dark", label: "Escuro" },
  { value: "system", label: "Sistema" },
] as const;

/** Aparência do painel (fica em Conta): claro, escuro ou seguir o sistema. Vale para este navegador. */
export function ThemePicker() {
  const { theme, setTheme } = useTheme();
  const current = useHydrated() ? (theme ?? "system") : null;
  return (
    <div className="segmented" role="radiogroup" aria-label="Aparência do painel">
      {OPTIONS.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={current === o.value}
          className={current === o.value ? "on" : undefined}
          onClick={() => setTheme(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
