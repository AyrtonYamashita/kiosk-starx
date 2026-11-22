import type { Db } from "./db.js";
import { reapplyErasures } from "./privacy.js";

/*
  Prazos de guarda (LGPD, .lgpd/retention.md). Complementa a limpeza dos eventos do SSW (opsRetention.ts):
  - cargas com mais de `operationIdentifiedDays`: o usuário do SSW sai (fica NULL); os números da carga ficam
  - capturas de tela com mais de `screenshotDays`
  - comandos com mais de `commandDays`
  - trilha de login/ações com mais de `authEventDays`; registros sem conta (tentativas com usuário inexistente,
    bloqueios por IP) com mais de `authUnknownDays`
  - usuários do painel desativados há mais de `adminDisabledDays`: usuário e e-mail anonimizados, senha inutilizada,
    sessões e fatores de acesso apagados; a trilha continua ligada ao id, sem o que foi digitado
*/

export interface RetentionOptions {
  operationIdentifiedDays: number;
  screenshotDays: number;
  commandDays: number;
  authEventDays: number;
  authUnknownDays: number;
  adminDisabledDays: number;
  /** Com o segredo, reaplica anonimizações a pedido do titular depois de restaurar um backup antigo. */
  erasureSecret?: string;
}

export interface RetentionResult {
  operationsAnonymized: number;
  screenshots: number;
  commands: number;
  authEvents: number;
  adminsAnonymized: number;
  erasuresReapplied: number;
}

const ANON_PREFIX = "removido-";

/** Uma rodada (idempotente: o que já foi tratado não entra de novo). */
export async function applyRetention(db: Db, o: RetentionOptions): Promise<RetentionResult> {
  const count = async (sql: string, args: unknown[]) => (await db.query(sql, args)).rowCount ?? 0;

  const operationsAnonymized = await count(
    "UPDATE ops_operations SET ssw_user = NULL, updated_at = now() WHERE ssw_user IS NOT NULL AND started_at < now() - make_interval(days => $1)",
    [o.operationIdentifiedDays],
  );
  const screenshots = await count("DELETE FROM screenshots WHERE created_at < now() - make_interval(days => $1)", [o.screenshotDays]);
  const commands = await count(
    "DELETE FROM commands WHERE created_at < now() - make_interval(days => $1) AND status NOT IN ('pending', 'sent')",
    [o.commandDays],
  );
  const authEvents = await count(
    `DELETE FROM auth_events WHERE created_at < now() - make_interval(days => $1)
        OR (admin_id IS NULL AND created_at < now() - make_interval(days => $2))`,
    [o.authEventDays, o.authUnknownDays],
  );

  // usuários desativados há muito tempo: anonimiza um por um (cada um numa transação)
  const stale = (
    await db.query<{ id: string }>(
      `SELECT id FROM admins WHERE disabled_at IS NOT NULL AND disabled_at < now() - make_interval(days => $1)
         AND username NOT LIKE '${ANON_PREFIX}%'`,
      [o.adminDisabledDays],
    )
  ).rows;
  let adminsAnonymized = 0;
  for (const { id } of stale) {
    const c = await db.connect();
    try {
      await c.query("BEGIN");
      for (const t of ["sessions", "email_otps", "recovery_codes", "trusted_devices", "admin_totp", "webauthn_credentials", "webauthn_challenges", "upload_tokens"]) {
        await c.query(`DELETE FROM ${t} WHERE admin_id = $1`, [id]);
      }
      await c.query("UPDATE auth_events SET identifier = NULL WHERE admin_id = $1", [id]);
      await c.query(
        "UPDATE admins SET username = $2, email = NULL, password_hash = '!' WHERE id = $1",
        [id, ANON_PREFIX + id.slice(0, 8)],
      );
      await c.query("COMMIT");
      adminsAnonymized++;
    } catch (err) {
      await c.query("ROLLBACK").catch(() => {});
      throw err;
    } finally {
      c.release();
    }
  }

  const erasuresReapplied = o.erasureSecret ? await reapplyErasures(db, o.erasureSecret) : 0;

  return { operationsAnonymized, screenshots, commands, authEvents, adminsAnonymized, erasuresReapplied };
}

/** Roda pouco depois de a API subir e depois a cada 6 horas. Devolve a função que para. */
export function scheduleRetention(
  db: Db,
  o: RetentionOptions,
  log: { info: (obj: object, msg: string) => void; error: (obj: object, msg: string) => void },
  everyMs = 6 * 60 * 60_000,
): () => void {
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      const r = await applyRetention(db, o);
      if (Object.values(r).some(Boolean)) log.info({ ...r }, "prazos de guarda aplicados");
    } catch (err) {
      log.error({ err }, "falha ao aplicar os prazos de guarda");
    } finally {
      running = false;
    }
  };
  const first = setTimeout(run, 90_000);
  const timer = setInterval(run, everyMs);
  first.unref();
  timer.unref();
  return () => {
    clearTimeout(first);
    clearInterval(timer);
  };
}
