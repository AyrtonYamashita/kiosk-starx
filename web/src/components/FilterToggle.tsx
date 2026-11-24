"use client";

import { useState, type ReactNode } from "react";
import { ChevronDown, SlidersHorizontal } from "lucide-react";

/**
 * Botão "Filtros (n ativos)" que recolhe os filtros no celular (abaixo de 1024 px). No desktop o botão não aparece e
 * os filtros ficam sempre abertos (o CSS ignora o estado). `controls` é o id do bloco que ele abre e fecha.
 */
export function FilterToggle({ open, onToggle, count, controls }: { open: boolean; onToggle: () => void; count: number; controls: string }) {
  return (
    <button type="button" className="filters-toggle" aria-expanded={open} aria-controls={controls} onClick={onToggle}>
      <SlidersHorizontal size={16} strokeWidth={1.75} aria-hidden />
      <span>Filtros</span>
      {count > 0 && (
        <span className="badge blue">
          {count} {count === 1 ? "ativo" : "ativos"}
        </span>
      )}
      <ChevronDown size={16} strokeWidth={1.75} className="filters-chevron" aria-hidden />
    </button>
  );
}

/**
 * Para filtros de página do servidor (Cargas): o botão e o formulário dentro de um bloco que, no desktop, não existe
 * para o layout (display: contents).
 */
export function CollapsibleFilters({ count, controls, children }: { count: number; controls: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="filters-collapse" data-open={open}>
      <FilterToggle open={open} onToggle={() => setOpen((o) => !o)} count={count} controls={controls} />
      {children}
    </div>
  );
}
