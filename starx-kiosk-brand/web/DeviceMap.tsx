"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";
import { useTheme } from "next-themes";

/*
  Mapa de fundo da página do dispositivo (fundo da página inteira: o elemento pai deve ocupar a tela toda (relative, 100vw × 100vh) e o menu lateral e os cards ficam por cima).
  Estilo vetorial no esquema OpenMapTiles: escuro = "Dark Matter"; no modo claro, um estilo claro do mesmo esquema.
  As URLs vêm de NEXT_PUBLIC_MAP_STYLE_DARK e NEXT_PUBLIC_MAP_STYLE_LIGHT (ver .env.example). Sem elas, a página
  mantém o iframe do OpenStreetMap que já existe e o Bubble fica de fundo.
  Rascunho: ajuste ao estilo escolhido (fontes e sprites do estilo precisam ser servidos).
*/
export function DeviceMap({ lat, lon, accuracyM }: { lat: number; lon: number; accuracyM: number | null }) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const { resolvedTheme } = useTheme();
  const style = resolvedTheme === "dark" ? process.env.NEXT_PUBLIC_MAP_STYLE_DARK : process.env.NEXT_PUBLIC_MAP_STYLE_LIGHT;

  useEffect(() => {
    if (!el.current || !style) return;
    const m = new maplibregl.Map({ container: el.current, style, center: [lon, lat], zoom: 16, attributionControl: { compact: true } });
    map.current = m;
    const pin = document.createElement("div");
    pin.className = "device-pin"; // estilize no CSS: círculo azul (--blue) com borda e pulso
    new maplibregl.Marker({ element: pin }).setLngLat([lon, lat]).addTo(m);
    return () => m.remove();
    // recria o mapa ao trocar de tema: simples e sem estado extra
  }, [style, lat, lon]);

  if (!style) return null;
  return <div ref={el} className="absolute inset-0 -z-0" role="img" aria-label={`Mapa da última posição${accuracyM ? `, precisão de ${Math.round(accuracyM)} metros` : ""}`} />;
}
