import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Config } from "../config.js";
import type { Db } from "../db.js";
import { allCards, deviceCard, FN_LABEL, opMetrics, type OpsLive } from "../opsLive.js";
import { loadCurve, scansFromCurve } from "../opsRetention.js";
import { OPS_READER_ON_SQL } from "../ops.js";
import { audit } from "../auth.js";
import type { Waker } from "../wake.js";
import { tenantOf } from "../tenant.js";

/** Painel (sessão normal, escopo de empresa): cards, detalhe de um coletor e ingresso para a conexão ao vivo. */
export async function opsAdminRoutes(app: FastifyInstance, opts: { db: Db; config: Config; live: OpsLive; waker: Waker }) {
  const { db, config, live, waker } = opts;
  // fuso da operação (validado no config): o dia começa à meia-noite local, não de Brasília nem UTC
  const TZ = config.timeZone;

  /** Consulta por código de barras: em que carga, coletor, colaborador e hora foi bipado (código inteiro ou começo). */
  app.get("/v1/admin/ops/scans", async (req, reply) => {
    const code = String((req.query as { code?: string }).code ?? "").trim();
    if (code.length < 3 || code.length > 80) return reply.code(400).send({ error: "invalid_code", message: "Digite pelo menos 3 caracteres do código." });
    const prefix = code.replace(/[\\%_]/g, (c) => "\\" + c) + "%";
    const r = await db.query(
      `SELECT s.at, s.code, s.kind, s.read_qty, d.id AS device_id, d.name AS device_name,
              o.id AS op_id, o.fn, o.plate, o.ssw_user, o.branch, o.started_at, o.ended_at, o.end_reason
       FROM ops_scans s JOIN devices d ON d.id = s.device_id LEFT JOIN ops_operations o ON o.id = s.operation_id
       WHERE s.tenant_id = $3 AND (s.code = $1 OR s.code LIKE $2)
       ORDER BY (s.code = $1) DESC, s.at DESC LIMIT 100`,
      [code, prefix, tenantOf(req)],
    );
    return {
      results: r.rows.map((x) => ({
        at: x.at,
        code: x.code,
        kind: x.kind,
        readQty: x.read_qty === null ? null : Number(x.read_qty),
        device: { id: x.device_id, name: x.device_name },
        operation: x.op_id
          ? {
              id: x.op_id,
              fn: x.fn,
              fnLabel: FN_LABEL[x.fn] ?? x.fn,
              plate: x.plate,
              user: x.ssw_user,
              branch: x.branch,
              startedAt: x.started_at,
              endedAt: x.ended_at,
              endReason: x.end_reason,
            }
          : null,
      })),
    };
  });

  /**
   * Histórico de cargas: da mais nova para a mais antiga, 50 por página (continua com `before`, o cursor da última).
   * Filtros: placa (começo ou parte, sem diferenciar maiúsculas), usuário do SSW, função, situação e período (dias,
   * no fuso da operação, TIME_ZONE).
   */
  const OpsListQuery = z.object({
    plate: z.string().trim().max(20).optional(),
    user: z.string().trim().max(80).optional(),
    fn: z.string().trim().max(30).optional(),
    status: z.enum(["open", "concluded", "interrupted", "left", "replaced", "signal_lost"]).optional(),
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    before: z.string().regex(/^\d{13}_[0-9a-f-]{36}$/).optional(),
  });
  app.get("/v1/admin/ops/operations", async (req, reply) => {
    const q = OpsListQuery.safeParse(req.query);
    if (!q.success) return reply.code(400).send({ error: "invalid_query" });
    const f = q.data;
    const args: unknown[] = [tenantOf(req)];
    const where: string[] = ["o.tenant_id = $1"];
    const add = (sql: string, v: unknown) => {
      args.push(v);
      where.push(sql.replace("?", `$${args.length}`));
    };
    if (f.plate) {
      args.push("%" + f.plate.toUpperCase().replace(/[\\%_]/g, (c) => "\\" + c) + "%");
      where.push(`(upper(o.plate) LIKE $${args.length} OR upper(COALESCE(o.real_plate, '')) LIKE $${args.length})`);
    }
    if (f.user) add("o.ssw_user = ?", f.user);
    if (f.fn) add("o.fn = ?", f.fn);
    if (f.status === "open") where.push("o.ended_at IS NULL");
    else if (f.status) add("o.end_reason = ?", f.status);
    // dia local: a data vira timestamp sem fuso e só então é lida no fuso da operação (date AT TIME ZONE
    // usaria o fuso da sessão do banco, UTC, e deslocava o dia)
    if (f.from) add(`o.started_at >= (?::date::timestamp AT TIME ZONE '${TZ}')`, f.from);
    if (f.to) add(`o.started_at < ((?::date + 1)::timestamp AT TIME ZONE '${TZ}')`, f.to);
    if (f.before) {
      const [ms, id] = f.before.split("_");
      args.push(new Date(Number(ms)), id);
      where.push(`(o.started_at, o.id) < ($${args.length - 1}, $${args.length}::uuid)`);
    }
    const r = await db.query(
      `SELECT o.id, o.device_id, d.name AS device_name, o.fn, o.plate, o.real_plate, o.ssw_user, o.branch, o.units,
              o.started_at, o.ended_at, o.end_reason, o.total_qty, o.read_qty, o.total_value, o.read_value, o.scans,
              o.scan_interval_sum_ms, o.scan_interval_count,
              extract(epoch FROM COALESCE(o.ended_at, now()) - o.started_at)::int AS duration_sec
       FROM ops_operations o JOIN devices d ON d.id = o.device_id
       WHERE ${where.join(" AND ")}
       ORDER BY o.started_at DESC, o.id DESC LIMIT 51`,
      args,
    );
    const rows = r.rows.slice(0, 50);
    const last = rows[rows.length - 1];
    const users = (
      await db.query<{ u: string }>(
        "SELECT DISTINCT ssw_user AS u FROM ops_operations WHERE tenant_id = $1 AND ssw_user IS NOT NULL AND started_at > now() - interval '180 days' ORDER BY 1 LIMIT 500",
        [tenantOf(req)],
      )
    ).rows.map((x) => x.u);
    return {
      operations: rows.map((o) => ({
        id: o.id,
        device: { id: o.device_id, name: o.device_name },
        fn: o.fn,
        fnLabel: FN_LABEL[o.fn] ?? o.fn,
        plate: o.plate,
        realPlate: o.real_plate,
        user: o.ssw_user,
        branch: o.branch,
        units: o.units ?? [],
        startedAt: o.started_at,
        endedAt: o.ended_at,
        endReason: o.end_reason,
        durationSec: o.duration_sec,
        totalQty: Number(o.total_qty),
        readQty: Number(o.read_qty),
        totalValue: Number(o.total_value),
        readValue: Number(o.read_value),
        scans: o.scans,
        avgSecPerVolume: Number(o.scan_interval_count) > 0 ? Math.round(Number(o.scan_interval_sum_ms) / Number(o.scan_interval_count) / 100) / 10 : null,
      })),
      next: r.rows.length > 50 && last ? `${new Date(last.started_at).getTime()}_${last.id}` : null,
      users,
      functions: Object.entries(FN_LABEL).map(([value, label]) => ({ value, label })),
    };
  });

  /** Chave geral da leitura do SSW e quantos coletores leem agora. */
  app.get("/v1/admin/ops/settings", async (req) => {
    const r = (
      await db.query(
        `SELECT (SELECT reader_all FROM ops_settings WHERE tenant_id = $1) AS reader_all, count(*)::int AS total,
                (count(*) FILTER (WHERE ${OPS_READER_ON_SQL}))::int AS reading,
                (count(*) FILTER (WHERE d.ops_reader IS NOT NULL))::int AS custom
         FROM devices d WHERE d.tenant_id = $1`,
        [tenantOf(req)],
      )
    ).rows[0];
    return { readerAll: r.reader_all === true, devices: { total: r.total, reading: r.reading, custom: r.custom } };
  });

  /** Liga a leitura em todos os coletores (menos os desligados um a um) ou volta para só o piloto. Só administradores. */
  app.put("/v1/admin/ops/settings", async (req, reply) => {
    if (req.admin?.role !== "admin") return reply.code(403).send({ error: "forbidden", message: "só administradores" });
    const body = z.object({ readerAll: z.boolean() }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "invalid_body" });
    const r = await db.query(
      `UPDATE ops_settings s SET reader_all = $1, updated_at = now()
       FROM (SELECT tenant_id, reader_all AS before FROM ops_settings WHERE tenant_id = $2 FOR UPDATE) o
       WHERE s.tenant_id = o.tenant_id RETURNING o.before`,
      [body.data.readerAll, tenantOf(req)],
    );
    if (r.rows[0]?.before !== body.data.readerAll) {
      await audit(db, req, body.data.readerAll ? "ops_reader_all_on" : "ops_reader_all_off", { adminId: req.admin!.id });
      // os coletores que seguem a chave geral ficam sabendo na hora
      const ids = (await db.query<{ id: string }>("SELECT id FROM devices WHERE tenant_id = $1 AND ops_reader IS NULL", [tenantOf(req)])).rows.map((d) => d.id);
      waker.wake(ids);
    }
    return { ok: true };
  });

  app.get("/v1/admin/ops/cards", async (req) => ({ cards: await allCards(db, tenantOf(req)), serverTime: Date.now() }));

  app.post("/v1/admin/ops/stream-ticket", async (req) => ({
    ...live.issueTicket(req.admin!.id, req.admin!.sessionId, tenantOf(req)),
    url: `${config.publicUrl}/v1/ops/stream`,
  }));

  /** Detalhe: operação atual (ou ?op=), bipagens com intervalo, cargas de hoje e tempo do colaborador na função hoje. */
  app.get("/v1/admin/ops/devices/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const { op: opParam } = req.query as { op?: string };
    if (!z.uuid().safeParse(id).success || (opParam && !z.uuid().safeParse(opParam).success)) return reply.code(404).send({ error: "not_found" });
    const tenantId = tenantOf(req);
    const device = (await db.query("SELECT id, name FROM devices WHERE id = $1 AND tenant_id = $2", [id, tenantId])).rows[0];
    if (!device) return reply.code(404).send({ error: "not_found" });

    const op = (
      await db.query(
        opParam
          ? "SELECT * FROM ops_operations WHERE id = $2 AND device_id = $1"
          : "SELECT * FROM ops_operations WHERE device_id = $1 ORDER BY (ended_at IS NULL) DESC, started_at DESC LIMIT 1",
        opParam ? [id, opParam] : [id],
      )
    ).rows[0];

    // bipagens: cada aumento de "lidos", com o intervalo desde o aumento anterior (eventos ou gráfico guardado na carga)
    const scans = op ? scansFromCurve(await loadCurve(db, op)) : [];
    // códigos de barras lidos na tela (0.5.2), do mais novo para o mais antigo
    const codes = op
      ? (
          await db.query(
            "SELECT at, code, kind, read_qty FROM ops_scans WHERE operation_id = $1 ORDER BY at DESC, id DESC LIMIT 1000",
            [op.id],
          )
        ).rows.map((r) => ({ at: r.at, code: r.code, kind: r.kind, readQty: r.read_qty === null ? null : Number(r.read_qty) }))
      : [];

    const today = (
      await db.query(
        `SELECT id, fn, plate, ssw_user, started_at, ended_at, end_reason, total_qty, read_qty, total_value, scans,
                extract(epoch FROM COALESCE(ended_at, now()) - started_at)::int AS duration_sec
         FROM ops_operations
         WHERE device_id = $1 AND started_at >= (date_trunc('day', now() AT TIME ZONE '${TZ}') AT TIME ZONE '${TZ}')
         ORDER BY started_at DESC LIMIT 100`,
        [id],
      )
    ).rows.map((o) => ({
      id: o.id,
      fn: o.fn,
      fnLabel: FN_LABEL[o.fn] ?? o.fn,
      plate: o.plate,
      user: o.ssw_user,
      startedAt: o.started_at,
      endedAt: o.ended_at,
      endReason: o.end_reason,
      durationSec: o.duration_sec,
      totalQty: Number(o.total_qty),
      readQty: Number(o.read_qty),
      totalValue: Number(o.total_value),
      scans: o.scans,
    }));

    // tempo do colaborador nesta função hoje (todas as cargas dele nessa função, em qualquer coletor)
    let functionTimeTodaySec: number | null = null;
    if (op?.ssw_user) {
      functionTimeTodaySec = Number(
        (
          await db.query(
            `SELECT COALESCE(sum(extract(epoch FROM COALESCE(ended_at, now()) - started_at)), 0)::int AS s FROM ops_operations
             WHERE tenant_id = $3 AND ssw_user = $1 AND fn = $2 AND started_at >= (date_trunc('day', now() AT TIME ZONE '${TZ}') AT TIME ZONE '${TZ}')`,
            [op.ssw_user, op.fn, tenantId],
          )
        ).rows[0].s,
      );
    }

    return {
      device,
      card: await deviceCard(db, tenantId, id),
      operation: op
        ? {
            id: op.id,
            fn: op.fn,
            fnLabel: FN_LABEL[op.fn] ?? op.fn,
            plate: op.plate,
            realPlate: op.real_plate,
            units: op.units ?? [],
            user: op.ssw_user,
            domain: op.domain,
            branch: op.branch,
            startedAt: op.started_at,
            endedAt: op.ended_at,
            endReason: op.end_reason,
            scans: op.scans,
            firstScanAt: op.first_scan_at,
            lastScanAt: op.last_scan_at,
            ...opMetrics(op),
          }
        : null,
      scans: scans.reverse().slice(0, 300),
      codes,
      today,
      functionTimeTodaySec,
      serverTime: Date.now(),
    };
  });
}

