"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { SlidersHorizontal, X } from "lucide-react";
import { closeSheet } from "@/lib/sheet";

/**
 * Filtros no celular (abaixo de 1024 px): barra "Filtros (n ativos)" fixa no pé da tela, logo acima da barra de abas
 * (a lista fica em cima). O toque abre uma folha igual à do menu "Mais" (<dialog> modal: foco preso, Esc/voltar,
 * toque fora e × fecham com animação, o foco volta à barra) com os filtros dentro. No desktop a barra e a folha não
 * aparecem: a página mostra os filtros no lugar de sempre.
 */
export function FilterSheet({
  id,
  count,
  closeOnSubmit = false,
  children,
}: {
  id: string;
  count: number;
  /** fecha a folha quando um formulário dentro dela é enviado (Cargas: o GET recarrega a lista) */
  closeOnSubmit?: boolean;
  children: ReactNode;
}) {
  const sheetRef = useRef<HTMLDialogElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);

  // a barra some no desktop: se a tela crescer com a folha aberta, fecha na hora
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    const onChange = () => {
      if (mq.matches) sheetRef.current?.close();
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  const show = () => {
    const d = sheetRef.current;
    if (d && !d.open) {
      d.showModal();
      setOpen(true);
    }
  };
  const hide = () => closeSheet(sheetRef.current);

  return (
    <>
      <div className="filter-bar">
        <button ref={triggerRef} type="button" className="filter-bar-btn" aria-haspopup="dialog" aria-expanded={open} aria-controls={id} onClick={show}>
          <SlidersHorizontal size={16} strokeWidth={1.75} aria-hidden />
          <span>Filtros</span>
          {count > 0 && (
            <span className="badge blue">
              {count} {count === 1 ? "ativo" : "ativos"}
            </span>
          )}
        </button>
      </div>
      <dialog
        ref={sheetRef}
        id={id}
        className="more-sheet filter-sheet"
        aria-labelledby={`${id}-title`}
        onCancel={(e) => {
          e.preventDefault();
          hide();
        }}
        onClose={() => {
          setOpen(false);
          triggerRef.current?.focus();
        }}
        onClick={(e) => {
          if (e.target === e.currentTarget) hide();
        }}
        onSubmit={closeOnSubmit ? hide : undefined}
      >
        <div className="more-box">
          <div className="more-head">
            <h2 id={`${id}-title`}>Filtros</h2>
            <button type="button" className="more-close" aria-label="Fechar filtros" onClick={hide}>
              <X size={20} strokeWidth={1.75} aria-hidden />
            </button>
          </div>
          {children}
        </div>
      </dialog>
    </>
  );
}
