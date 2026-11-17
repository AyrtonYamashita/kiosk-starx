import type { FastifyRequest } from "fastify";
import type { Db } from "./db.js";

/**
 * Bloqueio temporário e progressivo de login, por IP e por conta.
 *
 *  - conta: 5 falhas seguidas bloqueiam; IP: 20 (vários usuários podem sair pelo mesmo IP do galpão/escritório)
 *  - duração cresce a cada bloqueio seguido: 1 min → 5 min → 15 min → 1 h (teto)
 *  - 24 h sem falhas zeram o histórico; login certo zera a conta e o IP
 *  - a conta é o identificador digitado (usuário ou e-mail), exista ou não: a resposta não revela se a conta existe
 */
export type LockKind = "ip" | "account";

export const LOCK_THRESHOLD: Record<LockKind, number> = { account: 5, ip: 20 };
export const LOCK_STEPS_SEC = [60, 5 * 60, 15 * 60, 60 * 60];
const DECAY_MS = 24 * 3600_000;

export function lockKey(kind: LockKind, raw: string): string {
  return kind === "account" ? raw.trim().toLowerCase().slice(0, 200) : raw.slice(0, 64);
}

/** Segundos até liberar (0 = liberado). */
export async function lockedFor(db: Db, kind: LockKind, key: string): Promise<number> {
  const r = await db.query("SELECT extract(epoch FROM locked_until - now())::int AS sec FROM auth_lockouts WHERE kind = $1 AND key = $2 AND locked_until > now()", [
    kind,
    key,
  ]);
  return r.rows[0] ? Math.max(1, Number(r.rows[0].sec)) : 0;
}

/** Registra uma falha. Devolve os segundos de bloqueio se esta falha bloqueou (senão 0). */
export async function recordFailure(db: Db, kind: LockKind, key: string): Promise<number> {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const row = (await client.query("SELECT failures, level, last_failure_at FROM auth_lockouts WHERE kind = $1 AND key = $2 FOR UPDATE", [kind, key])).rows[0];
    let failures = row?.failures ?? 0;
    let level = row?.level ?? 0;
    if (row?.last_failure_at && Date.now() - new Date(row.last_failure_at).getTime() > DECAY_MS) {
      failures = 0;
      level = 0;
    }
    failures += 1;
    let lockSec = 0;
    if (failures >= LOCK_THRESHOLD[kind]) {
      lockSec = LOCK_STEPS_SEC[Math.min(level, LOCK_STEPS_SEC.length - 1)];
      level += 1;
      failures = 0;
    }
    await client.query(
      `INSERT INTO auth_lockouts (kind, key, failures, level, locked_until, last_failure_at)
       VALUES ($1, $2, $3, $4, CASE WHEN $5 > 0 THEN now() + make_interval(secs => $5) ELSE NULL END, now())
       ON CONFLICT (kind, key) DO UPDATE SET failures = $3, level = $4,
         locked_until = CASE WHEN $5 > 0 THEN now() + make_interval(secs => $5) ELSE auth_lockouts.locked_until END,
         last_failure_at = now()`,
      [kind, key, failures, level, lockSec],
    );
    await client.query("COMMIT");
    return lockSec;
  } catch (e) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
}

export async function clearLock(db: Db, kind: LockKind, key: string) {
  await db.query("DELETE FROM auth_lockouts WHERE kind = $1 AND key = $2", [kind, key]);
}

/** Evento de auditoria. Nunca grava senha, token ou código. */
export async function audit(
  db: Db,
  req: FastifyRequest,
  event: string,
  o: { adminId?: string | null; identifier?: string | null; details?: Record<string, unknown> } = {},
) {
  await db.query("INSERT INTO auth_events (admin_id, identifier, event, ip, user_agent, details) VALUES ($1, $2, $3, $4, $5, $6)", [
    o.adminId ?? null,
    o.identifier ?? null,
    event,
    req.ip,
    (req.headers["user-agent"] ?? "").toString().slice(0, 300) || null,
    o.details ?? null,
  ]);
}
