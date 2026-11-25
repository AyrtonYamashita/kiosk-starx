import crypto from "node:crypto";
import { EventEmitter } from "node:events";
import type pg from "pg";
import { z } from "zod";

/**
 * Fase 2: eventos do leitor do SSW no coletor (versão 1 do formato).
 *
 * O coletor manda lotes assinados (HMAC-SHA256; a chave é o SHA-256 do token do aparelho, que nunca trafega):
 *   x-device-id, x-ts (ms, hora do aparelho corrigida pela do servidor), x-signature = HMAC(chave, `${ts}.${sha256(corpo)}`)
 * Cada evento tem id único (reenvio não duplica). O lote precisa ser mais novo que o último aceito.
 */
export const OPS_MAX_BODY = 64 * 1024;
export const OPS_MAX_EVENTS = 200;
export const OPS_MAX_SKEW_MS = 5 * 60_000;

/** Descarga (manifesto/coleta/romaneio) e carga (carga_*). */
export const OPS_FUNCTIONS = ["manifesto", "coleta", "romaneio", "carga_manifesto", "carga_coleta", "carga_romaneio"] as const;
const Fn = z.enum(OPS_FUNCTIONS);
const Screen = z.enum(["bipagem", "placa", "menu", "login", "outra"]);
const Num = z.number().finite().min(0).max(1e10);
const Totals = z.object({ qty: Num, kg: Num, value: Num });
const Str = (max: number) => z.string().trim().max(max);
const Plate = Str(20).min(1);
const Base = { id: z.uuid(), at: z.number().int().positive() };
/**
 * Campos extras do leitor (vêm da página, repassados pelo app sem conhecer). `scan`: código de barras que apareceu na
 * tela, com o tipo decidido pelo leitor e há quanto tempo (o leitor espera um pouco para saber se "Lidos" aumentou).
 * `error`: a mensagem que o SSW mostrou ao recusar o código (tipo "erro"), como apareceu na tela.
 */
export const SCAN_KINDS = ["lido", "outra", "nao_contou", "erro"] as const;
const Extra = z
  .object({
    scan: z
      .object({
        id: Str(40).min(1),
        code: Str(80).min(1),
        kind: z.enum(SCAN_KINDS),
        ageMs: z.number().int().min(0).max(600_000),
        error: Str(300).min(1).optional(),
      })
      .optional(),
  })
  .optional();

/**
 * Chave de agrupamento de uma mensagem de erro: sem acento, minúsculas, números trocados por "#" e espaços
 * normalizados. "CTRC 123 já lido" e "CTRC 456 já lido" caem no mesmo tipo de erro.
 */
export function errorKey(message: string): string {
  return (
    message
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/\d+([.,/-]\d+)*/g, "#")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 160) || "?"
  );
}

export const OpsEvent = z.discriminatedUnion("type", [
  z.object({ ...Base, type: z.literal("session"), user: Str(64).nullable(), domain: Str(20).nullable().optional(), branch: Str(20).nullable().optional() }),
  z.object({
    ...Base,
    type: z.literal("op_start"),
    fn: Fn,
    plate: Plate,
    realPlate: Str(20).nullable().optional(),
    units: z.array(Str(10)).max(20).optional(),
    total: Totals,
    read: Totals.optional(),
    extra: Extra,
  }),
  z.object({ ...Base, type: z.literal("progress"), fn: Fn, plate: Plate, total: Totals.optional(), read: Totals, extra: Extra }),
  z.object({ ...Base, type: z.literal("op_end"), fn: Fn, plate: Plate, reason: z.enum(["concluded", "interrupted", "left"]) }),
  z.object({
    ...Base,
    type: z.literal("heartbeat"),
    screen: Screen,
    user: Str(64).nullable().optional(),
    fn: Fn.nullable().optional(),
    plate: Str(20).nullable().optional(),
  }),
  // tela do SSW que o leitor não entendeu (bipagem sem função/placa/total, ou tela desconhecida): só a estrutura
  z.object({
    ...Base,
    type: z.literal("diag"),
    screen: Screen,
    reason: Str(60),
    path: Str(300),
    title: Str(120).optional(),
    ids: z.array(Str(80)).max(150).optional(),
    inputs: z.array(Str(80)).max(150).optional(),
    texts: z.array(Str(160)).max(40).optional(),
    reader: Str(40).optional(),
  }),
]);
export type OpsEvent = z.infer<typeof OpsEvent>;

