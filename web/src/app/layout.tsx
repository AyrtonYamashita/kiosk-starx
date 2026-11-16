import type { Metadata } from "next";
import { IBM_Plex_Mono, Outfit } from "next/font/google";
import "./globals.css";

// texto: Outfit · dado de máquina: IBM Plex Mono (o build da Vercel baixa e serve as fontes do próprio domínio)
const outfit = Outfit({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-outfit", display: "swap" });
const plexMono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-plex-mono", display: "swap" });

export const metadata: Metadata = {
  title: "StarX Kiosk",
  description: "Painel dos aparelhos StarX Kiosk",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" className={`${outfit.variable} ${plexMono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
