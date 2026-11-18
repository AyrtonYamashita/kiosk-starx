"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { OpsCard } from "@/lib/api";
import { fmtAgo, fmtDuration, fmtMoney, fmtQty, fmtTime, isOffline, SCREEN_LABEL } from "@/lib/opsFormat";
import { useNow, useOpsStream } from "@/lib/useOpsStream";

/** Cards ao vivo: um por coletor; em operação primeiro, depois logados, depois o resto. */
export function OpsBoard({ initial, initialServerTime }: { initial: OpsCard[]; initialServerTime: number }) {
  const [cards, setCards] = useState<Record<string, OpsCard>>(() => Object.fromEntries(initial.map((c) => [c.deviceId, c])));
  const [onlyLogged, setOnlyLogged] = useState(true);
  const { status, offsetMs } = useOpsStream({
    snapshot: (list) => setCards(Object.fromEntries(list.map((c) => [c.deviceId, c]))),
    card: (c) => setCards((prev) => ({ ...prev, [c.deviceId]: c })),
    removed: (id) =>
      setCards((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      }),
  });
  const now = useNow(initialServerTime, offsetMs);

  const list = useMemo(() => {
    const rank = (c: OpsCard) => (isOffline(c.lastSeenAt, now) ? 3 : c.operation ? 0 : c.user ? 1 : 2);
    return Object.values(cards)
      .filter((c) => !onlyLogged || c.user || c.operation)
      .sort((a, b) => rank(a) - rank(b) || (a.user ?? a.deviceName).localeCompare(b.user ?? b.deviceName, "pt-BR"));
  }, [cards, onlyLogged, now]);

  const all = Object.values(cards);
  const working = all.filter((c) => c.operation && !isOffline(c.lastSeenAt, now)).length;
  const logged = all.filter((c) => c.user && !isOffline(c.lastSeenAt, now)).length;

  return (
    <div className="stack wide">
      <div className="row">
        <h1 style={{ margin: 0 }}>Acompanhamento de operações</h1>
        {status === "live" ? (
          <span className="badge ok">
            <span className="dot live-dot" /> ao vivo
          </span>
        ) : status === "ended" ? (
          <span className="badge danger">
            <span className="dot" /> sessão encerrada: recarregue a página
          </span>
        ) : (
          <span className="badge warn">
            <span className="dot" /> {status === "connecting" ? "conectando…" : "reconectando…"}
          </span>
        )}
        <span className="spacer" />
        <span className="muted small">
          {working} em operação · {logged} logado(s)
        </span>
        <label className="inline small">
          <input type="checkbox" checked={onlyLogged} onChange={(e) => setOnlyLogged(e.target.checked)} />
          só com colaborador
        </label>
      </div>

      {list.length === 0 ? (
        <div className="card muted">
          {all.length === 0
            ? "Nenhum coletor enviou dados ainda. Os cards aparecem quando o app (0.5.0 ou mais novo) estiver lendo o SSW."
            : "Nenhum colaborador logado agora."}
        </div>
      ) : (
        <div className="ops-grid">
          {list.map((c) => (
            <OpsCardView key={c.deviceId} c={c} now={now} />
          ))}
        </div>
      )}
    </div>
  );
}

function OpsCardView({ c, now }: { c: OpsCard; now: number }) {
  const offline = isOffline(c.lastSeenAt, now);
  const op = c.operation;
  const pct = op && op.total.qty > 0 ? Math.min(100, (op.read.qty / op.total.qty) * 100) : 0;
  const etaSec = op?.etaAt ? (new Date(op.etaAt).getTime() - now) / 1000 : null;

  return (
    <Link href={`/operations/${c.deviceId}`} className={`card ops-card${offline ? " offline" : ""}`}>
      <div className="row" style={{ gap: 8 }}>
        <strong className="ops-user">{c.user ?? "Ninguém logado"}</strong>
        <span className="spacer" />
        {offline ? (
          <span className="badge off">
            <span className="dot" /> sem sinal {fmtAgo(c.lastSeenAt, now)}
          </span>
        ) : op ? (
          <span className="badge ok">
            <span className="dot" /> em operação
          </span>
        ) : c.user ? (
          <span className="badge blue">logado</span>
        ) : (
          <span className="badge off">livre</span>
        )}
      </div>

      <p className="ops-sentence">
        {op ? (
          <>
            <b>{c.user ?? "Alguém"}</b> está na função <b>{op.fnLabel}</b> agora, no carro <b className="mono">{op.realPlate || op.plate}</b>
          </>
        ) : c.user ? (
          <>
            <b>{c.user}</b> está logado, sem descarga aberta ({SCREEN_LABEL[c.screen ?? ""] ?? "tela desconhecida"})
          </>
        ) : (
          <>Coletor sem colaborador logado no SSW</>
        )}
      </p>

      {op && (
        <>
          <div className="ops-bar" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100} aria-label="volumes lidos">
            <span style={{ width: `${pct}%` }} />
          </div>
          <div className="ops-nums">
            <div>
              <span className="section-label">Total</span>
              <strong className="mono">{fmtQty(op.total.qty)}</strong>
            </div>
            <div>
              <span className="section-label">Lidos</span>
              <strong className="mono good">{fmtQty(op.read.qty)}</strong>
            </div>
            <div>
              <span className="section-label">Faltam</span>
              <strong className={`mono ${op.missing.qty > 0 ? "bad" : ""}`}>{fmtQty(op.missing.qty)}</strong>
            </div>
          </div>
          <div className="ops-foot small muted">
            <span>{fmtMoney(op.total.value)}</span>
            <span>·</span>
            <span>
              {op.avgSecPerVolume !== null ? `${op.avgSecPerVolume.toLocaleString("pt-BR")} s/volume` : "aguardando bipagens"}
            </span>
            {etaSec !== null && op.missing.qty > 0 && (
              <>
                <span>·</span>
                <span>
                  término ~{fmtTime(op.etaAt)} ({etaSec > 0 ? `faltam ${fmtDuration(etaSec)}` : "atrasado"})
                </span>
              </>
            )}
          </div>
        </>
      )}
      <div className="ops-foot small muted">
        <span className="mono">{c.deviceName}</span>
        {c.branch && (
          <>
            <span>·</span>
            <span>{c.branch}</span>
          </>
        )}
        {op && (
          <>
            <span>·</span>
            <span>carga há {fmtDuration((now - new Date(op.startedAt).getTime()) / 1000)}</span>
          </>
        )}
      </div>
    </Link>
  );
}
