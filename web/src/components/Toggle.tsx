"use client";

import { Root as Switch, Thumb as SwitchThumb } from "@animate-ui/react/primitives/radix-ui/switch";

/*
  Liga/desliga do painel: Switch da Animate UI (Radix por baixo; o polegar desliza com a mola da Animate UI e
  achata ao pressionar). Dentro de um <form>, com `name`, envia `value` (padrão "on") quando ligado, como um
  checkbox. Dentro de <label className="check-label">, clicar no texto também liga/desliga.
*/
export function Toggle(props: React.ComponentProps<typeof Switch>) {
  return (
    <Switch className="toggle" {...props}>
      <SwitchThumb className="toggle-thumb" />
    </Switch>
  );
}
