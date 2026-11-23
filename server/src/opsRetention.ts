import type pg from "pg";
import type { Db } from "./db.js";

/**
 * Fase 2.5: limpeza dos eventos brutos do leitor do SSW (ops_events).
 *
 * - Sinal de vida: guardado poucos dias (só diz se o coletor estava vivo; o estado atual fica em ops_device_state).
 * - Demais eventos: 90 dias.
 * - Cargas (ops_operations): para sempre. Antes de apagar os eventos de uma carga, os pontos do gráfico de bipagens
 *   vão para ops_operations.scan_curve, e o detalhe continua igual.
 *
 * Apaga em lotes curtos para não segurar o banco (o recebimento de eventos continua durante a limpeza).
 */

/** Ponto do gráfico de uma carga: [hora em ms, volumes lidos]. */
export type CurvePoint = [number, number];

type Q = Pick<pg.PoolClient, "query"> | Db;

/**
 * Pontos do gráfico de uma carga: os guardados na carga (eventos já apagados) seguidos dos eventos mais novos que
 * eles (carga que continuou depois da limpeza), ou só os eventos.
 */
export async function loadCurve(q: Q, op: { id: string; scan_curve?: unknown }): Promise<CurvePoint[]> {
  const saved = Array.isArray(op.scan_curve) ? (op.scan_curve as CurvePoint[]) : [];
  const after = saved.length ? new Date(saved[saved.length - 1][0]) : null;
  const rows = (
    await q.query<{ at: Date; qty: string | null }>(
      `SELECT at, COALESCE((data->'read'->>'qty')::numeric, CASE WHEN type = 'op_start' THEN 0 END) AS qty
       FROM ops_events WHERE operation_id = $1 AND type IN ('op_start', 'progress') AND ($2::timestamptz IS NULL OR at > $2)
       ORDER BY at`,
      [op.id, after],
    )
  ).rows;
  return [...saved, ...rows.filter((r) => r.qty !== null).map((r): CurvePoint => [r.at.getTime(), Number(r.qty)])];
}

/** Bipagens (cada aumento de "lidos") com o intervalo desde a anterior, da mais antiga para a mais nova. */
export function scansFromCurve(points: CurvePoint[]) {
  const scans: { at: string; qty: number; delta: number; intervalSec: number | null }[] = [];
  let prevQty: number | null = null;
  let prevAt: number | null = null;
  for (const [at, qty] of points) {
    if (prevQty !== null && qty > prevQty) {
      scans.push({ at: new Date(at).toISOString(), qty, delta: qty - prevQty, intervalSec: prevAt !== null ? Math.round((at - prevAt) / 100) / 10 : null });
      prevAt = at;
    } else if (prevQty === null && qty > 0) {
      prevAt = null; // já começou com volumes lidos (retomada)
    }
    prevQty = qty;
  }
  return scans;
}

/** Só os pontos em que "lidos" muda (o resto não aparece no gráfico): é o que fica guardado na carga. */
function compact(points: CurvePoint[]): CurvePoint[] {
  const out: CurvePoint[] = [];
  for (const p of points) if (!out.length || out[out.length - 1][1] !== p[1]) out.push(p);
  return out;
}

export interface PruneOptions {
  eventDays: number;
  heartbeatDays: number;
  /** Códigos de barras bipados (ops_scans). Padrão 365. */
  scanDays?: number;
  /** Eventos apagados por comando (padrão 5.000). */
  batch?: number;
  /** Teto de lotes por rodada; o que sobrar sai na próxima (padrão 200 = 1 milhão de eventos). */
  maxBatches?: number;
}

export interface PruneResult {
  events: number;
  heartbeats: number;
  curves: number;
  scans: number;
}

