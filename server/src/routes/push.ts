import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Db } from "../db.js";
import { PUSH_DEFAULT, PUSH_EVENTS, validEndpoint, type Push } from "../push.js";

const Subscribe = z.object({
  endpoint: z.string().max(1000).refine(validEndpoint, "endpoint"),
  keys: z.object({
    // chave pública P-256 (65 bytes) e segredo (16 bytes), em base64url
    p256dh: z.string().regex(/^[A-Za-z0-9_-]{80,100}={0,2}$/),
    auth: z.string().regex(/^[A-Za-z0-9_-]{16,32}={0,2}$/),
  }),
});
const Unsubscribe = z.object({ endpoint: z.string().max(1000) });
const Events = z.object({ events: z.array(z.enum(PUSH_EVENTS)).max(PUSH_EVENTS.length) });

/** Notificações no celular: cada usuário inscreve os aparelhos dele e escolhe os eventos. */
export async function pushRoutes(app: FastifyInstance, opts: { db: Db; push: Push }) {
  const { db, push } = opts;

  app.get("/v1/admin/push", async (req) => {
    const adminId = req.admin!.id;
    const prefs = await db.query<{ events: string[] }>("SELECT events FROM push_prefs WHERE admin_id = $1", [adminId]);
    const subs = await db.query("SELECT endpoint, user_agent, created_at, last_sent_at FROM push_subscriptions WHERE admin_id = $1 ORDER BY created_at", [adminId]);
    return {
      enabled: push.enabled,
      publicKey: push.publicKey,
      events: prefs.rows[0]?.events ?? [...PUSH_DEFAULT],
      subscriptions: subs.rows.map((s) => ({ endpoint: s.endpoint, userAgent: s.user_agent, createdAt: s.created_at, lastSentAt: s.last_sent_at })),
    };
  });

  app.post("/v1/admin/push/subscribe", { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } }, async (req, reply) => {
    if (!push.enabled) return reply.code(503).send({ error: "push_disabled", message: "Notificações não configuradas no servidor." });
    const b = Subscribe.safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: "invalid_body" });
    const limit = await db.query<{ n: number }>("SELECT count(*)::int AS n FROM push_subscriptions WHERE admin_id = $1 AND endpoint <> $2", [
      req.admin!.id,
      b.data.endpoint,
    ]);
    if (limit.rows[0].n >= 10) return reply.code(409).send({ error: "too_many", message: "Limite de 10 aparelhos com notificação por usuário." });
    // o mesmo navegador inscrito por outro usuário passa a ser deste (quem está logado nele agora)
    await db.query(
      `INSERT INTO push_subscriptions (admin_id, endpoint, p256dh, auth, user_agent) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (endpoint) DO UPDATE SET admin_id = EXCLUDED.admin_id, tenant_id = EXCLUDED.tenant_id, p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth,
         user_agent = EXCLUDED.user_agent, failures = 0`,
      [req.admin!.id, b.data.endpoint, b.data.keys.p256dh, b.data.keys.auth, (req.headers["user-agent"] ?? "").slice(0, 300) || null],
    );
    return { ok: true };
  });

  app.post("/v1/admin/push/unsubscribe", async (req, reply) => {
    const b = Unsubscribe.safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: "invalid_body" });
    const r = await db.query("DELETE FROM push_subscriptions WHERE admin_id = $1 AND endpoint = $2", [req.admin!.id, b.data.endpoint]);
    return { ok: true, removed: r.rowCount ?? 0 };
  });

  app.put("/v1/admin/push/events", async (req, reply) => {
    const b = Events.safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: "invalid_body" });
    const events = PUSH_EVENTS.filter((e) => b.data.events.includes(e));
    await db.query(
      `INSERT INTO push_prefs (admin_id, events) VALUES ($1, $2) ON CONFLICT (admin_id) DO UPDATE SET events = EXCLUDED.events, updated_at = now()`,
      [req.admin!.id, events],
    );
    return { ok: true, events };
  });

  app.post("/v1/admin/push/test", { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } }, async (req, reply) => {
    if (!push.enabled) return reply.code(503).send({ error: "push_disabled", message: "Notificações não configuradas no servidor." });
    const r = await push.toAdmin(req.admin!.id, {
      title: "Starx Kiosk",
      body: "Notificações ligadas neste aparelho.",
      url: "/operations",
      tag: "teste",
    });
    return { ok: true, ...r };
  });
}