export const OpsBatch = z.object({ schema: z.literal(1), events: z.array(OpsEvent).min(1).max(OPS_MAX_EVENTS) });

// ---------------------------------------------------------------- assinatura

export const sha256hex = (s: string | Buffer) => crypto.createHash("sha256").update(s).digest("hex");

/** HMAC do lote. `tokenHash` = SHA-256 (hex) do token do aparelho — o que o servidor guarda e o aparelho calcula. */
export function signBatch(tokenHash: string, ts: number, rawBody: string): string {
  return crypto.createHmac("sha256", tokenHash).update(`${ts}.${sha256hex(rawBody)}`).digest("hex");
}

export function signatureOk(tokenHash: string, ts: number, rawBody: string, signature: string): boolean {
  if (!/^[0-9a-f]{64}$/.test(signature)) return false;
  return crypto.timingSafeEqual(Buffer.from(signBatch(tokenHash, ts, rawBody), "hex"), Buffer.from(signature, "hex"));
}

// ---------------------------------------------------------------- avisos para a tela ao vivo (SSE, 2.3)

/** "o coletor X mudou": a tela ao vivo relê o card dele. */
export class OpsBus extends EventEmitter {
  changed(deviceId: string) {
    this.emit("change", deviceId);
  }
}

// ---------------------------------------------------------------- processamento

type Client = pg.PoolClient;
interface Open {
  id: string;
  fn: string;
  plate: string;
  read_qty: string;
  last_scan_at: Date | null;
}
interface State {
  ssw_user: string | null;
  domain: string | null;
  branch: string | null;
  screen: string | null;
  operation_id: string | null;
  last_event_at: Date | null;
  last_heartbeat_at: Date | null;
}

const ts = (ms: number) => new Date(ms);

/** Cargas abertas e encerradas e erros de bipagem novos de um lote (para as notificações, enviadas depois do COMMIT). */
export interface OpsNotes {
  started: string[];
  ended: string[];
  /** ids (ops_scans) das bipagens que viraram erro neste lote */
  scanErrors: string[];
}

async function openOp(c: Client, deviceId: string): Promise<Open | null> {
  return (
    (
      await c.query<Open>("SELECT id, fn, plate, read_qty, last_scan_at FROM ops_operations WHERE device_id = $1 AND ended_at IS NULL FOR UPDATE", [deviceId])
    ).rows[0] ?? null
  );
}

/**
 * O coletor voltou ao ar na mesma carga que a API encerrou por falta de sinal: reabre aquela carga em vez de
 * começar outra (o histórico não fica partido em duas).
 */
async function reopenLost(c: Client, deviceId: string, fn: string, plate: string): Promise<Open | null> {
  const r = await c.query<Open>(
    `UPDATE ops_operations SET ended_at = NULL, end_reason = NULL, updated_at = now()
     WHERE id = (SELECT id FROM ops_operations WHERE device_id = $1 ORDER BY started_at DESC LIMIT 1)
       AND end_reason = 'signal_lost' AND fn = $2 AND plate = $3 AND ended_at > now() - interval '24 hours'
     RETURNING id, fn, plate, read_qty, last_scan_at`,
    [deviceId, fn, plate],
  );
  return r.rows[0] ?? null;
}

async function closeOp(c: Client, opId: string, at: number, reason: string, notes: OpsNotes) {
  const r = await c.query("UPDATE ops_operations SET ended_at = GREATEST($2, started_at), end_reason = $3, updated_at = now() WHERE id = $1 AND ended_at IS NULL", [
    opId,
    ts(at),
    reason,
  ]);
  if (r.rowCount) notes.ended.push(opId);
}

async function startOp(
  c: Client,
  notes: OpsNotes,
  deviceId: string,
  st: State,
  e: { at: number; fn: string; plate: string; realPlate?: string | null; units?: string[]; total: { qty: number; kg: number; value: number }; read?: { qty: number; kg: number; value: number } },
) {
  const read = e.read ?? { qty: 0, kg: 0, value: 0 };
  const r = await c.query<{ id: string }>(
    `INSERT INTO ops_operations (device_id, fn, plate, real_plate, units, ssw_user, domain, branch, started_at,
       total_qty, total_kg, total_value, read_qty, read_kg, read_value)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15) RETURNING id`,
    [deviceId, e.fn, e.plate, e.realPlate ?? null, e.units ?? [], st.ssw_user, st.domain, st.branch, ts(e.at), e.total.qty, e.total.kg, e.total.value, read.qty, read.kg, read.value],
  );
  notes.started.push(r.rows[0].id);
  return r.rows[0].id;
}

