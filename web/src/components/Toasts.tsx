"use client";

import Link from "next/link";
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { blur, ReducedMotionConfig, scale, spring, transition as motionTransition, useTempoTransition } from "@animate-ui/react/utils/motion";
import { X } from "lucide-react";

/*
  Avisos no canto da tela (toast com as animações da Animate UI), em todo o painel: os avisos ao vivo do
  Acompanhamento (login no SSW, carga iniciada/encerrada) e o resultado das ações (comando enviado, salvo...).
  Erros continuam junto do formulário, onde dá para corrigir.
*/

export type ToastTone = "ok" | "blue" | "warn" | "danger" | "off";
export interface ToastInput {
  tone: ToastTone;
  /** etiqueta curta no topo (ex.: "comando enviado") */
  label: string;
  title: string;
  text?: string;
  href?: string;
  actionLabel?: string;
}
type Toast = ToastInput & { id: number };

const LIFE_MS = 9000;
const MAX = 4;

type Push = (items: ToastInput | ToastInput[]) => void;
const Ctx = createContext<Push | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const seq = useRef(0);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: number) => {
    const t = timers.current.get(id);
    if (t) clearTimeout(t);
    timers.current.delete(id);
    setToasts((list) => list.filter((x) => x.id !== id));
  }, []);
  const arm = useCallback((id: number) => timers.current.set(id, setTimeout(() => dismiss(id), LIFE_MS)), [dismiss]);
  const hold = (id: number) => {
    const t = timers.current.get(id);
    if (t) clearTimeout(t);
  };

  const push = useCallback<Push>(
    (items) => {
      const fresh = (Array.isArray(items) ? items : [items]).map((t) => ({ ...t, id: ++seq.current }));
      if (!fresh.length) return;
      fresh.forEach((t) => arm(t.id));
      setToasts((list) => {
        const next = [...list, ...fresh];
        next.slice(0, Math.max(0, next.length - MAX)).forEach((t) => {
          const tm = timers.current.get(t.id);
          if (tm) clearTimeout(tm);
          timers.current.delete(t.id);
        });
        return next.slice(-MAX);
      });
    },
    [arm],
  );

  useEffect(() => {
    const all = timers.current;
    return () => all.forEach((t) => clearTimeout(t));
  }, []);

  const enter = useTempoTransition(spring.toast);
  const leave = useTempoTransition(motionTransition.dismiss);

  return (
    <Ctx.Provider value={push}>
      {children}
      <ReducedMotionConfig>
        <ol className="toasts" aria-label="Avisos">
          <AnimatePresence initial={false}>
            {toasts.map((t) => (
              <motion.li
                key={t.id}
                role="status"
                className="toast"
                layout="position"
                initial={{ opacity: 0, y: "100%", scale: scale.toast, filter: blur.surface }}
                animate={{ opacity: 1, y: 0, scale: 1, filter: "blur(0px)", transition: enter }}
                exit={{ opacity: 0, scale: scale.toast, filter: blur.surface, transition: leave }}
                transition={enter}
                style={{ originY: 1 }}
                onPointerEnter={() => hold(t.id)}
                onPointerLeave={() => arm(t.id)}
                onFocus={() => hold(t.id)}
                onBlur={() => arm(t.id)}
              >
                <div className="toast-head">
                  <span className={`badge ${t.tone}`}>
                    <span className="dot" /> {t.label}
                  </span>
                  <button type="button" className="toast-close" aria-label="Fechar aviso" onClick={() => dismiss(t.id)}>
                    <X size={16} strokeWidth={1.75} aria-hidden />
                  </button>
                </div>
                <strong className="toast-title">{t.title}</strong>
                {t.text && <span className="toast-text">{t.text}</span>}
                {t.href && (
                  <Link href={t.href} className="button toast-action" onClick={() => dismiss(t.id)}>
                    {t.actionLabel ?? "Abrir"}
                  </Link>
                )}
              </motion.li>
            ))}
          </AnimatePresence>
        </ol>
      </ReducedMotionConfig>
    </Ctx.Provider>
  );
}

export function useToast(): Push {
  const push = useContext(Ctx);
  if (!push) throw new Error("useToast precisa do <ToastProvider>");
  return push;
}

/** "Bloquear tela: enviado para 1 aparelho. Chega..." → título "Bloquear tela", texto "Enviado para 1 aparelho. Chega..." */
function split(message: string): { title: string; text?: string } {
  const m = /^(.{3,80}?)(?:: |\. )(.+)$/s.exec(message.trim());
  if (!m) return { title: message.trim().replace(/\.$/, "") };
  const text = m[2].trim();
  return { title: m[1], text: text.charAt(0).toUpperCase() + text.slice(1) };
}

// cada resultado de ação vira um aviso só, mesmo que o retorno apareça em dois lugares da tela
const shown = new WeakSet<object>();

/** Mostra o `ok` do resultado de uma Server Action (useActionState) como aviso, uma vez por resultado. */
export function useActionToast(state: { ok?: string } | undefined | null, label = "pronto") {
  const push = useToast();
  useEffect(() => {
    if (!state || typeof state.ok !== "string" || !state.ok || shown.has(state)) return;
    shown.add(state);
    push({ tone: "ok", label, ...split(state.ok) });
  }, [state, label, push]);
}
