import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import type { Config } from "../config.js";
import { newToken, sha256 } from "../crypto.js";
import type { Db } from "../db.js";

/** Inventário enviado pelo app (DeviceInfo.collect). Só os campos usados na listagem são conferidos. */
const Info = z
  .object({
    hardware: z
      .object({
        manufacturer: z.string().optional(),
        model: z.string().optional(),
        serialNumber: z.string().nullable().optional(),
        androidVersion: z.string().optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

const App = z.object({ packageName: z.string() }).passthrough();

const Enroll = z.object({
  code: z.string().trim().min(4).max(64),
  appVersion: z.string().max(32).optional(),
  info: Info,
});

const Checkin = z.object({
  appVersion: z.string().max(32).optional(),
  info: Info.optional(),
  apps: z.array(App).max(2000).optional(),
  appsHash: z.string().max(128).optional(),
  config: z.record(z.string(), z.unknown()).optional(),
  configRevision: z.number().int().optional(),
  configSource: z.string().max(32).nullable().optional(),
});

function hardwareFields(info: z.infer<typeof Info> | undefined) {
  const h = info?.hardware;
  return {
    serial: h?.serialNumber ?? null,
    manufacturer: h?.manufacturer ?? null,
    model: h?.model ?? null,
    androidVersion: h?.androidVersion ?? null,
  };
}

/** Remove qualquer material do PIN que tenha vindo por engano (o app já manda sem). */
function stripPin(config: Record<string, unknown>): Record<string, unknown> {
  const copy = structuredClone(config);
  const sec = copy.security as Record<string, unknown> | undefined;
  if (sec && typeof sec === "object") {
    if (sec.pinHash && typeof sec.pinHash === "object") sec.pinHash = "<definido>";
    delete sec.pin;
  }
  return copy;
}

export async function deviceRoutes(app: FastifyInstance, opts: { db: Db; config: Config }) {
  const { db, config } = opts;

  async function authDevice(req: FastifyRequest): Promise<{ id: string; apps_hash: string | null; config_revision: number | null; name: string } | null> {
    const auth = req.headers.authorization;
    if (!auth?.startsWith("Bearer ")) return null;
    const r = await db.query("SELECT id, name, apps_hash, config_revision FROM devices WHERE token_hash = $1", [sha256(auth.slice(7))]);
    return r.rows[0] ?? null;
  }

  /**
   * Cadastro: o app troca o código (QR, ADB ou digitado) por um token só dele. Se já existe um aparelho com o
   * mesmo serial (ex.: resetado e cadastrado de novo), o registro é reaproveitado (mantém nome e histórico).
   */
  app.post("/v1/device/enroll", { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } }, async (req, reply) => {
    const body = Enroll.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "invalid_body", details: body.error.issues });
    const code = body.data.code.toUpperCase();
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      const ec = (
        await client.query(
          `SELECT id, name FROM enrollment_codes
           WHERE code = $1 AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > now())
             AND (max_uses IS NULL OR uses < max_uses)
           FOR UPDATE`,
          [code],
        )
      ).rows[0];
      if (!ec) {
        await client.query("ROLLBACK");
        return reply.code(403).send({ error: "invalid_code", message: "código de cadastro inválido, expirado ou esgotado" });
      }
      const hw = hardwareFields(body.data.info);
      const token = newToken();
      const existing = hw.serial
        ? (await client.query("SELECT id, name FROM devices WHERE serial = $1 ORDER BY enrolled_at DESC LIMIT 1", [hw.serial])).rows[0]
        : undefined;
      const defaultName = [hw.model, hw.serial ? hw.serial.slice(-4) : null].filter(Boolean).join(" ") || "Aparelho";
      let device: { id: string; name: string };
      if (existing) {
        device = (
          await client.query(
            `UPDATE devices SET token_hash = $2, enrollment_code_id = $3, enrolled_at = now(), last_seen_at = now(), last_ip = $4,
                    manufacturer = $5, model = $6, android_version = $7, app_version = $8, info = $9, info_updated_at = now(),
                    apps = NULL, apps_hash = NULL, config = NULL, config_revision = NULL
             WHERE id = $1 RETURNING id, name`,
            [existing.id, sha256(token), ec.id, req.ip, hw.manufacturer, hw.model, hw.androidVersion, body.data.appVersion ?? null, body.data.info],
          )
        ).rows[0];
      } else {
        device = (
          await client.query(
            `INSERT INTO devices (name, token_hash, enrollment_code_id, last_seen_at, last_ip, serial, manufacturer, model,
                                  android_version, app_version, info, info_updated_at)
             VALUES ($1, $2, $3, now(), $4, $5, $6, $7, $8, $9, $10, now()) RETURNING id, name`,
            [defaultName, sha256(token), ec.id, req.ip, hw.serial, hw.manufacturer, hw.model, hw.androidVersion, body.data.appVersion ?? null, body.data.info],
          )
        ).rows[0];
      }
      await client.query("UPDATE enrollment_codes SET uses = uses + 1 WHERE id = $1", [ec.id]);
      await client.query("COMMIT");
      req.log.info({ deviceId: device.id, serial: hw.serial, reused: !!existing }, "aparelho cadastrado");
      return { deviceId: device.id, name: device.name, token, checkinIntervalSec: config.checkinIntervalSec };
    } catch (e) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw e;
    } finally {
      client.release();
    }
  });

  /**
   * Check-in periódico. O app manda o inventário; a lista de apps e a configuração só quando mudaram
   * (a resposta diz o que o servidor tem: appsHash e configRevision).
   */
  app.post("/v1/device/checkin", { bodyLimit: 2 * 1024 * 1024 }, async (req, reply) => {
    const device = await authDevice(req);
    if (!device) return reply.code(401).send({ error: "unauthorized", message: "aparelho não cadastrado (ou removido do painel)" });
    const body = Checkin.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "invalid_body", details: body.error.issues });
    const b = body.data;
    const hw = hardwareFields(b.info);
    const sets: string[] = ["last_seen_at = now()", "last_ip = $2"];
    const params: unknown[] = [device.id, req.ip];
    const set = (sql: string, value: unknown) => {
      params.push(value);
      sets.push(`${sql} = $${params.length}`);
    };
    if (b.appVersion) set("app_version", b.appVersion);
    if (b.info) {
      set("info", b.info);
      sets.push("info_updated_at = now()");
      if (hw.serial) set("serial", hw.serial);
      if (hw.model) set("model", hw.model);
      if (hw.manufacturer) set("manufacturer", hw.manufacturer);
      if (hw.androidVersion) set("android_version", hw.androidVersion);
    }
    let appsHash = device.apps_hash;
    if (b.apps) {
      appsHash = b.appsHash ?? sha256(JSON.stringify(b.apps));
      set("apps", JSON.stringify(b.apps));
      set("apps_hash", appsHash);
      sets.push("apps_updated_at = now()");
    }
    let configRevision = device.config_revision;
    if (b.config && b.configRevision !== undefined) {
      configRevision = b.configRevision;
      set("config", stripPin(b.config));
      set("config_revision", b.configRevision);
      set("config_source", b.configSource ?? null);
      sets.push("config_updated_at = now()");
    }
    await db.query(`UPDATE devices SET ${sets.join(", ")} WHERE id = $1`, params);
    return {
      serverTime: new Date().toISOString(),
      name: device.name,
      checkinIntervalSec: config.checkinIntervalSec,
      appsHash,
      configRevision,
    };
  });
}
