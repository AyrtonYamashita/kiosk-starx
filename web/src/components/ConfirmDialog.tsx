"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { AlertTriangle, HelpCircle } from "lucide-react";

/*
  Confirmação do painel no lugar do confirm() do navegador: um <dialog> modal com a identidade do site.
  O <dialog> nativo já cuida do foco preso, do Esc e do fundo escurecido.

  Uso num formulário (o envio só segue depois do "sim"):
    const ask = useConfirm();
    <form action={action} onSubmit={(e) => ask.submit(e, { title: "Remover X?", confirmLabel: "Remover", danger: true })}>
  Num botão de envio com formAction próprio: onClick={(e) => ask.click(e, {...})}.
  Se a condição não pedir confirmação, simplesmente não chame (o envio segue normal).
*/

export interface ConfirmOptions {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** ação destrutiva: botão vermelho e o foco começa em "Cancelar" */
  danger?: boolean;
}

type Open = (opts: ConfirmOptions) => Promise<boolean>;
const Ctx = createContext<Open | null>(null);

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [opts, setOpts] = useState<ConfirmOptions | null>(null);
  const resolveRef = useRef<((ok: boolean) => void) | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);

  const open = useCallback<Open>((o) => {
    resolveRef.current?.(false);
    setOpts(o);
    return new Promise<boolean>((resolve) => {
      resolveRef.current = resolve;
    });
  }, []);

  const finish = useCallback((ok: boolean) => {
    resolveRef.current?.(ok);
    resolveRef.current = null;
    dialogRef.current?.close();
    setOpts(null);
  }, []);

  useEffect(() => {
    const d = dialogRef.current;
    if (opts && d && !d.open) d.showModal();
  }, [opts]);

  return (
    <Ctx.Provider value={open}>
      {children}
      <dialog
        ref={dialogRef}
        className="confirm-dialog"
        aria-labelledby="confirm-title"
        aria-describedby={opts?.message ? "confirm-text" : undefined}
        onCancel={(e) => {
          e.preventDefault();
          finish(false);
        }}
        onClick={(e) => {
          // clique no fundo (fora da caixa) cancela
          if (e.target === e.currentTarget) finish(false);
        }}
      >
        {opts && (
          <div className="confirm-box">
            <div className="confirm-head">
              <span className={`confirm-icon${opts.danger ? " danger" : ""}`} aria-hidden>
                {opts.danger ? <AlertTriangle size={18} /> : <HelpCircle size={18} />}
              </span>
              <div className="confirm-texts">
                <h2 id="confirm-title">{opts.title}</h2>
                {opts.message && (
                  <p id="confirm-text" className="muted">
                    {opts.message}
                  </p>
                )}
              </div>
            </div>
            <div className="confirm-actions">
              <button type="button" onClick={() => finish(false)} autoFocus={opts.danger}>
                {opts.cancelLabel ?? "Cancelar"}
              </button>
              <button type="button" className={opts.danger ? "danger-solid" : "primary"} onClick={() => finish(true)} autoFocus={!opts.danger}>
                {opts.confirmLabel ?? "Confirmar"}
              </button>
            </div>
          </div>
        )}
      </dialog>
    </Ctx.Provider>
  );
}

/** Confirmação antes de enviar um formulário (ou clicar num botão de envio). */
export function useConfirm() {
  const open = useContext(Ctx);
  if (!open) throw new Error("useConfirm precisa do <ConfirmProvider>");

  return {
    /** No onSubmit do <form>: segura o envio, pergunta e reenvia (com o mesmo botão) se a resposta for sim. */
    submit(e: React.FormEvent<HTMLFormElement>, opts: ConfirmOptions) {
      const form = e.currentTarget;
      // reenvio depois do "sim": deixa passar
      if (form.dataset.confirmed) {
        delete form.dataset.confirmed;
        return;
      }
      e.preventDefault();
      const submitter = (e.nativeEvent as SubmitEvent).submitter as HTMLElement | null;
      void open(opts).then((ok) => {
        if (!ok || !form.isConnected) return;
        form.dataset.confirmed = "1";
        form.requestSubmit(submitter && submitter.isConnected ? submitter : undefined);
      });
    },
    /** No onClick de um botão de envio (ex.: com formAction próprio). */
    click(e: React.MouseEvent<HTMLButtonElement>, opts: ConfirmOptions) {
      const button = e.currentTarget;
      if (button.dataset.confirmed) {
        delete button.dataset.confirmed;
        return;
      }
      e.preventDefault();
      void open(opts).then((ok) => {
        if (!ok || !button.isConnected) return;
        button.dataset.confirmed = "1";
        button.click();
      });
    },
  };
}
