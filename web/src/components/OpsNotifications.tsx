"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { blur, ReducedMotionConfig, scale, spring, transition as motionTransition, useTempoTransition } from "@animate-ui/react/utils/motion";
import { X } from "lucide-react";
import { opsOperationEnd } from "@/lib/actions";
import type { OpsCard } from "@/lib/api";
import { useOpsStream } from "@/lib/useOpsStream";

type Kind = "login" | "start" | "done" | "stopped";
type Toast = { id: number; kind: Kind; title: string; text: string; href?: string };

const TONE: Record<Kind, string> = { login: "blue", start: "ok", done: "ok", stopped: "warn" };
const LABEL: Record<Kind, string> = { login: "login no SSW", start: "carga iniciada", done: "carga concluída", stopped: "carga encerrada" };
const LIFE_MS = 9000;
const MAX = 4;

type Op = NonNullable<OpsCard["operation"]>;

const TITLE: Record<string, (who: string, fn: string) => string> = {
  concluded: (who, fn) => `${who} concluiu ${fn}`,
  interrupted: (who, fn) => `${who} interrompeu ${fn}`,
  left: (who, fn) => `${who} saiu de ${fn} sem concluir`,
  replaced: (who, fn) => `${who} trocou de placa em ${fn}`,
};

/** Aviso de carga encerrada, com o motivo de verdade (o canal ao vivo pode trazer o fim antes da última contagem). */
async function ended(c: OpsCard, prev: OpsCard, was: Op): Promise<Omit<Toast, "id">> {
  const info = await opsOperationEnd(c.deviceId, was.id);
  const reason = info?.endReason ?? (was.missing.qty === 0 ? "concluded" : null);
  const read = info?.read ?? was.read.qty;
  const total = info?.total ?? was.total.qty;
  const who = prev.user ?? c.user ?? "Alguém";
  const done = reason === "concluded";
  return {
    kind: done ? "done" : "stopped",
    title: TITLE[reason ?? ""]?.(who, was.fnLabel) ?? `${was.fnLabel} encerrada`,
    text: `${was.realPlate || was.plate} · ${read}/${total} volumes${!done && total > read ? ` · faltaram ${total - read}` : ""} · ${c.deviceName}`,
    href: `/operations/${c.deviceId}?op=${was.id}`,
  };
}

/** O que mudou entre o estado anterior e o novo de um coletor e vale aviso (o fim de carga vem à parte, de ended()). */
function changes(c: OpsCard, prev: OpsCard): Omit<Toast, "id">[] {
  const out: Omit<Toast, "id">[] = [];
  const who = c.user ?? prev.user ?? "Alguém";
  const where = c.deviceName;
  const was = prev.operation;
  const now = c.operation;
  if (c.user && c.user !== prev.user) out.push({ kind: "login", title: `${c.user} entrou no SSW`, text: `coletor ${where}${c.branch ? ` · ${c.branch}` : ""}` });
  if (now && now.id !== was?.id) {
    out.push({
      kind: "start",
      title: `${who} iniciou ${now.fnLabel}`,
      text: `${now.realPlate || now.plate} · ${now.total.qty} volumes · ${where}`,
      href: `/operations/${c.deviceId}`,
    });
  }
  return out;
}

/** Avisos em tempo real (login no SSW, carga iniciada, concluída ou encerrada), no canto da tela, em todo o painel. */
export function OpsNotifications() {
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

  const push = useCallback(
    (items: Omit<Toast, "id">[]) => {
      const fresh = items.map((t) => ({ ...t, id: ++seq.current }));
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

  useOpsStream({
    card: (c, prev) => {
      if (!prev) return;
      const was = prev.operation;
      if (was && was.id !== c.operation?.id) ended(c, prev, was).then((t) => push([t]));
      push(changes(c, prev));
    },
  });

  useEffect(() => {
    const all = timers.current;
    return () => all.forEach((t) => clearTimeout(t));
  }, []);

  const enter = useTempoTransition(spring.toast);
  const leave = useTempoTransition(motionTransition.dismiss);

  return (
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
                <span className={`badge ${TONE[t.kind]}`}>
                  <span className="dot" /> {LABEL[t.kind]}
                </span>
                <button type="button" className="toast-close" aria-label="Fechar aviso" onClick={() => dismiss(t.id)}>
                  <X size={16} strokeWidth={1.75} aria-hidden />
                </button>
              </div>
              <strong className="toast-title">{t.title}</strong>
              <span className="toast-text">{t.text}</span>
              {t.href && (
                <Link href={t.href} className="button toast-action" onClick={() => dismiss(t.id)}>
                  Acompanhar operação
                </Link>
              )}
            </motion.li>
          ))}
        </AnimatePresence>
      </ol>
    </ReducedMotionConfig>
  );
}