/** Aplica um evento ao estado do coletor e às operações. Devolve a operação a que o evento pertence. */
async function applyEvent(c: Client, notes: OpsNotes, deviceId: string, st: State, e: OpsEvent): Promise<string | null> {
  if (!st.last_event_at || st.last_event_at.getTime() < e.at) st.last_event_at = ts(e.at);
  switch (e.type) {
    case "session": {
      st.ssw_user = e.user;
      if (e.domain !== undefined) st.domain = e.domain;
      if (e.branch !== undefined) st.branch = e.branch;
      // saiu do SSW com uma descarga aberta: ela termina aqui
      if (!e.user) {
        const open = await openOp(c, deviceId);
        if (open) await closeOp(c, open.id, e.at, "left", notes);
        st.operation_id = null;
        st.screen = "login";
      }
      return null;
    }
    case "op_start": {
      const open = (await openOp(c, deviceId)) ?? (await reopenLost(c, deviceId, e.fn, e.plate));
      st.screen = "bipagem";
      if (open && open.fn === e.fn && open.plate === e.plate) {
        // voltou à mesma descarga (recarregou a tela): só atualiza os dados
        await c.query(
          `UPDATE ops_operations SET real_plate = COALESCE($2, real_plate), units = CASE WHEN cardinality($3::text[]) > 0 THEN $3 ELSE units END,
             total_qty = $4, total_kg = $5, total_value = $6, updated_at = now() WHERE id = $1`,
          [open.id, e.realPlate ?? null, e.units ?? [], e.total.qty, e.total.kg, e.total.value],
        );
        st.operation_id = open.id;
        return open.id;
      }
      if (open) await closeOp(c, open.id, e.at, "replaced", notes);
      st.operation_id = await startOp(c, notes, deviceId, st, e);
      return st.operation_id;
    }
    case "progress": {
      let open = (await openOp(c, deviceId)) ?? (await reopenLost(c, deviceId, e.fn, e.plate));
      if (!open || open.fn !== e.fn || open.plate !== e.plate) {
        // o início se perdeu (ex.: app reiniciado no meio): abre a operação a partir do progresso
        if (open) await closeOp(c, open.id, e.at, "replaced", notes);
        const total = e.total ?? e.read;
        const id = await startOp(c, notes, deviceId, st, { ...e, total, read: e.read });
        st.operation_id = id;
        st.screen = "bipagem";
        return id;
      }
      const delta = e.read.qty - Number(open.read_qty);
      const scanned = delta > 0 ? Math.round(delta) : 0;
      // intervalo desde a bipagem anterior, dividido pelos volumes lidos desde então (tempo médio por volume)
      const interval = scanned && open.last_scan_at ? Math.max(0, e.at - open.last_scan_at.getTime()) : 0;
      await c.query(
        `UPDATE ops_operations SET read_qty = $2, read_kg = $3, read_value = $4,
           total_qty = COALESCE($5, total_qty), total_kg = COALESCE($6, total_kg), total_value = COALESCE($7, total_value),
           scans = scans + $8,
           first_scan_at = CASE WHEN $8 > 0 THEN COALESCE(first_scan_at, $9) ELSE first_scan_at END,
           last_scan_at = CASE WHEN $8 > 0 THEN GREATEST(COALESCE(last_scan_at, $9), $9) ELSE last_scan_at END,
           scan_interval_sum_ms = scan_interval_sum_ms + $10,
           scan_interval_count = scan_interval_count + CASE WHEN $10 > 0 THEN $8 ELSE 0 END,
           updated_at = now()
         WHERE id = $1`,
        [open.id, e.read.qty, e.read.kg, e.read.value, e.total?.qty ?? null, e.total?.kg ?? null, e.total?.value ?? null, scanned, ts(e.at), interval],
      );
      st.operation_id = open.id;
      st.screen = "bipagem";
      return open.id;
    }
    case "op_end": {
      const open = await openOp(c, deviceId);
      if (open) await closeOp(c, open.id, e.at, e.reason, notes);
      st.operation_id = null;
      st.screen = "placa";
      return open?.id ?? null;
    }
    case "diag":
      return st.operation_id;
    case "heartbeat": {
      st.screen = e.screen;
      if (e.user !== undefined) st.ssw_user = e.user;
      if (!st.last_heartbeat_at || st.last_heartbeat_at.getTime() < e.at) st.last_heartbeat_at = ts(e.at);
      return st.operation_id;
    }
  }
}

