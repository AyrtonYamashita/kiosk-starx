/* Renderize uma vez na página do dispositivo. O filtro distorce o que está atrás do card (o mapa), o que dá a refração. */
export function LiquidGlassDefs() {
  return (
    <svg width="0" height="0" className="absolute" aria-hidden>
      <filter id="liquid-glass" x="0" y="0" width="100%" height="100%" colorInterpolationFilters="sRGB">
        <feTurbulence type="fractalNoise" baseFrequency="0.008 0.012" numOctaves={2} seed={7} result="n" />
        <feGaussianBlur in="n" stdDeviation={3} result="nb" />
        <feDisplacementMap in="SourceGraphic" in2="nb" scale={26} xChannelSelector="R" yChannelSelector="G" />
      </filter>
    </svg>
  );
}
