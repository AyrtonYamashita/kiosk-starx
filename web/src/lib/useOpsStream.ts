"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { opsStreamTicket } from "./actions";
import type { OpsCard } from "./api";

export type StreamStatus = "connecting" | "live" | "retrying" | "ended";

/**
 * Conexão ao vivo com a API (SSE). Pede um ingresso ao painel, abre a conexão direto na API e, se cair, pede outro
 * ingresso e reconecta com espera crescente (1, 2, 5, 10 s). `offsetMs` = hora do servidor − hora deste navegador.
 */
export function useOpsStream(handlers: { snapshot?: (cards: OpsCard[]) => void; card?: (card: OpsCard) => void; removed?: (deviceId: string) => void }) {
  const [status, setStatus] = useState<StreamStatus>("connecting");
  const [offsetMs, setOffsetMs] = useState<number | null>(null);
  const h = useRef(handlers);
  useLayoutEffect(() => {
    h.current = handlers;
  });

  useEffect(() => {
    let es: EventSource | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let attempt = 0;
    let stopped = false;
    const delays = [1000, 2000, 5000, 10000];

    const retry = () => {
      if (stopped) return;
      setStatus("retrying");
      const d = delays[Math.min(attempt, delays.length - 1)] + Math.random() * 500;
      attempt++;
      timer = setTimeout(connect, d);
    };

    async function connect() {
      if (stopped) return;
      const t = await opsStreamTicket().catch(() => ({ error: "falha" }) as { ticket?: string; url?: string; error?: string });
      if (stopped) return;
      if (!t.ticket || !t.url) return retry();
      es = new EventSource(`${t.url}?ticket=${encodeURIComponent(t.ticket)}`);
      // arredonda (meio segundo) para não recriar o relógio a cada aviso
      const time = (d: { serverTime?: number }) => {
        if (d.serverTime) setOffsetMs(Math.round((d.serverTime - Date.now()) / 500) * 500);
      };
      es.addEventListener("snapshot", (e) => {
        attempt = 0;
        setStatus("live");
        const d = JSON.parse((e as MessageEvent).data);
        time(d);
        h.current.snapshot?.(d.cards);
      });
      es.addEventListener("card", (e) => h.current.card?.(JSON.parse((e as MessageEvent).data)));
      es.addEventListener("removed", (e) => h.current.removed?.(JSON.parse((e as MessageEvent).data).deviceId));
      es.addEventListener("ping", (e) => time(JSON.parse((e as MessageEvent).data)));
      es.addEventListener("end", () => {
        es?.close();
        setStatus("ended");
      });
      // o ingresso é de uso único: em vez da reconexão automática do navegador, pede outro
      es.onerror = () => {
        es?.close();
        es = null;
        retry();
      };
    }

    connect();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      es?.close();
    };
  }, []);

  return { status, offsetMs };
}

/**
 * Relógio (hora do servidor) que atualiza a cada segundo (tempos "há X s", offline). Começa em `initial` — a hora que
 * o servidor usou para montar a página — para o HTML do servidor e o do navegador baterem.
 */
export function useNow(initial: number, offsetMs: number | null, everyMs = 1000) {
  const [now, setNow] = useState(initial);
  const [initOffset] = useState(() => initial - Date.now());
  const off = offsetMs ?? initOffset;
  useEffect(() => {
    const tick = () => setNow(Date.now() + off);
    const first = setTimeout(tick, 0);
    const t = setInterval(tick, everyMs);
    return () => {
      clearTimeout(first);
      clearInterval(t);
    };
  }, [off, everyMs]);
  return now;
}
