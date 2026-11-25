"use client";

import { useEffect, useState, useTransition } from "react";
import { useToast } from "@/components/Toasts";
import { Toggle } from "@/components/Toggle";
import { pushSetEvents, pushSubscribe, pushTest, pushUnsubscribe, type PushEventKey } from "@/lib/actions";
import type { PushInfo } from "@/lib/api";
import { useClientValue } from "@/lib/client";

const EVENTS: { key: PushEventKey; label: string }[] = [
  { key: "start", label: "Carga iniciada" },
  { key: "done", label: "Carga concluída" },
  { key: "stopped", label: "Carga encerrada sem concluir (interrompida, sem sinal…)" },
  { key: "scan_error", label: "Erro na bipagem (código recusado pelo SSW; no máximo um aviso por carga a cada minuto)" },
];

type Support = "checking" | "ok" | "ios-browser" | "unsupported";

/** Chave pública VAPID (base64url) → bytes, como o PushManager pede. */
function keyBytes(b64: string): Uint8Array<ArrayBuffer> {
  const pad = "=".repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

function detect(): Support {
  if ("serviceWorker" in navigator && "PushManager" in window && "Notification" in window) return "ok";
  // iPhone/iPad: o Safari só entrega notificações ao app instalado na tela inicial (iOS 16.4+)
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  return ios ? "ios-browser" : "unsupported";
}

/** Notificações no celular: ligar/desligar neste aparelho, escolher os eventos (valem para todos) e enviar um teste. */
export function PushCard({ info }: { info: PushInfo }) {
  const toast = useToast();
  const support = useClientValue<Support>(detect, "checking");
  // null = ainda não perguntou nesta tela (vale o que o navegador já sabe)
  const [asked, setAsked] = useState<NotificationPermission | null>(null);
  const current = useClientValue<NotificationPermission>(() => ("Notification" in window ? Notification.permission : "default"), "default");
  const permission = asked ?? current;
  const [endpoint, setEndpoint] = useState<string | null>(null);
  const [events, setEvents] = useState(info.events);
  const [busy, start] = useTransition();

  const here = endpoint !== null && info.subscriptions.some((s) => s.endpoint === endpoint);
  const total = info.subscriptions.length;

  useEffect(() => {
    if (detect() !== "ok") return;
    (async () => {
      // mantém o service worker atualizado e descobre se este navegador já está inscrito
      const reg = await navigator.serviceWorker.register("/sw.js").catch(() => null);
      const sub = await reg?.pushManager.getSubscription();
      setEndpoint(sub?.endpoint ?? null);
      // inscrito no navegador mas não no servidor (ex.: outro usuário entrou depois): reinscreve com este usuário
      if (sub && Notification.permission === "granted" && info.enabled && !info.subscriptions.some((x) => x.endpoint === sub.endpoint)) {
        await pushSubscribe(sub.toJSON());
      }
    })();
  }, [info.enabled, info.subscriptions]);

  const result = (r: { ok?: string; error?: string }) => {
    if (r.error) toast({ tone: "danger", title: "Notificações", text: r.error });
    else if (r.ok) toast({ tone: "ok", title: r.ok });
  };

  const enable = () =>
    start(async () => {
      if (!info.publicKey) return;
      try {
        const perm = await Notification.requestPermission();
        setAsked(perm);
        if (perm !== "granted") {
          toast({ tone: "warn", title: "Permissão negada", text: "Libere as notificações do site nas configurações do navegador." });
          return;
        }
        const reg = await navigator.serviceWorker.register("/sw.js");
        await navigator.serviceWorker.ready;
        const old = await reg.pushManager.getSubscription();
        const sub = old ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(info.publicKey) }));
        setEndpoint(sub.endpoint);
        result(await pushSubscribe(sub.toJSON()));
      } catch {
        toast({ tone: "danger", title: "Notificações", text: "Este navegador não conseguiu ligar as notificações." });
      }
    });

  const disable = () =>
    start(async () => {
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = await reg?.pushManager.getSubscription();
      const ep = sub?.endpoint ?? endpoint;
      await sub?.unsubscribe().catch(() => undefined);
      setEndpoint(null);
      if (ep) result(await pushUnsubscribe(ep));
    });

  const test = () => start(async () => result(await pushTest()));

  const toggle = (key: PushEventKey, on: boolean) => {
    const next = EVENTS.map((e) => e.key).filter((k) => (k === key ? on : events.includes(k)));
    setEvents(next);
    start(async () => {
      const r = await pushSetEvents(next);
      if (r.error) {
        setEvents(events);
        result(r);
      }
    });
  };

  return (
    <section className="card account-card">
      <h2>Notificações no celular</h2>
      <span className="muted small">Avisos das cargas na barra de notificações do aparelho, mesmo com o app fechado.</span>

      {!info.enabled ? (
        <div className="alert error">Notificações não configuradas no servidor.</div>
      ) : support === "checking" ? null : support === "ios-browser" ? (
        <span className="small">
          No iPhone, instale o painel na tela inicial (Compartilhar → <b>Adicionar à Tela de Início</b>), abra pelo ícone e ative aqui. Precisa do iOS 16.4 ou
          mais novo.
        </span>
      ) : support === "unsupported" ? (
        <span className="small">Este navegador não aceita notificações. No celular, use o Chrome (Android) ou o app instalado.</span>
      ) : (
        <>
          <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
            <span className={`badge ${here ? "ok" : "off"}`}>
              <span className="dot" /> {here ? "ligadas neste aparelho" : "desligadas neste aparelho"}
            </span>
            {total > 0 && (
              <span className="muted small">
                {total} {total === 1 ? "aparelho" : "aparelhos"} com notificação
              </span>
            )}
          </div>
          {permission === "denied" && !here && (
            <span className="small">As notificações deste site estão bloqueadas no navegador. Libere nas configurações do site e tente de novo.</span>
          )}
          <div className="row" style={{ gap: 12, flexWrap: "wrap" }}>
            {here ? (
              <>
                <button type="button" onClick={test} disabled={busy}>
                  Enviar teste
                </button>
                <button type="button" className="danger" onClick={disable} disabled={busy}>
                  Desligar neste aparelho
                </button>
              </>
            ) : (
              <button type="button" className="primary" onClick={enable} disabled={busy || permission === "denied"}>
                {busy ? "Ativando…" : "Ativar neste aparelho"}
              </button>
            )}
          </div>
        </>
      )}

      {info.enabled && (
        <div className="account-sec">
          <h3>Avisar quando</h3>
          {EVENTS.map((e) => (
            <label key={e.key} className="check-label">
              <Toggle checked={events.includes(e.key)} onCheckedChange={(on) => toggle(e.key, on)} />
              {e.label}
            </label>
          ))}
          <span className="muted small">Vale para todos os seus aparelhos.</span>
        </div>
      )}
    </section>
  );
}
