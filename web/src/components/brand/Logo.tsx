/*
  Símbolo e logotipo Starx Kiosk (starx-kiosk-brand/assets/simbolo.svg): quatro cantos de mira e a estrela de quatro
  pontas girada 45°. Cores pelos tokens: cantos = --ink, estrela = --blue (claro #0A1A2F/#1560D4, escuro #E8EEF7/#5B9BF5).
*/
export function StarxSymbol({ size = 24, className }: { size?: number; className?: string }) {
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} className={className} aria-hidden focusable="false">
      <path
        d="M6 19V11a5 5 0 0 1 5-5h8M45 6h8a5 5 0 0 1 5 5v8M58 45v8a5 5 0 0 1-5 5h-8M19 58h-8a5 5 0 0 1-5-5v-8"
        fill="none"
        stroke="var(--ink)"
        strokeWidth={5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        transform="rotate(45 32 32)"
        fill="var(--blue)"
        d="M32 12C33.6 23.5 40.5 30.4 52 32C40.5 33.6 33.6 40.5 32 52C30.4 40.5 23.5 33.6 12 32C23.5 30.4 30.4 23.5 32 12Z"
      />
    </svg>
  );
}

/** Símbolo + "Starx Kiosk" (Space Grotesk 700; "Kiosk" em 500 na cor de marca). Respiro = 1/4 da altura do símbolo. */
export function StarxLogo({ size = 24, className }: { size?: number; className?: string }) {
  return (
    <span className={`starx-logo${className ? ` ${className}` : ""}`} style={{ gap: size / 4, fontSize: Math.round(size * 0.72) }}>
      <StarxSymbol size={size} />
      <span>
        Starx <span className="kiosk">Kiosk</span>
      </span>
    </span>
  );
}