const MAX_STREAMS_PER_ADMIN = 10;
const MAX_STREAMS_PER_TENANT = 100;
const MAX_STREAMS = 300;
const PING_MS = 15_000;
const SESSION_CHECK_MS = 60_000;

/** Conexão ao vivo (SSE), aberta pelo navegador direto na API com o ingresso. */
export async function opsStreamRoutes(app: FastifyInstance, opts: { db: Db; config: Config; live: OpsLive }) {
  const { db, config, live } = opts;
  const perAdmin = new Map<string, number>();
  const perTenant = new Map<string, number>();
  let total = 0;
  const open = new Set<import("node:http").ServerResponse>();
  // ao desligar a API: fecha as conexões abertas (senão o desligamento espera por elas)
  app.addHook("preClose", async () => {
    for (const r of open) r.end();
  });

  app.get("/v1/ops/stream", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (req, reply) => {
    const origin = req.headers.origin;
    const cors: Record<string, string> = origin && config.panelOrigins.includes(origin) ? { "access-control-allow-origin": origin, vary: "origin" } : {};
    const { ticket } = req.query as { ticket?: string };
    const t = typeof ticket === "string" && ticket.length < 200 ? live.takeTicket(ticket) : null;
    if (!t) return reply.code(401).headers(cors).send({ error: "unauthorized" });
    const sessionOk = async () =>
      !!(
        await db.query(
          `SELECT 1 FROM sessions s JOIN admins a ON a.id = s.admin_id
           WHERE s.id = $1 AND s.stage = 'full' AND s.expires_at > now() AND a.disabled_at IS NULL`,
          [t.sessionId],
        )
      ).rowCount;
    if (!(await sessionOk())) return reply.code(401).headers(cors).send({ error: "unauthorized" });
    if (total >= MAX_STREAMS || (perAdmin.get(t.adminId) ?? 0) >= MAX_STREAMS_PER_ADMIN || (perTenant.get(t.tenantId) ?? 0) >= MAX_STREAMS_PER_TENANT) {
      return reply.code(429).headers(cors).send({ error: "too_many_streams", message: "muitas telas abertas" });
    }

    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, {
      ...cors,
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-store, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    });
    total++;
    open.add(res);
    perAdmin.set(t.adminId, (perAdmin.get(t.adminId) ?? 0) + 1);
    perTenant.set(t.tenantId, (perTenant.get(t.tenantId) ?? 0) + 1);
    const send = (event: string, data: unknown) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    // o navegador reconecta em 2 s se cair (com ingresso novo, pedido pela tela)
    res.write("retry: 2000\n\n");
    send("snapshot", { cards: await allCards(db, t.tenantId), serverTime: Date.now() });

    // só os coletores da empresa do ingresso
    const onCard = (card: unknown, tenantId: string) => {
      if (tenantId === t.tenantId) send("card", card);
    };
    const onRemoved = (deviceId: string, tenantId: string) => {
      if (tenantId === t.tenantId) send("removed", { deviceId });
    };
    live.on("card", onCard);
    live.on("removed", onRemoved);
    const ping = setInterval(() => send("ping", { serverTime: Date.now() }), PING_MS);
    // a tela aberta conta como uso da sessão (TV de acompanhamento); sessão encerrada/expirada fecha a conexão
    const check = setInterval(async () => {
      try {
        if (!(await sessionOk())) {
          send("end", { reason: "session" });
          res.end();
          return;
        }
        await db.query("UPDATE sessions SET last_used_at = now() WHERE id = $1", [t.sessionId]);
      } catch {
        /* banco fora: tenta na próxima */
      }
    }, SESSION_CHECK_MS);

    let closed = false;
    const cleanup = () => {
      if (closed) return;
      closed = true;
      open.delete(res);
      clearInterval(ping);
      clearInterval(check);
      live.off("card", onCard);
      live.off("removed", onRemoved);
      total--;
      const left = (perAdmin.get(t.adminId) ?? 1) - 1;
      if (left > 0) perAdmin.set(t.adminId, left);
      else perAdmin.delete(t.adminId);
      const leftT = (perTenant.get(t.tenantId) ?? 1) - 1;
      if (leftT > 0) perTenant.set(t.tenantId, leftT);
      else perTenant.delete(t.tenantId);
    };
    res.on("close", cleanup);
    res.on("error", cleanup);
  });
}
