"use client";

import { ThemeProvider as NextThemes } from "next-themes";

/*
  Claro/escuro pela classe `.dark` no <html>; o padrão segue o sistema.
  O script que evita o "piscar" do tema roda no HTML do servidor; no navegador ele vai como text/plain, porque o
  React 19 avisa quando um componente do cliente desenha um <script> executável.
*/
const scriptProps = { type: typeof window === "undefined" ? "text/javascript" : "text/plain" };

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return (
    <NextThemes attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange scriptProps={scriptProps}>
      {children}
    </NextThemes>
  );
}
