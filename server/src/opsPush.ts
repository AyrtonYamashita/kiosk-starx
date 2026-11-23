import type { Db } from "./db.js";
import { FN_LABEL } from "./opsLive.js";
import type { Push, PushEvent, PushMessage } from "./push.js";

interface Row {
  id: string;
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
}

const ENDED: Record<string, (who: string, fn: string) => string> = {
  concluded: (who, fn) => `${who} concluiu ${fn}`,
  interrupted: (who, fn) => `${who} interrompeu ${fn}`,
  left: (who, fn) => `${who} saiu de ${fn} sem concluir`,
  replaced: (who, fn) => `${who} trocou de placa em ${fn}`,
  signal_lost: (who, fn) => `${who}: ${fn} encerrada (coletor sem sinal)`,
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
      title: ENDED[o.end_reason ?? ""]?.(who, fn) ?? `${fn} encerrada`,
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
        `SELECT o.id, o.device_id, d.name AS device_name, o.fn, o.plate, o.real_plate, o.ssw_user, o.read_qty, o.total_qty,
                o.ended_at, o.end_reason
         FROM ops_operations o JOIN devices d ON d.id = o.device_id WHERE o.id = ANY ($1::uuid[])`,
        [ids],
      )
    ).rows;
    const byId = new Map(rows.map((r) => [r.id, r]));
    const endedSet = new Set(ended);
    const jobs: Promise<void>[] = [];
    for (const id of started) {
      const o = byId.get(id);
      if (!o || endedSet.has(id)) continue;
      const { event, msg } = opsMessage(o, "start");
      jobs.push(push.notify(event, msg));
    }
    for (const id of new Set(ended)) {
      const o = byId.get(id);
      if (!o?.ended_at) continue; // reaberta nesse meio tempo
      const { event, msg } = opsMessage(o, "end");
      jobs.push(push.notify(event, msg));
    }
    await Promise.all(jobs);
  } catch {
    // push.notify já registra as próprias falhas; aqui só a consulta, que não pode derrubar quem chamou
  }
}
