import type { MetadataRoute } from "next";

/** Manifesto do app: permite instalar o painel no celular (tela inicial, sem barra do navegador). */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Starx Kiosk",
    short_name: "Starx Kiosk",
    description: "Painel dos aparelhos StarX Kiosk",
    lang: "pt-BR",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#F8FAFC",
    theme_color: "#0A1A2F",
    icons: [
      { src: "/icon1.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon2.png", sizes: "512x512", type: "image/png", purpose: "any" },
    ],
  };
}
