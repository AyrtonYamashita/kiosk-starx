import type { Metadata } from "next";
import { IBM_Plex_Mono, Inter, Space_Grotesk } from "next/font/google";
import { StarxBackground } from "@/components/brand/StarxBackground";
import { ThemeProvider } from "@/components/brand/ThemeProvider";
import "./globals.css";

// títulos e logotipo: Space Grotesk · interface: Inter · dado de máquina: IBM Plex Mono
// (o build da Vercel baixa e serve as fontes do próprio domínio)
const spaceGrotesk = Space_Grotesk({ subsets: ["latin"], weight: ["500", "700"], variable: "--font-space-grotesk", display: "swap" });
const inter = Inter({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-inter", display: "swap" });
const plexMono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-plex-mono", display: "swap" });

export const metadata: Metadata = {
  title: "Starx Kiosk",
  description: "Painel dos aparelhos StarX Kiosk",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" className={`${spaceGrotesk.variable} ${inter.variable} ${plexMono.variable}`} suppressHydrationWarning>
      <body>
        <ThemeProvider>
          <StarxBackground />
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
