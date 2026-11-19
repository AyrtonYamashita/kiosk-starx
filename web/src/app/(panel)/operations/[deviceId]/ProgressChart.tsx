"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { fmtClock } from "@/lib/opsFormat";

type Point = { t: number; qty: number };

const H = 200;
const PAD = { top: 16, right: 16, bottom: 26, left: 40 };

/**
 * Volumes lidos ao longo da carga (uma série: a linha sobe a cada bipagem) com a linha do total.
 * Mira vertical + dica no ponto mais perto do cursor; setas do teclado andam de bipagem em bipagem.
 */
export function ProgressChart({ scans, total, startedAt, endAt }: { scans: { at: string; qty: number }[]; total: number; startedAt: string; endAt: number }) {
  const box = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(600);
  const [hover, setHover] = useState<number | null>(null);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(260, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const points = useMemo<Point[]>(() => {
    const asc = [...scans].reverse().map((s) => ({ t: new Date(s.at).getTime(), qty: s.qty }));
    const t0 = new Date(startedAt).getTime();
    return [{ t: t0, qty: asc.length ? Math.max(0, asc[0].qty - 1) : 0 }, ...asc.filter((p) => p.t >= t0)];
  }, [scans, startedAt]);

  const t0 = points[0].t;
  const t1 = Math.max(endAt, points[points.length - 1].t, t0 + 60_000);
  const yMax = Math.max(total, ...points.map((p) => p.qty), 1);
  const iw = w - PAD.left - PAD.right;
  const ih = H - PAD.top - PAD.bottom;
  const x = (t: number) => PAD.left + ((t - t0) / (t1 - t0)) * iw;
  const y = (q: number) => PAD.top + ih - (q / yMax) * ih;

  // degraus: a contagem fica parada entre uma bipagem e a próxima
  let line = `M${x(points[0].t)},${y(points[0].qty)}`;
  for (let i = 1; i < points.length; i++) line += `H${x(points[i].t)}V${y(points[i].qty)}`;
  line += `H${x(t1)}`;
  const area = `${line}V${y(0)}H${x(t0)}Z`;

  const ticks = [0, 1, 2, 3].map((i) => t0 + ((t1 - t0) * i) / 3);
  const hp = hover !== null ? points[hover] : null;

  function nearest(px: number) {
    const t = t0 + ((px - PAD.left) / iw) * (t1 - t0);
    let best = 0;
    for (let i = 1; i < points.length; i++) if (Math.abs(points[i].t - t) < Math.abs(points[best].t - t)) best = i;
    return best;
  }

  return (
    <div ref={box} className="chart">
      <svg
        width={w}
        height={H}
        role="img"
        aria-label={`Volumes lidos ao longo da carga: ${points[points.length - 1].qty} de ${total}`}
        tabIndex={0}
        onPointerMove={(e) => setHover(nearest(e.clientX - e.currentTarget.getBoundingClientRect().left))}
        onPointerLeave={() => setHover(null)}
        onFocus={() => setHover(points.length - 1)}
        onBlur={() => setHover(null)}
        onKeyDown={(e) => {
          if (e.key === "ArrowLeft") setHover((h) => Math.max(0, (h ?? points.length - 1) - 1));
          if (e.key === "ArrowRight") setHover((h) => Math.min(points.length - 1, (h ?? 0) + 1));
        }}
      >
        <line x1={PAD.left} x2={w - PAD.right} y1={y(0)} y2={y(0)} className="chart-axis" />
        <line x1={PAD.left} x2={w - PAD.right} y1={y(total)} y2={y(total)} className="chart-grid" />
        <text x={PAD.left - 6} y={y(total) + 4} textAnchor="end" className="chart-label">
          {total}
        </text>
        <text x={PAD.left - 6} y={y(0) + 4} textAnchor="end" className="chart-label">
          0
        </text>
        {ticks.map((t, i) => (
          <text key={i} x={x(t)} y={H - 8} textAnchor={i === 0 ? "start" : i === 3 ? "end" : "middle"} className="chart-label">
            {fmtClock(new Date(t).toISOString()).slice(0, 5)}
          </text>
        ))}
        <path d={area} className="chart-area" />
        <path d={line} className="chart-line" />
        {hp && (
          <>
            <line x1={x(hp.t)} x2={x(hp.t)} y1={PAD.top} y2={y(0)} className="chart-cross" />
            <circle cx={x(hp.t)} cy={y(hp.qty)} r={5} className="chart-dot" />
          </>
        )}
      </svg>
      {hp && (
        <div className="chart-tip" style={{ left: Math.min(Math.max(x(hp.t), 70), w - 70), top: Math.max(y(hp.qty) - 52, 0) }}>
          <strong>{hp.qty} volumes</strong>
          <span>{fmtClock(new Date(hp.t).toISOString())}</span>
        </div>
      )}
    </div>
  );
}
