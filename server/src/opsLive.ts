import crypto from "node:crypto";
import { EventEmitter } from "node:events";
import { asSystem, type Db } from "./db.js";
import type { OpsBus } from "./ops.js";

/**
 * Tela "Acompanhamento de operações" (fase 2.3): cards por coletor, calculados aqui uma vez por mudança e repassados a
 * todas as telas abertas (SSE). A tela abre a conexão direto na API com um ingresso de uso único (60 s) que o painel
 * pede com a sessão do usuário.
 */
export const FN_LABEL: Record<string, string> = {
  manifesto: "Descarga de Manifesto",
  coleta: "Descarga de Coleta",
  romaneio: "Descarga de Romaneio",
  carga_manifesto: "Carga de Manifesto",
  carga_coleta: "Carga de Coleta",
  carga_romaneio: "Carga de Romaneio",
};

type Totals = { qty: number; kg: number; value: number };
export interface OpsCard {
  deviceId: string;
  deviceName: string;
  user: string | null;
  domain: string | null;
  branch: string | null;
  screen: string | null;
  lastSeenAt: string | null;
  operation: null | {
    id: string;
    fn: string;
    fnLabel: string;
    plate: string;
    realPlate: string | null;
    units: string[];
    startedAt: string;
    total: Totals;
    read: Totals;
    missing: Totals;
    scans: number;
    lastScanAt: string | null;
    /** tempo médio por volume (s), a partir dos intervalos entre bipagens */
    avgSecPerVolume: number | null;
    /** previsão de término: faltantes × tempo médio por volume, a partir da última bipagem */
    etaAt: string | null;
  };
}

const n = (v: unknown) => Number(v ?? 0);

export function opMetrics(o: {
  total_qty: unknown;
  total_kg: unknown;
  total_value: unknown;
  read_qty: unknown;
  read_kg: unknown;
  read_value: unknown;
  scan_interval_sum_ms: unknown;
  scan_interval_count: unknown;
  last_scan_at: Date | null;
}) {
  const total = { qty: n(o.total_qty), kg: n(o.total_kg), value: n(o.total_value) };
  const read = { qty: n(o.read_qty), kg: n(o.read_kg), value: n(o.read_value) };
  const missing = { qty: Math.max(0, total.qty - read.qty), kg: Math.max(0, total.kg - read.kg), value: Math.max(0, total.value - read.value) };
  const count = n(o.scan_interval_count);
  const avgMs = count > 0 ? n(o.scan_interval_sum_ms) / count : null;
  const etaAt = avgMs !== null && missing.qty > 0 && o.last_scan_at ? new Date(o.last_scan_at.getTime() + missing.qty * avgMs).toISOString() : null;
  return { total, read, missing, avgSecPerVolume: avgMs === null ? null : Math.round(avgMs / 100) / 10, etaAt };
}

const CARD_SQL = `
  SELECT d.id AS device_id, d.tenant_id, d.name AS device_name, s.ssw_user, s.domain, s.branch, s.screen,
         GREATEST(s.last_event_at, s.last_heartbeat_at) AS last_seen_at,
         o.id AS op_id, o.fn, o.plate, o.real_plate, o.units, o.started_at, o.total_qty, o.total_kg, o.total_value,
         o.read_qty, o.read_kg, o.read_value, o.scans, o.last_scan_at, o.scan_interval_sum_ms, o.scan_interval_count
  FROM ops_device_state s
  JOIN devices d ON d.id = s.device_id
  LEFT JOIN ops_operations o ON o.id = s.operation_id AND o.ended_at IS NULL`;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toCard(r: any): OpsCard {
  return {
    deviceId: r.device_id,
    deviceName: r.device_name,
    user: r.ssw_user,
    domain: r.domain,
    branch: r.branch,
    screen: r.screen,
    lastSeenAt: r.last_seen_at ? new Date(r.last_seen_at).toISOString() : null,
    operation: r.op_id
      ? {
          id: r.op_id,
          fn: r.fn,
          fnLabel: FN_LABEL[r.fn] ?? r.fn,
          plate: r.plate,
          realPlate: r.real_plate,
          units: r.units ?? [],
          startedAt: new Date(r.started_at).toISOString(),
          scans: r.scans,
          lastScanAt: r.last_scan_at ? new Date(r.last_scan_at).toISOString() : null,
          ...opMetrics(r),
        }
      : null,
  };
}

