/** Formatos da tela de operações (pt-BR, fuso da operação). */

import { TZ } from "./format";

export const OFFLINE_AFTER_MS = 45_000;

const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 2 });
const num = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });
const int = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 });

export const fmtMoney = (v: number) => money.format(v);
export const fmtKg = (v: number) => `${num.format(v)} kg`;
export const fmtQty = (v: number) => int.format(v);

export function fmtDuration(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h) return `${h} h ${String(m).padStart(2, "0")} min`;
  if (m) return `${m} min ${String(s % 60).padStart(2, "0")} s`;
  return `${s} s`;
}

export function fmtAgo(iso: string | null, now: number): string {
  if (!iso) return "—";
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 5) return "agora";
  return `há ${fmtDuration(s)}`;
}

export const fmtTime = (iso: string | null) =>
  iso ? new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: TZ }) : "—";

export const fmtClock = (iso: string | null) =>
  iso ? new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone: TZ }) : "—";

export const SCREEN_LABEL: Record<string, string> = {
  bipagem: "bipando",
  placa: "na escolha da placa",
  menu: "no menu",
  login: "na tela de login",
  outra: "em outra tela",
};

/** Tipo de um código de barras bipado: [classe do selo, texto]. */
export const CODE_KIND: Record<string, [string, string]> = {
  lido: ["ok", "lido"],
  outra: ["warn", "outra carga"],
  nao_contou: ["danger", "não contou"],
};

export const END_LABEL: Record<string, string> = {
  concluded: "concluída",
  interrupted: "interrompida",
  left: "saiu sem concluir",
  replaced: "trocou de placa",
  signal_lost: "perdeu o sinal",
};

/** Sem sinal há mais que isso, o coletor não conta como "logado" no Acompanhamento (o último estado fica velho). */
export const STALE_AFTER_MS = 15 * 60_000;

export const isOffline = (lastSeenAt: string | null, now: number) => !lastSeenAt || now - new Date(lastSeenAt).getTime() > OFFLINE_AFTER_MS;
