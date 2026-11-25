import type { Db } from "./db.js";
import { FN_LABEL } from "./opsLive.js";
import type { Push, PushEvent, PushMessage } from "./push.js";

interface Row {
  id: string;
  tenant_id: string;
  device_id: string;
  device_name: string;
  fn: string;
  plate: string;
  real_plate: string | null;
  ssw_user: string | null;
  read_qty: string;
  total_qty: string;
  ended_at: Date | null;
  end_reason: string | null;
  end_detail?: string | null;
}

const ENDED: Record<string, (who: string, fn: string) => string> = {
  concluded: (who, fn) => `${who} concluiu ${fn}`,
  interrupted: (who, fn) => `${who} interrompeu ${fn}`,
  left: (who, fn) => `${who} saiu de ${fn} sem concluir`,
  replaced: (who, fn) => `${who} trocou de placa em ${fn}`,
  signal_lost: (who, fn) => `${who}: ${fn} encerrada (coletor sem sinal)`,
};
/** Carga encerrada por falta de sinal, com o motivo que o coletor avisou antes de calar. */
const QUIET_TITLE: Record<string, (who: string, fn: string) => string> = {
  tela_apagada: (who, fn) => `${who}: ${fn} encerrada (tela apagada)`,
  desligado: (who, fn) => `${who}: ${fn} encerrada (coletor desligado)`,
};

const qty = (v: string) => Math.round(Number(v));

/** Texto da notificação de uma carga (mesmo texto dos avisos do painel). A tag faz o fim substituir o início. */
export function opsMessage(o: Row, kind: "start" | "end"): { event: PushEvent; msg: PushMessage } {
  const who = o.ssw_user ?? "Alguém";
  const fn = FN_LABEL[o.fn] ?? o.fn;
  const plate = o.real_plate || o.plate;
  const read = qty(o.read_qty);
  const total = qty(o.total_qty);
  if (kind === "start") {
    return {
      event: "start",
      msg: { title: `${who} iniciou ${fn}`, body: `${plate} · ${total} volumes · ${o.device_name}`, url: `/operations/${o.device_id}`, tag: `op-${o.id}` },
    };
  }
  const done = o.end_reason === "concluded";
  return {
    event: done ? "done" : "stopped",
    msg: {
      title: (o.end_detail ? QUIET_TITLE[o.end_detail] : undefined)?.(who, fn) ?? ENDED[o.end_reason ?? ""]?.(who, fn) ?? `${fn} encerrada`,
      body: `${plate} · ${read}/${total} volumes${!done && total > read ? ` · faltaram ${total - read}` : ""} · ${o.device_name}`,
      url: `/operations/${o.device_id}?op=${o.id}`,
      tag: `op-${o.id}`,
    },
  };
}

/**
 * Notifica cargas abertas e encerradas (já gravadas). Carga aberta e fechada no mesmo lote só avisa o fim; carga
 * reaberta depois do envio (voltou o sinal) não avisa de novo. Nunca lança: roda em segundo plano.
 */
export async function notifyOps(db: Db, push: Push, started: string[], ended: string[]): Promise<void> {
  if (!push.enabled) return;
  const ids = [...new Set([...started, ...ended])];
  if (!ids.length) return;
  try {
    const rows = (
      await db.query<Row>(
        `SELECT o.id, o.tenant_id, o.device_id, d.name AS device_name, o.fn, o.plate, o.real_plate, o.ssw_user, o.read_qty, o.total_qty,
                o.ended_at, o.end_reason, o.end_detail
         FROM ops_operations o JOIN devices d ON d.id = o.device_id WHERE o.id = ANY ($1::uuid[])`,
        [ids],
      )
    ).rows;
    const byId = new Map(rows.map((r) => [r.id, r]));
    const endedSet = new Set(ended);
    const jobs: Promise<number>[] = [];
    for (const id of started) {
      const o = byId.get(id);
      if (!o || endedSet.has(id)) continue;
      const { event, msg } = opsMessage(o, "start");
      jobs.push(push.notify(o.tenant_id, event, msg));
    }
    for (const id of new Set(ended)) {
      const o = byId.get(id);
      if (!o?.ended_at) continue; // reaberta nesse meio tempo
      const { event, msg } = opsMessage(o, "end");
      jobs.push(push.notify(o.tenant_id, event, msg));
    }
    await Promise.all(jobs);
  } catch {
    // push.notify já registra as próprias falhas; aqui só a consulta, que não pode derrubar quem chamou
  }
}

/** Erro de bipagem: no máximo um aviso por carga a cada minuto (os seguintes vão no contador do próximo aviso). */
export const SCAN_ERROR_PUSH_GAP_MS = 60_000;
const lastErrorPush = new Map<string, number>();

interface ErrorRow {
  id: string;
  tenant_id: string;
  device_id: string;
  device_name: string;
  code: string;
  error: string | null;
  op_id: string | null;
  fn: string | null;
  plate: string | null;
  real_plate: string | null;
  ssw_user: string | null;
  scan_errors: number | null;
}

/** Texto da notificação de um erro de bipagem. A tag é da carga: o aviso novo substitui o anterior. */
export function scanErrorMessage(r: ErrorRow): PushMessage {
  const who = r.ssw_user ?? "Alguém";
  const fn = r.fn ? (FN_LABEL[r.fn] ?? r.fn) : "bipagem";
  const n = r.scan_errors ?? 1;
  return {
    title: `${who}: erro na ${fn}${n > 1 ? ` (${n} na carga)` : ""}`,
    body: `${r.error ?? "código recusado"} · código ${r.code} · ${r.real_plate || r.plate || "sem placa"} · ${r.device_name}`,
    url: r.op_id ? `/operations/${r.device_id}?op=${r.op_id}` : `/operations/${r.device_id}`,
    tag: `err-${r.op_id ?? r.device_id}`,
  };
}

/** Avisa os erros de bipagem novos (já gravados). Nunca lança: roda em segundo plano. */
export async function notifyScanErrors(db: Db, push: Push, scanIds: string[], now = Date.now()): Promise<void> {
  if (!push.enabled || !scanIds.length) return;
  try {
    const rows = (
      await db.query<ErrorRow>(
        `SELECT s.id, s.tenant_id, s.device_id, d.name AS device_name, s.code, s.error,
                o.id AS op_id, o.fn, o.plate, o.real_plate, o.ssw_user, o.scan_errors
         FROM ops_scans s JOIN devices d ON d.id = s.device_id LEFT JOIN ops_operations o ON o.id = s.operation_id
         WHERE s.id = ANY ($1::bigint[]) ORDER BY s.at DESC`,
        [scanIds],
      )
    ).rows;
    // um aviso por carga (o erro mais novo dela), respeitando o intervalo mínimo desde o último que alguém recebeu
    const seen = new Set<string>();
    const jobs: Promise<void>[] = [];
    for (const r of rows) {
      const key = r.op_id ?? r.device_id;
      if (seen.has(key)) continue;
      seen.add(key);
      if (now - (lastErrorPush.get(key) ?? 0) < SCAN_ERROR_PUSH_GAP_MS) continue;
      jobs.push(
        push.notify(r.tenant_id, "scan_error", scanErrorMessage(r)).then((n) => {
          if (n > 0) lastErrorPush.set(key, now);
        }),
      );
    }
    if (lastErrorPush.size > 5000) {
      for (const [k, at] of lastErrorPush) if (now - at >= SCAN_ERROR_PUSH_GAP_MS) lastErrorPush.delete(k);
    }
    await Promise.all(jobs);
  } catch {
    // idem notifyOps
  }
}
