"use client";

import type { ReactNode } from "react";
import { Tabs, TabsContent, TabsContents, TabsHighlight, TabsHighlightItem, TabsList, TabsTrigger } from "@animate-ui/react/primitives/tabs";

/**
 * Abas de texto sublinhadas da página do dispositivo (Comandos · Leitura SSW · Apps · JSON), com o Tabs do
 * Animate UI: o sublinhado desliza até a aba escolhida e o conteúdo troca com o próprio movimento do componente.
 * O conteúdo fica limitado a 340 px e rola por dentro.
 */
export function UnderlineTabs({ tabs, label = "Seções", className }: { tabs: { value: string; label: string; content: ReactNode }[]; label?: string; className?: string }) {
  return (
    <Tabs defaultValue={tabs[0].value} className={`device-tabs${className ? ` ${className}` : ""}`}>
      <TabsHighlight className="device-tabs-underline inset-0">
        <TabsList className="device-tabs-list" aria-label={label}>
          {tabs.map((t) => (
            <TabsHighlightItem key={t.value} value={t.value}>
              <TabsTrigger value={t.value} className="device-tab">
                {t.label}
              </TabsTrigger>
            </TabsHighlightItem>
          ))}
        </TabsList>
      </TabsHighlight>
      <TabsContents className="device-tabs-contents">
        {tabs.map((t) => (
          <TabsContent key={t.value} value={t.value} className="device-tab-panel">
            {t.content}
          </TabsContent>
        ))}
      </TabsContents>
    </Tabs>
  );
}
