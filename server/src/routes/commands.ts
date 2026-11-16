import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Db } from "../db.js";
import { authDevice } from "../deviceAuth.js";
import { findArtifact, PackageName } from "./apps.js";
import type { Waker } from "../wake.js";

const KIOSK_PACKAGE = "com.pstarx.kiosk";

/** Comandos que o app entende e o que cada um recebe. */
const Payloads = {
  reboot: z.object({}).strict(),
  lock: z.object({}).strict(),
  message: z.object({ title: z.string().trim().max(80).optional(), text: z.string().trim().min(1).max(1000) }).strict(),
  screenshot: z.object({}).strict(),
  reload: z.object({}).strict(),
  install_app: z.object({ packageName: PackageName, versionCode: z.number().int().positive().nullable().optional() }).strict(),
  uninstall_app: z.object({ packageName: PackageName }).strict(),
} as const;
export type CommandType = keyof typeof Payloads;
export const COMMAND_TYPES = Object.keys(Payloads) as CommandType[];

/** Validade padrão (min): ações imediatas não devem acontecer horas depois; instalações podem esperar o aparelho voltar. */
const DEFAULT_EXPIRY_MIN: Record<CommandType, number> = {
  reboot: 30,
  lock: 30,
  message: 240,
  screenshot: 10,
  reload: 30,
  install_app: 7 * 24 * 60,
  uninstall_app: 7 * 24 * 60,
};

const Create = z.object({
  deviceIds: z.array(z.uuid()).min(1).max(1000),
  type: z.enum(COMMAND_TYPES as [CommandType, ...CommandType[]]),
  payload: z.record(z.string(), z.unknown()).optional().default({}),
  expiresInMin: z.number().int().min(1).max(30 * 24 * 60).optional(),
});

export const CommandResult = z.object({
  id: z.uuid(),
  ok: z.boolean(),
  message: z.string().max(1000).nullable().optional(),
  output: z.record(z.string(), z.unknown()).nullable().optional(),
});

const MAX_SCREENSHOTS_PER_DEVICE = 10;

function commandJson(c: Record<string, any>) {
  return {
    id: c.id,
    type: c.type,
    payload: c.payload,
    status: c.status,
    message: c.message,
    output: c.output,
    createdBy: c.created_by,
    createdAt: c.created_at,
    sentAt: c.sent_at,
    doneAt: c.done_at,
    expiresAt: c.expires_at,
  };
}

/** Painel: criar, listar e cancelar comandos; ver capturas de tela. Dentro do escopo autenticado. */
export async function commandRoutes(app: FastifyInstance, opts: { db: Db; waker: Waker }) {
  const { db, waker } = opts;

  app.post("/v1/admin/commands", async (req, reply) => {
    const body = Create.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "invalid_body", details: body.error.issues });
    const { type, deviceIds } = body.data;
    const p = Payloads[type].safeParse(body.data.payload);
    if (!p.success) return reply.code(400).send({ error: "invalid_payload", message: p.error.issues.map((i) => `${i.path.join(".") || type}: ${i.message}`).join("; ") });
    let payload: Record<string, unknown> = p.data;

    if (type === "install_app" || type === "uninstall_app") {
      const pkg = (p.data as { packageName: string }).packageName;
      if (type === "uninstall_app" && pkg === KIOSK_PACKAGE) return reply.code(400).send({ error: "invalid_payload", message: "o app do kiosk não pode ser removido por comando" });
      if (type === "install_app") {
        // a versão é fixada na criação: o comando instala exatamente o que foi escolhido
        const artifact = await findArtifact(db, pkg, (p.data as { versionCode?: number | null }).versionCode);
        if (!artifact) return reply.code(400).send({ error: "invalid_payload", message: "app/versão não existe no repositório" });
        payload = { packageName: pkg, artifact };
      }
    }

    const found = (await db.query("SELECT id FROM devices WHERE id = ANY($1::uuid[])", [deviceIds])).rows.map((r) => r.id as string);
    if (found.length === 0) return reply.code(404).send({ error: "not_found", message: "nenhum aparelho encontrado" });
    const expiresMin = body.data.expiresInMin ?? DEFAULT_EXPIRY_MIN[type];
    const r = await db.query(
      `INSERT INTO commands (device_id, type, payload, created_by, expires_at)
       SELECT d, $2, $3, $4, now() + make_interval(mins => $5) FROM unnest($1::uuid[]) AS d RETURNING id`,
      [found, type, payload, req.admin!.username, expiresMin],
    );
    // aparelhos esperando no long polling recebem na hora (os outros, no próximo check-in)
    waker.wake(found);
    req.log.info({ type, devices: found.length, by: req.admin!.username }, "comando criado");
    return { created: r.rowCount, ids: r.rows.map((x) => x.id) };
  });

  app.get("/v1/admin/devices/:id/commands", async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!z.uuid().safeParse(id).success) return reply.code(404).send({ error: "not_found" });
    await expireOld(db, id);
    const r = await db.query("SELECT * FROM commands WHERE device_id = $1 ORDER BY created_at DESC LIMIT 30", [id]);
    const shots = await db.query("SELECT id, width, height, created_at FROM screenshots WHERE device_id = $1 ORDER BY created_at DESC LIMIT $2", [
      id,
      MAX_SCREENSHOTS_PER_DEVICE,
    ]);
    return {
      commands: r.rows.map(commandJson),
      screenshots: shots.rows.map((s) => ({ id: s.id, width: s.width, height: s.height, createdAt: s.created_at })),
    };
  });

  /** Cancela um comando ainda não entregue. Entregue, o aparelho já pode estar executando. */
  app.post("/v1/admin/commands/:id/cancel", async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!z.uuid().safeParse(id).success) return reply.code(404).send({ error: "not_found" });
    const r = await db.query("UPDATE commands SET status = 'canceled', done_at = now() WHERE id = $1 AND status = 'pending'", [id]);
    if (!r.rowCount) return reply.code(409).send({ error: "not_pending", message: "só dá para cancelar comandos ainda não entregues" });
    return { ok: true };
  });

  app.get("/v1/admin/screenshots/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!z.uuid().safeParse(id).success) return reply.code(404).send({ error: "not_found" });
    const s = (await db.query("SELECT mime, data FROM screenshots WHERE id = $1", [id])).rows[0];
    if (!s) return reply.code(404).send({ error: "not_found" });
    reply.header("content-type", s.mime);
    reply.header("cache-control", "private, max-age=86400");
    return reply.send(s.data);
  });
}