/** Uma rodada de limpeza. */
export async function pruneOpsEvents(db: Db, o: PruneOptions): Promise<PruneResult> {
  const batch = o.batch ?? 5_000;
  let budget = o.maxBatches ?? 200;
  const res: PruneResult = { events: 0, heartbeats: 0, curves: 0, scans: 0 };

  // 1. sinais de vida
  while (budget-- > 0) {
    const n =
      (
        await db.query(
          `DELETE FROM ops_events WHERE id IN (
             SELECT id FROM ops_events WHERE type = 'heartbeat' AND received_at < now() - make_interval(days => $1) LIMIT $2)`,
          [o.heartbeatDays, batch],
        )
      ).rowCount ?? 0;
    res.heartbeats += n;
    if (n < batch) break;
  }

  // 2. gráfico das cargas que vão perder eventos agora
  const ops = (
    await db.query<{ id: string }>(
      `SELECT o.id FROM ops_operations o
       WHERE o.scan_curve IS NULL AND EXISTS (
         SELECT 1 FROM ops_events e WHERE e.operation_id = o.id AND e.received_at < now() - make_interval(days => $1))`,
      [o.eventDays],
    )
  ).rows;
  for (const { id } of ops) {
    const points = compact(await loadCurve(db, { id }));
    await db.query("UPDATE ops_operations SET scan_curve = $2 WHERE id = $1 AND scan_curve IS NULL", [id, JSON.stringify(points)]);
    res.curves++;
  }

  // 3. demais eventos
  while (budget-- > 0) {
    const n =
      (
        await db.query(
          `DELETE FROM ops_events WHERE id IN (
             SELECT id FROM ops_events WHERE received_at < now() - make_interval(days => $1) LIMIT $2)`,
          [o.eventDays, batch],
        )
      ).rowCount ?? 0;
    res.events += n;
    if (n < batch) break;
  }

  // 4. códigos de barras bipados
  while (budget-- > 0) {
    const n =
      (
        await db.query(
          `DELETE FROM ops_scans WHERE id IN (SELECT id FROM ops_scans WHERE at < now() - make_interval(days => $1) LIMIT $2)`,
          [o.scanDays ?? 365, batch],
        )
      ).rowCount ?? 0;
    res.scans += n;
    if (n < batch) break;
  }
  return res;
}

/** Roda a limpeza pouco depois de a API subir e depois a cada hora. Devolve a função que para. */
export function scheduleOpsRetention(
  db: Db,
  o: PruneOptions,
  log: { info: (obj: object, msg: string) => void; error: (obj: object, msg: string) => void },
  everyMs = 60 * 60_000,
): () => void {
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      const r = await pruneOpsEvents(db, o);
      if (r.events || r.heartbeats || r.curves || r.scans) log.info({ ...r, eventDays: o.eventDays, heartbeatDays: o.heartbeatDays }, "limpeza dos eventos do SSW");
    } catch (err) {
      log.error({ err }, "falha na limpeza dos eventos do SSW");
    } finally {
      running = false;
    }
  };
  const first = setTimeout(run, 60_000);
  const timer = setInterval(run, everyMs);
  first.unref();
  timer.unref();
  return () => {
    clearTimeout(first);
    clearInterval(timer);
  };
}

/**
 * Cargas abertas de coletores sem sinal há `afterMin` minutos (desligado, sem bateria, fora da rede): o app não
 * consegue encerrá-las, então a API encerra como "signal_lost" no horário da última bipagem. Se o coletor voltar na
 * mesma placa, a carga é reaberta (ops.ts). Devolve os coletores afetados (para avisar as telas ao vivo) e as cargas
 * encerradas (para as notificações).
 */
export async function closeStaleOps(db: Db, afterMin: number): Promise<{ devices: string[]; operations: string[] }> {
  const r = await db.query<{ device_id: string; id: string }>(
    `WITH stale AS (
       SELECT o.id, o.device_id, COALESCE(o.last_scan_at, o.started_at) AS at
       FROM ops_operations o JOIN ops_device_state s ON s.device_id = o.device_id
       WHERE o.ended_at IS NULL
         AND GREATEST(COALESCE(s.last_event_at, '-infinity'), COALESCE(s.last_heartbeat_at, '-infinity')) < now() - make_interval(mins => $1)
       FOR UPDATE OF o SKIP LOCKED)
     UPDATE ops_operations o SET ended_at = GREATEST(stale.at, o.started_at), end_reason = 'signal_lost', updated_at = now()
     FROM stale WHERE o.id = stale.id
     RETURNING o.device_id, o.id`,
    [afterMin],
  );
  const ids = [...new Set(r.rows.map((x) => x.device_id))];
  if (ids.length) {
    await db.query("UPDATE ops_device_state SET operation_id = NULL, updated_at = now() WHERE device_id = ANY($1) AND operation_id IS NOT NULL", [ids]);
  }
  return { devices: ids, operations: r.rows.map((x) => x.id) };
}

/** Confere a cada 5 min (e 1 min depois de subir). Devolve a função que para. */
export function scheduleStaleOps(
  db: Db,
  afterMin: number,
  onClosed: (deviceIds: string[], operationIds: string[]) => void,
  log: { info: (obj: object, msg: string) => void; error: (obj: object, msg: string) => void },
  everyMs = 5 * 60_000,
): () => void {
  const run = async () => {
    try {
      const { devices, operations } = await closeStaleOps(db, afterMin);
      if (devices.length) {
        log.info({ devices: devices.length, afterMin }, "cargas encerradas por falta de sinal");
        onClosed(devices, operations);
      }
    } catch (err) {
      log.error({ err }, "falha ao encerrar cargas sem sinal");
    }
  };
  const first = setTimeout(run, 60_000);
  const timer = setInterval(run, everyMs);
  first.unref();
  timer.unref();
  return () => {
    clearTimeout(first);
    clearInterval(timer);
  };
}
