"use client";

import { usePathname } from "next/navigation";
import { useTheme } from "next-themes";
import { useHydrated } from "@/lib/client";
import { BubbleBackground } from "@/components/animate-ui/backgrounds/bubble";

/*
  Fundo de TODAS as páginas (uma vez no layout raiz). Monocromático nos dois modos: seis tons do mesmo azul
  (o componente pede "r,g,b"). O gradiente de base do componente (violeta → azul) é trocado pelo do brand
  (--bubble-from → --bubble-to). `interactive` só no login. Com movimento reduzido o Bubble para sozinho.
  A página do dispositivo com localização põe o mapa por cima (o Bubble fica escondido atrás dele).
*/
const LIGHT = { first: "21,96,212", second: "91,155,245", third: "15,77,176", fourth: "141,187,250", fifth: "56,120,224", sixth: "110,170,248" };
const DARK = { first: "10,50,120", second: "8,38,92", third: "15,70,160", fourth: "6,28,70", fifth: "21,96,212", sixth: "10,50,120" };

export function StarxBackground() {
  const { resolvedTheme } = useTheme();
  const path = usePathname();
  const dark = useHydrated() && resolvedTheme === "dark";

  return (
    <BubbleBackground
      interactive={path.startsWith("/login")}
      colors={dark ? DARK : LIGHT}
      className="starx-bg fixed inset-0 -z-10 bg-none bg-linear-to-br from-(--bubble-from) to-(--bubble-to)"
      aria-hidden
    />
  );
}
