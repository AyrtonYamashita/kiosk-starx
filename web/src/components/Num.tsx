"use client";

import { SlidingNumber } from "@animate-ui/react/primitives/texts/sliding-number";

/**
 * Número que desliza quando muda (Sliding Number do Animate UI), no formato pt-BR. Aparece já parado no primeiro
 * desenho (sem animar do zero) e só anima nas atualizações.
 */
export function Num({ value, decimals = 0, prefix, suffix, className }: { value: number; decimals?: number; prefix?: string; suffix?: string; className?: string }) {
  const v = Number.isFinite(value) ? value : 0;
  const pre = prefix?.replace(/ /g, " ");
  const suf = suffix?.replace(/ /g, " ");
  return (
    <span className={`num${className ? ` ${className}` : ""}`} aria-label={`${prefix ?? ""}${v.toLocaleString("pt-BR", { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}${suffix ?? ""}`}>
      {pre && <span aria-hidden>{pre}</span>}
      <SlidingNumber
        aria-hidden
        number={v}
        decimalPlaces={decimals}
        decimalSeparator=","
        thousandSeparator="."
        initiallyStable
      />
      {suf && <span aria-hidden>{suf}</span>}
    </span>
  );
}
