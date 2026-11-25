import crypto from "node:crypto";
import type { Db } from "./db.js";
import { FN_LABEL } from "./opsLive.js";

/*
  Direitos dos titulares (LGPD, Art. 18) para os colaboradores dos clientes, identificados pelo usuário do SSW.
  Eles não acessam o painel: o administrador do cliente busca, exporta e anonimiza em nome deles.
  Ver .lgpd/dsar/workflow.md e .lgpd/dsar/endpoints.md.
*/

/** HMAC do identificador (a tabela de anonimizações nunca guarda o identificador em claro). */
export function subjectHash(secret: string, sswUser: string): string {
  return crypto.createHmac("sha256", `privacy-erasure:${secret}`).update(sswUser).digest("hex");
}

/** Busca colaboradores da empresa pelo começo do usuário do SSW (ou todos, sem `q`), com um resumo de cada um. */
export async function searchSubjects(db: Db, tenantId: string, q: string) {
  const like = q.replace(/[\\%_]/g, (c) => "\\" + c) + "%";
  const r = await db.query(
    `SELECT o.ssw_user AS user, count(*)::int AS operations, min(o.started_at) AS first_at, max(o.started_at) AS last_at,
            COALESCE(sum(o.scans), 0)::int AS scans
     FROM ops_operations o
     WHERE o.tenant_id = $2 AND o.ssw_user IS NOT NULL AND o.ssw_user ILIKE $1
     GROUP BY o.ssw_user ORDER BY max(o.started_at) DESC LIMIT 50`,
    [like, tenantId],
  );
  return r.rows.map((x) => ({ user: x.user, operations: x.operations, firstAt: x.first_at, lastAt: x.last_at, scans: x.scans }));
}

const DESCRIPTION = {
  finalidades: [
    "Acompanhar em tempo real as descargas e saber quem opera cada coletor",
    "Medir o andamento das cargas (ritmo, tempo na função, previsão de término)",
    "Rastrear volumes bipados para resolver divergências",
  ],
  origem: "Leitura da tela do sistema SSW no coletor de dados (o leitor não lê a senha nem clica ou digita no SSW)",
  destinatarios:
    "A empresa empregadora (controladora) e seus usuários autorizados do painel; o fornecedor do StarX Kiosk (operador) e os sub-operadores dele: hospedagem do servidor, Vercel, Cloudflare e Resend",
  prazos: {
    eventos_detalhados: "90 dias",
    bipagens: "365 dias",
    cargas_com_identificacao: "365 dias; depois o usuário do SSW é removido",
  },
  base_legal: "Legítimo interesse da empresa em organizar e controlar a operação (LGPD, Art. 7º, IX), conforme avaliação da empresa",
  direitos: "Confirmação, acesso, correção, anonimização, bloqueio, eliminação, portabilidade, informação sobre compartilhamento e oposição (LGPD, Art. 18), pelo canal de privacidade da empresa",
};

/**
 * Tudo o que a empresa tem sobre um colaborador (só registros dele; nenhum dado de colegas). O mesmo usuário do SSW
 * em outra empresa é outra pessoa para este fim: cada empresa responde pelos dados dela.
 */
