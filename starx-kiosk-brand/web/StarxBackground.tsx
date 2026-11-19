"use client";

import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
// instalado por: npx shadcn@latest add @animate-ui/backgrounds-bubble
import { BubbleBackground } from "@/components/animate-ui/backgrounds/bubble";

/*
  Fundo de TODAS as páginas. Monocromático nos dois modos: seis tons do mesmo azul (o componente pede "r,g,b", não hex).
  O componente traz um gradiente de base próprio: o className abaixo precisa sobrescrevê-lo (confira no arquivo instalado
  e ajuste a opacidade das bolhas se o resultado ficar forte demais por trás das tabelas).
  `interactive` só na tela de login (a sexta bolha segue o mouse); nas demais fica desligado.
*/
const LIGHT = { first: "21,96,212", second: "91,155,245", third: "15,77,176", fourth: "141,187,250", fifth: "56,120,224", sixth: "110,170,248" };
// escuro: tons profundos; o azul só sugere. Se ainda dominar, baixe a opacidade das bolhas no className.
const DARK = { first: "10,50,120", second: "8,38,92", third: "15,70,160", fourth: "6,28,70", fifth: "21,96,212", sixth: "10,50,120" };

export function StarxBackground({ interactive = false }: { interactive?: boolean }) {
  const { resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const dark = mounted ? resolvedTheme === "dark" : false;

  return (
    <BubbleBackground
      interactive={interactive}
      colors={dark ? DARK : LIGHT}
      className="fixed inset-0 -z-10 bg-none bg-linear-to-br from-[var(--bubble-from)] to-[var(--bubble-to)] motion-reduce:[&_*]:!animate-none"
      aria-hidden
    />
  );
}
