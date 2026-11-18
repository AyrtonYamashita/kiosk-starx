import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Config } from "../config.js";
import type { Db } from "../db.js";
import { allCards, deviceCard, FN_LABEL, opMetrics, type OpsLive } from "../opsLive.js";
import { loadCurve, scansFromCurve } from "../opsRetention.js";
import { OPS_READER_ON_SQL } from "../ops.js";
import { audit } from "../auth.js";
import type { Waker } from "../wake.js";

/** Painel (sessão normal): cards, detalhe de um coletor e ingresso para a conexão ao vivo. */
export async function opsAdminRoutes(app: FastifyInstance, opts: { db: Db; config: Config; live: OpsLive; waker: Waker }) {
  const { db, config, live, waker } = opts;

  /** Chave geral da leitura do SSW e quantos coletores leem agora. */
  app.get("/v1/admin/ops/settings", async () => {
    const r = (
      await db.query(
        `SELECT (SELECT reader_all FROM ops_settings LIMIT 1) AS reader_all, count(*)::int AS total,
                (count(*) FILTER (WHERE ${OPS_READER_ON_SQL}))::int AS reading,
                (count(*) FILTER (WHERE d.ops_reader IS NOT NULL))::int AS custom
         FROM devices d`,
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
      `UPDATE ops_settings s SET reader_all = $1, updated_at = now() FROM (SELECT reader_all AS before FROM ops_settings FOR UPDATE) o
       RETURNING o.before`,
      [body.data.readerAll],
    );
    if (r.rows[0]?.before !== body.data.readerAll) {
      await audit(db, req, body.data.readerAll ? "ops_reader_all_on" : "ops_reader_all_off", { adminId: req.admin!.id });
      // os coletores que seguem a chave geral ficam sabendo na hora
      const ids = (await db.query<{ id: string }>("SELECT id FROM devices WHERE ops_reader IS NULL")).rows.map((d) => d.id);
      waker.wake(ids);
    }
    return { ok: true };
  });

  app.get("/v1/admin/ops/cards", async () => ({ cards: await allCards(db), serverTime: Date.now() }));

  app.post("/v1/admin/ops/stream-ticket", async (req) => ({
    ...live.issueTicket(req.admin!.id, req.admin!.sessionId),
    url: `${config.publicUrl}/v1/ops/stream`,
  }));

  /** Detalhe: operação atual (ou ?op=), bipagens com intervalo, cargas de hoje e tempo do colaborador na função hoje. */
  app.get("/v1/admin/ops/devices/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const { op: opParam } = req.query as { op?: string };
    if (!z.uuid().safeParse(id).success || (opParam && !z.uuid().safeParse(opParam).success)) return reply.code(404).send({ error: "not_found" });
    const device = (await db.query("SELECT id, name FROM devices WHERE id = $1", [id])).rows[0];
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

    const today = (
      await db.query(
        `SELECT id, fn, plate, ssw_user, started_at, ended_at, end_reason, total_qty, read_qty, total_value, scans,
                extract(epoch FROM COALESCE(ended_at, now()) - started_at)::int AS duration_sec
         FROM ops_operations
         WHERE device_id = $1 AND started_at >= (date_trunc('day', now() AT TIME ZONE 'America/Sao_Paulo') AT TIME ZONE 'America/Sao_Paulo')
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
             WHERE ssw_user = $1 AND fn = $2 AND started_at >= (date_trunc('day', now() AT TIME ZONE 'America/Sao_Paulo') AT TIME ZONE 'America/Sao_Paulo')`,
            [op.ssw_user, op.fn],
          )
        ).rows[0].s,
      );
    }

    return {
      device,
      card: await deviceCard(db, id),
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
      today,
      functionTimeTodaySec,
      serverTime: Date.now(),
    };
  });
}

const MAX_STREAMS_PER_ADMIN = 10;
const MAX_STREAMS = 300;
const PING_MS = 15_000;
const SESSION_CHECK_MS = 60_000;

/** Conexão ao vivo (SSE), aberta pelo navegador direto na API com o ingresso. */
export async function opsStreamRoutes(app: FastifyInstance, opts: { db: Db; config: Config; live: OpsLive }) {
  const { db, config, live } = opts;
  const perAdmin = new Map<string, number>();
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
    if (total >= MAX_STREAMS || (perAdmin.get(t.adminId) ?? 0) >= MAX_STREAMS_PER_ADMIN) {
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
    const send = (event: string, data: unknown) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    // o navegador reconecta em 2 s se cair (com ingresso novo, pedido pela tela)
    res.write("retry: 2000\n\n");
    send("snapshot", { cards: await allCards(db), serverTime: Date.now() });

    const onCard = (card: unknown) => send("card", card);
    const onRemoved = (deviceId: string) => send("removed", { deviceId });
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
    };
    res.on("close", cleanup);
    res.on("error", cleanup);
  });
}