/** Aplica um lote (já validado e autenticado) numa transação. Eventos repetidos são ignorados. */
export async function applyBatch(c: Client, deviceId: string, events: OpsEvent[]) {
  const ids = events.map((e) => e.id);
  const seen = new Set((await c.query<{ id: string }>("SELECT id FROM ops_events WHERE id = ANY($1::uuid[])", [ids])).rows.map((r) => r.id));
  const fresh: OpsEvent[] = [];
  const inBatch = new Set<string>();
  for (const e of events) {
    if (seen.has(e.id) || inBatch.has(e.id)) continue;
    inBatch.add(e.id);
    fresh.push(e);
  }
  fresh.sort((a, b) => a.at - b.at);

  const row = (await c.query<State>("SELECT ssw_user, domain, branch, screen, operation_id, last_event_at, last_heartbeat_at FROM ops_device_state WHERE device_id = $1", [deviceId]))
    .rows[0];
  const st: State = row ?? { ssw_user: null, domain: null, branch: null, screen: null, operation_id: null, last_event_at: null, last_heartbeat_at: null };

  const notes: OpsNotes = { started: [], ended: [], scanErrors: [] };
  for (const e of fresh) {
    const opId = await applyEvent(c, notes, deviceId, st, e);
    const scan = (e.type === "op_start" || e.type === "progress") && e.extra?.scan;
    if (scan) {
      const error = scan.error ?? null;
      // o mesmo código chega de novo em retratos seguintes: o id do leitor evita repetir. A mensagem do SSW pode chegar
      // depois (rede lenta: o leitor já tinha dado "não contou"): o mesmo registro ganha a mensagem e vira erro.
      const r = await c.query<{ id: string; kind: string; operation_id: string | null }>(
        `INSERT INTO ops_scans (device_id, operation_id, scan_id, at, code, kind, read_qty, error, error_key)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (device_id, scan_id) DO UPDATE SET kind = EXCLUDED.kind, error = EXCLUDED.error, error_key = EXCLUDED.error_key
           WHERE ops_scans.error IS NULL AND EXCLUDED.error IS NOT NULL
         RETURNING id, kind, operation_id`,
        [deviceId, opId, scan.id, ts(e.at - scan.ageMs), scan.code, scan.kind, e.read?.qty ?? null, error, error ? errorKey(error) : null],
      );
      const row = r.rows[0];
      if (row?.kind === "erro") {
        notes.scanErrors.push(row.id);
        if (row.operation_id) await c.query("UPDATE ops_operations SET scan_errors = scan_errors + 1, updated_at = now() WHERE id = $1", [row.operation_id]);
      }
    }
    const { id, type, at, ...data } = e;
    await c.query("INSERT INTO ops_events (id, device_id, operation_id, type, at, data) VALUES ($1, $2, $3, $4, $5, $6)", [id, deviceId, opId, type, ts(at), data]);
  }
  if (fresh.length) {
    await c.query(
      `INSERT INTO ops_device_state (device_id, ssw_user, domain, branch, screen, operation_id, last_event_at, last_heartbeat_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now())
       ON CONFLICT (device_id) DO UPDATE SET ssw_user = $2, domain = $3, branch = $4, screen = $5, operation_id = $6,
         last_event_at = $7, last_heartbeat_at = $8, updated_at = now()`,
      [deviceId, st.ssw_user, st.domain, st.branch, st.screen, st.operation_id, st.last_event_at, st.last_heartbeat_at],
    );
  }
  return { accepted: fresh.length, duplicates: events.length - fresh.length, ...notes };
}

/**
 * Leitura do SSW ligada no coletor `d` (SQL): a escolha feita no próprio coletor ou, sem escolha, a chave geral
 * da empresa dele ("todos os coletores" / "só no piloto").
 */
export const OPS_READER_ON_SQL = "COALESCE(d.ops_reader, (SELECT reader_all FROM ops_settings os WHERE os.tenant_id = d.tenant_id), false)";
