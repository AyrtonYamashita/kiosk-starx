"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { AutoHeight } from "@animate-ui/react/primitives/effects/auto-height";

/** Subcard que abre e fecha com a altura acompanhando o conteúdo (Auto Height do Animate UI). */
export function MoreInfo({ title, children }: { title: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="device-more">
      <button type="button" className="device-more-toggle" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <ChevronDown size={16} strokeWidth={1.75} aria-hidden className="device-more-chevron" />
        {title}
      </button>
      <AutoHeight deps={[open]} style={{ overflow: "hidden" }}>
        {open ? <div className="device-more-body">{children}</div> : <div />}
      </AutoHeight>
    </div>
  );
}