export async function exportSubject(db: Db, tenantId: string, sswUser: string) {
  const ops = (
    await db.query(
      `SELECT o.id, o.fn, o.plate, o.real_plate, o.units, o.domain, o.branch, o.started_at, o.ended_at, o.end_reason,
              o.total_qty, o.total_kg, o.total_value, o.read_qty, o.read_kg, o.read_value, o.scans,
              o.scan_interval_sum_ms, o.scan_interval_count, d.name AS device
       FROM ops_operations o JOIN devices d ON d.id = o.device_id
       WHERE o.tenant_id = $2 AND o.ssw_user = $1 ORDER BY o.started_at`,
      [sswUser, tenantId],
    )
  ).rows;
  const ids = ops.map((o) => o.id);
  const scans = ids.length
    ? (
        await db.query(
          "SELECT operation_id, at, code, kind, read_qty, error FROM ops_scans WHERE operation_id = ANY($1::uuid[]) ORDER BY at",
          [ids],
        )
      ).rows
    : [];
  const events = (
    await db.query(
      `SELECT type, at, data FROM ops_events
       WHERE tenant_id = $3 AND (operation_id = ANY($1::uuid[]) OR (type IN ('session', 'heartbeat') AND data->>'user' = $2))
       ORDER BY at`,
      [ids, sswUser, tenantId],
    )
  ).rows;
  const current = (
    await db.query(
      "SELECT d.name AS device, s.screen, s.last_event_at FROM ops_device_state s JOIN devices d ON d.id = s.device_id WHERE s.tenant_id = $2 AND s.ssw_user = $1",
      [sswUser, tenantId],
    )
  ).rows;

  return {
    titular: { usuario_ssw: sswUser },
    gerado_em: new Date().toISOString(),
    sobre_o_tratamento: DESCRIPTION,
    cargas: ops.map((o) => ({
      id: o.id,
      funcao: FN_LABEL[o.fn] ?? o.fn,
      placa: o.real_plate || o.plate,
      unidades: o.units,
      dominio: o.domain,
      filial: o.branch,
      coletor: o.device,
      inicio: o.started_at,
      fim: o.ended_at,
      motivo_do_fim: o.end_reason,
      volumes: { total: Number(o.total_qty), lidos: Number(o.read_qty) },
      peso_kg: { total: Number(o.total_kg), lido: Number(o.read_kg) },
      valor: { total: Number(o.total_value), lido: Number(o.read_value) },
      bipagens: o.scans,
      segundos_por_volume: Number(o.scan_interval_count) > 0 ? Math.round(Number(o.scan_interval_sum_ms) / Number(o.scan_interval_count) / 100) / 10 : null,
    })),
    bipagens: scans.map((s) => ({ carga: s.operation_id, hora: s.at, codigo: s.code, tipo: s.kind, erro: s.error ?? undefined, lidos: s.read_qty === null ? null : Number(s.read_qty) })),
    eventos_guardados: events.map((e) => ({ tipo: e.type, hora: e.at, dados: e.data })),
    estado_atual: current.map((c) => ({ coletor: c.device, tela: c.screen, ultimo_evento: c.last_event_at })),
  };
}

/** Remove o usuário do SSW de todos os registros da empresa (as cargas ficam, sem identificação). Devolve o que mudou. */
export async function anonymizeSubject(db: Db, secret: string, tenantId: string, sswUser: string, adminId: string | null) {
  const c = await db.connect();
  try {
    await c.query("BEGIN");
    const r = await scrub(c, tenantId, sswUser);
    await c.query(
      "INSERT INTO privacy_erasures (tenant_id, kind, subject_hash, created_by) VALUES ($3, 'ssw_user', $1, $2) ON CONFLICT (tenant_id, kind, subject_hash) DO NOTHING",
      [subjectHash(secret, sswUser), adminId, tenantId],
    );
    await c.query("COMMIT");
    return r;
  } catch (err) {
    await c.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    c.release();
  }
}

type Q = { query: Db["query"] };
async function scrub(c: Q, tenantId: string, sswUser: string) {
  const n = async (sql: string) => (await c.query(sql, [sswUser, tenantId])).rowCount ?? 0;
  return {
    operations: await n("UPDATE ops_operations SET ssw_user = NULL, updated_at = now() WHERE tenant_id = $2 AND ssw_user = $1"),
    current: await n("UPDATE ops_device_state SET ssw_user = NULL, updated_at = now() WHERE tenant_id = $2 AND ssw_user = $1"),
    events: await n("UPDATE ops_events SET data = data - 'user' WHERE tenant_id = $2 AND type IN ('session', 'heartbeat') AND data->>'user' = $1"),
  };
}