/** Cards dos coletores da empresa. */
export async function allCards(db: Db, tenantId: string): Promise<OpsCard[]> {
  return (await db.query(`${CARD_SQL} WHERE d.tenant_id = $1 ORDER BY d.name`, [tenantId])).rows.map(toCard);
}

/** Card de um coletor (com a empresa dele, para a tela ao vivo só mandar às telas daquela empresa). */
export async function deviceCardWithTenant(db: Db, deviceId: string): Promise<{ card: OpsCard; tenantId: string } | null> {
  const r = (await db.query(`${CARD_SQL} WHERE s.device_id = $1`, [deviceId])).rows[0];
  return r ? { card: toCard(r), tenantId: r.tenant_id } : null;
}

export async function deviceCard(db: Db, tenantId: string, deviceId: string): Promise<OpsCard | null> {
  const r = (await db.query(`${CARD_SQL} WHERE s.device_id = $1 AND d.tenant_id = $2`, [deviceId, tenantId])).rows[0];
  return r ? toCard(r) : null;
}

// ---------------------------------------------------------------- repasse

const DEBOUNCE_MS = 150;

/**
 * Recebe "coletor X mudou", junta mudanças rápidas (150 ms) e emite o card novo uma vez. Cada evento leva a empresa
 * do coletor: cada tela só recebe os da empresa dela.
 */
export class OpsLive extends EventEmitter {
  private pending = new Map<string, NodeJS.Timeout>();
  private tickets = new Map<string, { adminId: string; sessionId: string; tenantId: string; expiresAt: number }>();

  constructor(
    private db: Db,
    bus: OpsBus,
  ) {
    super();
    this.setMaxListeners(500);
    bus.on("change", (deviceId: string) => this.schedule(deviceId));
  }

  private schedule(deviceId: string) {
    if (this.pending.has(deviceId)) return;
    this.pending.set(
      deviceId,
      setTimeout(async () => {
        this.pending.delete(deviceId);
        try {
          // o coletor pode ser de qualquer empresa: como sistema (o card vai só às telas da empresa dele)
          const r = await asSystem(() => deviceCardWithTenant(this.db, deviceId));
          if (r) this.emit("card", r.card, r.tenantId);
        } catch {
          /* banco fora: a próxima mudança tenta de novo */
        }
      }, DEBOUNCE_MS),
    );
  }

  /** Aparelho removido: as telas tiram o card. */
  removed(deviceId: string, tenantId: string) {
    this.emit("removed", deviceId, tenantId);
  }

  issueTicket(adminId: string, sessionId: string, tenantId: string): { ticket: string; expiresAt: string } {
    const now = Date.now();
    for (const [k, v] of this.tickets) if (v.expiresAt < now) this.tickets.delete(k);
    const ticket = crypto.randomBytes(32).toString("base64url");
    const expiresAt = now + 60_000;
    this.tickets.set(crypto.createHash("sha256").update(ticket).digest("hex"), { adminId, sessionId, tenantId, expiresAt });
    return { ticket, expiresAt: new Date(expiresAt).toISOString() };
  }

  /** Uso único: o ingresso some ao ser usado. */
  takeTicket(ticket: string) {
    const key = crypto.createHash("sha256").update(ticket).digest("hex");
    const t = this.tickets.get(key);
    this.tickets.delete(key);
    return t && t.expiresAt > Date.now() ? t : null;
  }

  close() {
    for (const t of this.pending.values()) clearTimeout(t);
    this.pending.clear();
    this.removeAllListeners();
  }
}
