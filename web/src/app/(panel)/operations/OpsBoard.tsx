"use client";

import Link from "next/link";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { AnimateIcon } from "@animate-ui/react/icons";
import { ScanBarcode } from "@/components/animate-ui/icons/scan-barcode";
import { Num } from "@/components/Num";
import type { OpsCard } from "@/lib/api";
import { setClockOffset, useClockValue } from "@/lib/clock";
import { fmtAgo, fmtDuration, fmtTime, isOffline, SCREEN_LABEL } from "@/lib/opsFormat";
import { useOpsStream } from "@/lib/useOpsStream";

/** Cards ao vivo, um por coletor: em operação primeiro, depois logados, depois o resto. */
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
  useEffect(() => {
    if (offsetMs !== null) setClockOffset(offsetMs);
  }, [offsetMs]);

  const all = useMemo(() => Object.values(cards), [cards]);
  // só redesenha a lista quando algum coletor entra ou sai do "sem sinal"
  const offlineKey = useClockValue(
    (now) =>
      all
        .filter((c) => isOffline(c.lastSeenAt, now))
        .map((c) => c.deviceId)
        .sort()
        .join(","),
    initialServerTime,
  );

  const list = useMemo(() => {
    const offline = new Set(offlineKey ? offlineKey.split(",") : []);
    const rank = (c: OpsCard) => (offline.has(c.deviceId) ? 3 : c.operation ? 0 : c.user ? 1 : 2);
    return all
      .filter((c) => !onlyLogged || c.user || c.operation)
      .sort((a, b) => rank(a) - rank(b) || (a.user ?? a.deviceName).localeCompare(b.user ?? b.deviceName, "pt-BR"));
  }, [all, offlineKey, onlyLogged]);

  return (
    <div className="stack wide ops-page">
      <header className="ops-head">
        <div className="row" style={{ gap: 10 }}>
          <h1 style={{ margin: 0 }}>Acompanhamento</h1>
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
        </div>
        <div className="ops-tools">
          <label className="check-label small">
            <input type="checkbox" checked={onlyLogged} onChange={(e) => setOnlyLogged(e.target.checked)} />
            só com colaborador
          </label>
          <AnimateIcon animateOnHover animateOnTap asChild>
            <Link href="/operations/codigo" className="link-button small icon-link">
              <ScanBarcode size={18} strokeWidth={1.75} aria-hidden />
              Consultar código de barras
            </Link>
          </AnimateIcon>
        </div>
      </header>

      {list.length === 0 ? (
        <div className="card muted">
          {all.length === 0 ? "Nenhum coletor enviou dados ainda. Os cards aparecem quando o app estiver lendo o SSW." : "Nenhum colaborador logado agora."}
        </div>
      ) : (
        <div className="ops-grid">
          {list.map((c) => (
            <OpsCardView key={c.deviceId} c={c} serverNow={initialServerTime} />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Pulso na borda do card a cada bipagem ("lidos" subiu na mesma carga). Só opacidade, pela Web Animations API:
 * não anima na abertura da página nem quando a carga troca.
 */
function useScanPulse(key: string | null, read: number | null) {
  const el = useRef<HTMLSpanElement>(null);
  const prev = useRef<{ key: string | null; read: number | null }>({ key, read });
  useEffect(() => {
    const p = prev.current;
    const sameOp = key !== null && p.key !== null && key.split(":")[0] === p.key.split(":")[0];
    if (sameOp && read !== null && p.read !== null && read > p.read) {
      el.current?.animate([{ opacity: 0 }, { opacity: 1, offset: 0.15 }, { opacity: 0 }], { duration: 1100, easing: "ease-out" });
    }
    prev.current = { key, read };
  }, [key, read]);
  return el;
}

/** "sem sinal há X" e o estado do card: redesenha só quando o texto muda. */
function useOffline(lastSeenAt: string | null, serverNow: number) {
  return useClockValue((now) => (isOffline(lastSeenAt, now) ? fmtAgo(lastSeenAt, now) : null), serverNow);
}

function Since({ iso, serverNow }: { iso: string; serverNow: number }) {
  return <>{useClockValue((now) => fmtDuration((now - new Date(iso).getTime()) / 1000), serverNow)}</>;
}

function Eta({ etaAt, serverNow }: { etaAt: string; serverNow: number }) {
  const left = useClockValue((now) => {
    const s = (new Date(etaAt).getTime() - now) / 1000;
    return s > 0 ? `faltam ${fmtDuration(s)}` : "atrasado";
  }, serverNow);
  return (
    <>
      ~{fmtTime(etaAt)} <span className={left === "atrasado" ? "bad" : "muted"}>({left})</span>
    </>
  );
}

const OpsCardView = memo(function OpsCardView({ c, serverNow }: { c: OpsCard; serverNow: number }) {
  const offlineFor = useOffline(c.lastSeenAt, serverNow);
  const op = c.operation;
  const pct = op && op.total.qty > 0 ? Math.min(100, (op.read.qty / op.total.qty) * 100) : 0;
  const pulse = useScanPulse(op ? `${op.id}:${op.read.qty}` : null, op?.read.qty ?? null);

  return (
    <Link href={`/operations/${c.deviceId}`} className={`card ops-card${offlineFor ? " offline" : ""}`}>
      <span ref={pulse} className="ops-pulse" aria-hidden />
      <div className="ops-card-head">
        <strong className="ops-user">{c.user ?? "Ninguém logado"}</strong>
        {offlineFor ? (
          <span className="badge off">
            <span className="dot" /> sem sinal {offlineFor}
          </span>
        ) : op ? (
          <span className="badge ok">
            <span className="dot" /> em operação
          </span>
        ) : c.user ? (
          <span className="badge blue">
            <span className="dot" /> logado
          </span>
        ) : (
          <span className="badge off">
            <span className="dot" /> livre
          </span>
        )}
      </div>

      {op ? (
        <>
          <div className="ops-fn">
            <span>{op.fnLabel}</span>
            <span className="ops-plate mono">{op.realPlate || op.plate}</span>
          </div>
          <div className="ops-main">
            <div className="ops-read">
              <Num value={op.read.qty} className="ops-read-n" />
              <span className="ops-read-of">
                / <Num value={op.total.qty} /> volumes
              </span>
            </div>
            <Num value={Math.round(pct)} suffix="%" className="ops-pct" />
          </div>
          <div className="ops-bar" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100} aria-label="volumes lidos">
            <span style={{ transform: `scaleX(${pct / 100})` }} />
          </div>
          <dl className="ops-facts">
            <div>
              <dt>Faltam</dt>
              <dd className={op.missing.qty > 0 ? "bad" : undefined}>
                <Num value={op.missing.qty} />
              </dd>
            </div>
            <div>
              <dt>Ritmo</dt>
              <dd>{op.avgSecPerVolume !== null ? <Num value={op.avgSecPerVolume} decimals={1} suffix=" s/vol" /> : <span className="muted">aguardando</span>}</dd>
            </div>
            <div>
              <dt>Valor</dt>
              <dd>
                <Num value={op.total.value} decimals={2} prefix="R$ " />
              </dd>
            </div>
            <div>
              <dt>Término</dt>
              <dd>{op.etaAt && op.missing.qty > 0 ? <Eta etaAt={op.etaAt} serverNow={serverNow} /> : <span className="muted">—</span>}</dd>
            </div>
          </dl>
        </>
      ) : (
        <p className="ops-idle">
          {c.user ? (
            <>
              Logado, sem carga aberta ({SCREEN_LABEL[c.screen ?? ""] ?? "tela desconhecida"})
            </>
          ) : (
            <>Coletor sem colaborador no SSW</>
          )}
        </p>
      )}

      <div className="ops-foot small muted">
        <span className="mono">{c.deviceName}</span>
        {c.branch && <span>· {c.branch}</span>}
        {op && (
          <span>
            · carga há <Since iso={op.startedAt} serverNow={serverNow} />
          </span>
        )}
      </div>
    </Link>
  );
});
