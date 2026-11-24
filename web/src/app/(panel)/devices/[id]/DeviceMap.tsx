"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useLayoutEffect, useRef } from "react";
import * as maplibregl from "maplibre-gl";
import { useTheme } from "next-themes";
import { useHydrated } from "@/lib/client";

/*
  Mapa de fundo da página do dispositivo (a tela toda, atrás do menu e dos cards).
  Estilos vetoriais do OpenFreeMap (esquema OpenMapTiles, sem chave): escuro = "dark", claro = "positron".
  Dá para trocar por outro provedor ou tiles próprios em NEXT_PUBLIC_MAP_STYLE_DARK / NEXT_PUBLIC_MAP_STYLE_LIGHT.
  As cores do marcador e do círculo de precisão vêm dos tokens (--blue).
*/
const STYLE = {
  dark: process.env.NEXT_PUBLIC_MAP_STYLE_DARK || "https://tiles.openfreemap.org/styles/dark",
  light: process.env.NEXT_PUBLIC_MAP_STYLE_LIGHT || "https://tiles.openfreemap.org/styles/positron",
};

// o worker é servido de public/vendor (copiado de node_modules no predev/prebuild): o bundler não o encontra sozinho
maplibregl.setWorkerUrl(`/vendor/maplibre-gl-worker.mjs?v=${maplibregl.getVersion()}`);

/** Polígono (64 lados) do círculo de precisão, em metros. */
function circle(lat: number, lon: number, meters: number): GeoJSON.Feature<GeoJSON.Polygon> {
  const pts: [number, number][] = [];
  const dLat = meters / 110_540;
  const dLon = meters / (111_320 * Math.cos((lat * Math.PI) / 180));
  for (let i = 0; i <= 64; i++) {
    const a = (i / 64) * 2 * Math.PI;
    pts.push([lon + dLon * Math.cos(a), lat + dLat * Math.sin(a)]);
  }
  return { type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [pts] } };
}

/** Espaço livre entre as colunas (o marcador fica no meio dele): mesma conta do CSS (.device-page). */
function padding(): maplibregl.PaddingOptions {
  if (window.innerWidth < 1280) return { top: 0, bottom: 0, left: 0, right: 0 };
  return { top: 24, bottom: 120, left: 736, right: 480 };
}

export function DeviceMap({ lat, lon, accuracyM }: { lat: number; lon: number; accuracyM: number | null }) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const marker = useRef<maplibregl.Marker | null>(null);
  const { resolvedTheme } = useTheme();
  const style = useHydrated() ? (resolvedTheme === "dark" ? STYLE.dark : STYLE.light) : null;
  const pos = useRef({ lat, lon, accuracyM });
  useLayoutEffect(() => {
    pos.current = { lat, lon, accuracyM };
  }, [lat, lon, accuracyM]);

  // cria o mapa (de novo ao trocar de tema: simples e sem estado extra)
  useEffect(() => {
    if (!el.current || !style) return;
    const { lat: la, lon: lo } = pos.current;
    const m = new maplibregl.Map({
      container: el.current,
      style,
      center: [lo, la],
      zoom: 16,
      attributionControl: false,
      dragRotate: false,
      pitchWithRotate: false,
      locale: {
        "CooperativeGesturesHandler.MobileHelpText": "Use dois dedos para mover o mapa",
        "CooperativeGesturesHandler.WindowsHelpText": "Use Ctrl + rolagem para dar zoom no mapa",
        "CooperativeGesturesHandler.MacHelpText": "Use ⌘ + rolagem para dar zoom no mapa",
      },
    });
    m.touchZoomRotate.disableRotation();
    // celular: o mapa vira um card no meio da página; um dedo rola a página, dois movem o mapa. No desktop o mapa é
    // o fundo da tela e continua com um dedo/mouse.
    const mobile = window.matchMedia("(max-width: 1023.98px)");
    const syncGestures = () => (mobile.matches ? m.cooperativeGestures.enable() : m.cooperativeGestures.disable());
    syncGestures();
    mobile.addEventListener("change", syncGestures);
    m.setPadding(padding());
    m.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-left");
    map.current = m;

    const pin = document.createElement("div");
    pin.className = "device-pin";
    pin.setAttribute("aria-hidden", "true");
    marker.current = new maplibregl.Marker({ element: pin }).setLngLat([lo, la]).addTo(m);

    m.on("load", () => {
      const css = getComputedStyle(document.documentElement);
      const blue = css.getPropertyValue("--blue").trim();
      const { lat: a, lon: o, accuracyM: r } = pos.current;
      m.addSource("precisao", { type: "geojson", data: circle(a, o, Math.max(r ?? 0, 5)) });
      m.addLayer({ id: "precisao-fill", type: "fill", source: "precisao", paint: { "fill-color": blue, "fill-opacity": 0.14 } });
      m.addLayer({ id: "precisao-line", type: "line", source: "precisao", paint: { "line-color": blue, "line-opacity": 0.55, "line-width": 1.5 } });
    });

    const onResize = () => m.setPadding(padding());
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      mobile.removeEventListener("change", syncGestures);
      marker.current = null;
      map.current = null;
      m.remove();
    };
  }, [style]);

  // posição nova (atualização da página): move o marcador e o círculo sem recriar o mapa
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    marker.current?.setLngLat([lon, lat]);
    const src = m.getSource("precisao") as maplibregl.GeoJSONSource | undefined;
    src?.setData(circle(lat, lon, Math.max(accuracyM ?? 0, 5)));
    m.easeTo({ center: [lon, lat], duration: 600 });
  }, [lat, lon, accuracyM]);

  // a caixa de fora é fixa (tela toda; no celular, um card de 240 px na página); o maplibre põe position: relative no
  // próprio container, por isso o de dentro
  return (
    <div className="device-map">
      <div
        ref={el}
        className="device-map-canvas"
        role="img"
        aria-label={`Mapa da última posição do aparelho${accuracyM ? `, precisão de ${Math.round(accuracyM)} metros` : ""}`}
      />
    </div>
  );
}
