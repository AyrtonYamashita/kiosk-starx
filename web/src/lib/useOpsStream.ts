"use client";

import { createContext, createElement, useContext, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { opsStreamTicket } from "./actions";
import type { OpsCard } from "./api";

export type StreamStatus = "connecting" | "live" | "retrying" | "ended";

type Handlers = {
  snapshot?: (cards: OpsCard[]) => void;
  card?: (card: OpsCard, prev: OpsCard | undefined) => void;
  removed?: (deviceId: string) => void;
};

/**
 * Uma conexão ao vivo (SSE) para o painel inteiro. Pede um ingresso ao painel, abre a conexão direto na API e, se
 * cair, pede outro e reconecta com espera crescente (1, 2, 5, 10 s). As telas e as notificações assinam por aqui.
 */
class OpsStream {
  status: StreamStatus = "connecting";
  offsetMs: number | null = null;
  cards = new Map<string, OpsCard>();
  private gotSnapshot = false;
  private listeners = new Set<Handlers>();
  private watchers = new Set<() => void>();
  private es: EventSource | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private attempt = 0;
  private stopped = false;

  start() {
    this.stopped = false;
    this.connect();
  }

  stop() {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.es?.close();
    this.es = null;
  }

  subscribe(h: Handlers) {
    this.listeners.add(h);
    if (this.gotSnapshot) h.snapshot?.([...this.cards.values()]);
    return () => {
      this.listeners.delete(h);
    };
  }

  watch = (f: () => void) => {
    this.watchers.add(f);
    return () => {
      this.watchers.delete(f);
    };
  };

  private set(status: StreamStatus, offsetMs = this.offsetMs) {
    if (status === this.status && offsetMs === this.offsetMs) return;
    this.status = status;
    this.offsetMs = offsetMs;
    this.watchers.forEach((f) => f());
  }

  private retry() {
    if (this.stopped) return;
    this.set("retrying");
    const delays = [1000, 2000, 5000, 10000];
    const d = delays[Math.min(this.attempt, delays.length - 1)] + Math.random() * 500;
    this.attempt++;
    this.timer = setTimeout(() => this.connect(), d);
  }

  private async connect() {
    if (this.stopped) return;
    const t = await opsStreamTicket().catch(() => ({ error: "falha" }) as { ticket?: string; url?: string; error?: string });
    if (this.stopped) return;
    if (!t.ticket || !t.url) return this.retry();
    const es = new EventSource(`${t.url}?ticket=${encodeURIComponent(t.ticket)}`);
    this.es = es;
    // arredonda (meio segundo) para não recriar o relógio a cada aviso
    const offset = (d: { serverTime?: number }) => (d.serverTime ? Math.round((d.serverTime - Date.now()) / 500) * 500 : this.offsetMs);
    es.addEventListener("snapshot", (e) => {
      this.attempt = 0;
      const d = JSON.parse((e as MessageEvent).data) as { cards: OpsCard[]; serverTime?: number };
      this.cards = new Map(d.cards.map((c) => [c.deviceId, c]));
      this.gotSnapshot = true;
      this.set("live", offset(d));
      this.listeners.forEach((h) => h.snapshot?.(d.cards));
    });
    es.addEventListener("card", (e) => {
      const c = JSON.parse((e as MessageEvent).data) as OpsCard;
      const prev = this.cards.get(c.deviceId);
      this.cards.set(c.deviceId, c);
      this.listeners.forEach((h) => h.card?.(c, prev));
    });
    es.addEventListener("removed", (e) => {
      const id = JSON.parse((e as MessageEvent).data).deviceId as string;
      this.cards.delete(id);
      this.listeners.forEach((h) => h.removed?.(id));
    });
    es.addEventListener("ping", (e) => this.set(this.status, offset(JSON.parse((e as MessageEvent).data))));
    es.addEventListener("end", () => {
      es.close();
      this.set("ended");
    });
    // o ingresso é de uso único: em vez da reconexão automática do navegador, pede outro
    es.onerror = () => {
      es.close();
      if (this.es === es) this.es = null;
      this.retry();
    };
  }
}

const Ctx = createContext<OpsStream | null>(null);

/** Abre a conexão ao vivo uma vez, no layout do painel. */
/** `enabled` falso (usuário da plataforma, sem empresa): não abre a conexão ao vivo. */
export function OpsStreamProvider({ children, enabled = true }: { children: React.ReactNode; enabled?: boolean }) {
  const [stream] = useState(() => new OpsStream());
  useEffect(() => {
    if (!enabled) return;
    stream.start();
    return () => stream.stop();
  }, [stream, enabled]);
  return createElement(Ctx.Provider, { value: stream }, children);
}

function useStream() {
  const s = useContext(Ctx);
  if (!s) throw new Error("useOpsStream fora do OpsStreamProvider");
  return s;
}

/** Assina a conexão ao vivo do painel. `card` recebe também o estado anterior daquele coletor. */
export function useOpsStream(handlers: Handlers) {
  const stream = useStream();
  const h = useRef(handlers);
  useLayoutEffect(() => {
    h.current = handlers;
  });
  useEffect(
    () =>
      stream.subscribe({
        snapshot: (c) => h.current.snapshot?.(c),
        card: (c, p) => h.current.card?.(c, p),
        removed: (id) => h.current.removed?.(id),
      }),
    [stream],
  );
  const status = useSyncExternalStore(stream.watch, () => stream.status, () => "connecting" as StreamStatus);
  const offsetMs = useSyncExternalStore(stream.watch, () => stream.offsetMs, () => null);
  return { status, offsetMs };
}
