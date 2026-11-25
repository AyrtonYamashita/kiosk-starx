"use client";

import { useToast, type ToastInput } from "@/components/Toasts";
import { opsOperationEnd } from "@/lib/actions";
import type { OpsCard } from "@/lib/api";
import { useOpsStream } from "@/lib/useOpsStream";

type Kind = "login" | "start" | "done" | "stopped" | "error";
type Toast = { kind: Kind; title: string; text: string; href?: string; key?: string };

const TONE: Record<Kind, ToastInput["tone"]> = { login: "blue", start: "ok", done: "ok", stopped: "warn", error: "danger" };
const LABEL: Record<Kind, string> = {
  login: "login no SSW",
  start: "carga iniciada",
  done: "carga concluída",
  stopped: "carga encerrada",
  error: "erro na bipagem",
};

type Op = NonNullable<OpsCard["operation"]>;

const TITLE: Record<string, (who: string, fn: string) => string> = {
  concluded: (who, fn) => `${who} concluiu ${fn}`,
  interrupted: (who, fn) => `${who} interrompeu ${fn}`,
  left: (who, fn) => `${who} saiu de ${fn} sem concluir`,
  replaced: (who, fn) => `${who} trocou de placa em ${fn}`,
  signal_lost: (who, fn) => `${who}: ${fn} encerrada (coletor sem sinal)`,
  // motivo avisado pelo coletor antes de calar
  tela_apagada: (who, fn) => `${who}: ${fn} encerrada (tela apagada)`,
  desligado: (who, fn) => `${who}: ${fn} encerrada (coletor desligado)`,
};

/** Aviso de carga encerrada, com o motivo de verdade (o canal ao vivo pode trazer o fim antes da última contagem). */
async function ended(c: OpsCard, prev: OpsCard, was: Op): Promise<Toast> {
  const info = await opsOperationEnd(c.deviceId, was.id);
  const reason = info?.endReason ?? (was.missing.qty === 0 ? "concluded" : null);
  const read = info?.read ?? was.read.qty;
  const total = info?.total ?? was.total.qty;
  const who = prev.user ?? c.user ?? "Alguém";
  const done = reason === "concluded";
  return {
    kind: done ? "done" : "stopped",
    title: TITLE[(reason === "signal_lost" && info?.endDetail) || reason || ""]?.(who, was.fnLabel) ?? `${was.fnLabel} encerrada`,
    text: `${was.realPlate || was.plate} · ${read}/${total} volumes${!done && total > read ? ` · faltaram ${total - read}` : ""} · ${c.deviceName}`,
    href: `/operations/${c.deviceId}?op=${was.id}`,
  };
}

/** O que mudou entre o estado anterior e o novo de um coletor e vale aviso (o fim de carga vem à parte, de ended()). */
function changes(c: OpsCard, prev: OpsCard): Toast[] {
  const out: Toast[] = [];
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
  // erro novo na mesma carga (o SSW recusou um código): a mensagem como apareceu no coletor
  const err = now?.lastError;
  if (now && err && now.id === was?.id && (err.at !== was.lastError?.at || err.code !== was.lastError?.code)) {
    out.push({
      kind: "error",
      title: `${who}: ${err.message ?? "código recusado"}`,
      text: `código ${err.code} · ${now.realPlate || now.plate} · ${where}${now.scanErrors > 1 ? ` · ${now.scanErrors} erros na carga` : ""}`,
      href: `/operations/${c.deviceId}`,
      // o mesmo colaborador errando de novo atualiza o aviso dele, não abre outro
      key: `erro:${c.user ?? prev.user ?? c.deviceId}`,
    });
  }
  return out;
}

/** Avisos em tempo real (login no SSW, carga iniciada, concluída ou encerrada), na pilha de avisos do painel. */
export function OpsNotifications() {
  const toast = useToast();
  const push = (items: Toast[]) =>
    toast(items.map((t) => ({ tone: TONE[t.kind], label: LABEL[t.kind], title: t.title, text: t.text, href: t.href, key: t.key, actionLabel: "Acompanhar operação" })));

  useOpsStream({
    card: (c, prev) => {
      if (!prev) return;
      const was = prev.operation;
      if (was && was.id !== c.operation?.id) ended(c, prev, was).then((t) => push([t]));
      push(changes(c, prev));
    },
  });

  return null;
}