/**
 * Depois de restaurar um backup anterior a uma anonimização, os identificadores voltam: esta rotina reaplica, empresa
 * por empresa (compara o HMAC de cada usuário ainda presente com a lista de anonimizados dela). Devolve quantos
 * foram reaplicados.
 */
export async function reapplyErasures(db: Db, secret: string): Promise<number> {
  const rows = (await db.query<{ t: string; h: string }>("SELECT tenant_id AS t, subject_hash AS h FROM privacy_erasures WHERE kind = 'ssw_user'")).rows;
  const byTenant = new Map<string, Set<string>>();
  for (const r of rows) byTenant.set(r.t, (byTenant.get(r.t) ?? new Set()).add(r.h));
  let n = 0;
  for (const [tenantId, erased] of byTenant) {
    const users = (
      await db.query<{ u: string }>(
        `SELECT ssw_user AS u FROM ops_operations WHERE tenant_id = $1 AND ssw_user IS NOT NULL
         UNION SELECT ssw_user FROM ops_device_state WHERE tenant_id = $1 AND ssw_user IS NOT NULL
         UNION SELECT data->>'user' FROM ops_events WHERE tenant_id = $1 AND type IN ('session', 'heartbeat') AND data->>'user' IS NOT NULL`,
        [tenantId],
      )
    ).rows.map((x) => x.u);
    for (const u of users) {
      if (!erased.has(subjectHash(secret, u))) continue;
      await scrub(db, tenantId, u);
      n++;
    }
  }
  return n;
}

/** Dados do próprio usuário do painel (Art. 18, II e V), sem segredos. */
export async function exportAdmin(db: Db, adminId: string) {
  const a = (await db.query("SELECT username, email, role, created_at, disabled_at, password_changed_at FROM admins WHERE id = $1", [adminId])).rows[0];
  const sessions = (await db.query("SELECT created_at, last_used_at, expires_at, ip, user_agent FROM sessions WHERE admin_id = $1 ORDER BY created_at", [adminId])).rows;
  const trusted = (await db.query("SELECT created_at, last_used_at, expires_at, ip, user_agent FROM trusted_devices WHERE admin_id = $1", [adminId])).rows;
  const passkeys = (await db.query("SELECT name, created_at, last_used_at FROM webauthn_credentials WHERE admin_id = $1", [adminId])).rows;
  const totp = (await db.query("SELECT created_at FROM admin_totp WHERE admin_id = $1", [adminId])).rows[0] ?? null;
  const recovery = Number((await db.query("SELECT count(*) FROM recovery_codes WHERE admin_id = $1 AND used_at IS NULL", [adminId])).rows[0].count);
  const events = (await db.query("SELECT event, created_at, ip, user_agent, details FROM auth_events WHERE admin_id = $1 ORDER BY created_at", [adminId])).rows;
  // aparelhos com notificação no celular (o endereço de push não sai: é só um identificador técnico do navegador)
  const push = (await db.query("SELECT user_agent, created_at, last_sent_at FROM push_subscriptions WHERE admin_id = $1 ORDER BY created_at", [adminId])).rows;
  const pushEvents = (await db.query("SELECT events FROM push_prefs WHERE admin_id = $1", [adminId])).rows[0]?.events ?? null;
  return {
    gerado_em: new Date().toISOString(),
    conta: { usuario: a.username, email: a.email, papel: a.role, criada_em: a.created_at, desativada_em: a.disabled_at, senha_alterada_em: a.password_changed_at },
    sessoes: sessions,
    navegadores_confiaveis: trusted,
    passkeys,
    app_autenticador: totp ? { ativo_desde: totp.created_at } : null,
    codigos_de_recuperacao_disponiveis: recovery,
    trilha_de_acesso_e_acoes: events,
    notificacoes_no_celular: { aparelhos: push, eventos_escolhidos: pushEvents },
  };
}