async function expireOld(db: Db, deviceId: string) {
  await db.query(
    `UPDATE commands SET status = 'expired', done_at = now(), message = COALESCE(message, CASE WHEN status = 'pending' THEN 'o aparelho não fez contato a tempo' ELSE 'o aparelho não respondeu a tempo' END)
     WHERE device_id = $1 AND status IN ('pending', 'sent') AND expires_at < now()`,
    [deviceId],
  );
}

/**
 * Comandos a entregar no check-in: os pendentes e os entregues sem resultado (o aparelho ignora repetidos pelo id,
 * então reenviar é seguro e cobre a resposta perdida no caminho).
 */
export async function commandsForDevice(db: Db, deviceId: string) {
  await expireOld(db, deviceId);
  const r = await db.query(
    `UPDATE commands SET status = 'sent', sent_at = COALESCE(sent_at, now())
     WHERE id IN (SELECT id FROM commands WHERE device_id = $1 AND status IN ('pending', 'sent') ORDER BY created_at LIMIT 20)
     RETURNING id, type, payload, created_at`,
    [deviceId],
  );
  return r.rows
    .sort((a, b) => +a.created_at - +b.created_at)
    .map((c) => ({ id: c.id, type: c.type, payload: c.payload, createdAt: c.created_at }));
}

/** Resultados enviados pelo aparelho. Pode vir mais de uma vez para o mesmo comando (ex.: mensagem exibida → lida). */
export async function recordResults(db: Db, deviceId: string, results: z.infer<typeof CommandResult>[]) {
  for (const res of results) {
    await db.query(
      `UPDATE commands SET status = $3, message = $4, output = $5, done_at = now()
       WHERE id = $1 AND device_id = $2 AND status <> 'canceled'`,
      [res.id, deviceId, res.ok ? "ok" : "failed", res.message ?? null, res.output ?? null],
    );
  }
}

/** Captura de tela enviada pelo aparelho (corpo: o JPEG). */
export async function deviceScreenshotRoutes(app: FastifyInstance, opts: { db: Db }) {
  const { db } = opts;
  const bodyLimit = 4 * 1024 * 1024;
  app.addContentTypeParser(["image/jpeg", "image/png"], { parseAs: "buffer", bodyLimit }, (_req, body, done) => done(null, body));

  app.post("/v1/device/screenshots", { bodyLimit }, async (req, reply) => {
    const device = await authDevice(db, req);
    if (!device) return reply.code(401).send({ error: "unauthorized" });
    const buf = req.body;
    if (!Buffer.isBuffer(buf) || buf.length < 100) return reply.code(400).send({ error: "invalid_body" });
    const q = req.query as { commandId?: string; width?: string; height?: string };
    const commandId = q.commandId && z.uuid().safeParse(q.commandId).success ? q.commandId : null;
    const mime = req.headers["content-type"]?.startsWith("image/png") ? "image/png" : "image/jpeg";
    const r = await db.query(
      `INSERT INTO screenshots (device_id, command_id, mime, width, height, data)
       VALUES ($1, (SELECT id FROM commands WHERE id = $2 AND device_id = $1), $3, $4, $5, $6) RETURNING id`,
      [device.id, commandId, mime, Number(q.width) || null, Number(q.height) || null, buf],
    );
    await db.query("UPDATE devices SET last_screenshot_at = now() WHERE id = $1", [device.id]);
    await db.query(
      `DELETE FROM screenshots WHERE device_id = $1 AND id NOT IN (SELECT id FROM screenshots WHERE device_id = $1 ORDER BY created_at DESC LIMIT $2)`,
      [device.id, MAX_SCREENSHOTS_PER_DEVICE],
    );
    return { id: r.rows[0].id };
  });
}
