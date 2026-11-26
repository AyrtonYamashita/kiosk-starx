import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Config } from "../config.js";
import { newToken, sha256 } from "../crypto.js";
import { asSystem, setTenant, type Db } from "../db.js";
import { authDevice } from "../deviceAuth.js";
import { desiredConfig } from "../kioskConfig.js";
import { OPS_READER_ON_SQL } from "../ops.js";
import { kioskFor, readerFor } from "../rollout.js";
import { latestArtifacts, type Artifact } from "./apps.js";
import { CommandResult, commandsForDevice, recordResults } from "./commands.js";
import type { Waker } from "../wake.js";

const KIOSK_PACKAGE = "com.pstarx.kiosk";

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

const ManagedStatus = z.record(
  z.string().max(255),
  z.object({ versionCode: z.number().int().nullable().optional(), error: z.string().max(500).nullable().optional(), at: z.string().max(40).optional() }),
);

const Checkin = z.object({
  appVersion: z.string().max(32).optional(),
  appVersionCode: z.number().int().optional(),
  /** Resultados de comandos (enviados até o painel confirmar com `ackResults`). */
  commandResults: z.array(CommandResult).max(100).optional(),
  /** Situação dos apps gerenciados (instalados/atualizados pelo painel), quando mudou. */
  managedStatus: ManagedStatus.optional(),
  info: Info.optional(),
  apps: z.array(App).max(2000).optional(),
  appsHash: z.string().max(128).optional(),
  config: z.record(z.string(), z.unknown()).optional(),
  configRevision: z.number().int().optional(),
  configSource: z.string().max(32).nullable().optional(),
  /** Hash da última configuração do painel aplicada no aparelho (null = nunca). */
  panelConfigHash: z.string().max(64).nullable().optional(),
  /** Resultado da aplicação da configuração do painel (enviado uma vez, no check-in seguinte). */
  applyResult: z
    .object({ hash: z.string().max(64), ok: z.boolean(), error: z.string().max(500).nullable().optional(), warnings: z.array(z.string().max(300)).max(50).optional() })
    .optional(),
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

/**
 * O coletor com este serial foi cadastrado em outra empresa: os registros dele nas demais ficam como transferidos e o
 * token de lá deixa de valer (o histórico fica com a empresa antiga).
 */
async function transferOut(q: { query: Db["query"] }, tenantId: string, serial: string) {
  await q.query(
    `UPDATE devices SET transferred_at = now(), token_hash = 'transferido:' || id
     WHERE serial = $1 AND tenant_id <> $2 AND transferred_at IS NULL`,
    [serial, tenantId],
  );
}

export async function deviceRoutes(app: FastifyInstance, opts: { db: Db; config: Config; waker: Waker }) {
  const { db, config, waker } = opts;

  /**
   * Long polling: o aparelho espera aqui até o painel ter algo para ele (comando ou configuração) ou o tempo
   * acabar (até 50 s; a Cloudflare corta conexões paradas em 100 s). {wake: true} → o aparelho faz o check-in já.
   */
  app.get("/v1/device/wait", async (req, reply) => {
    const device = await authDevice(db, req);
    if (!device) return reply.code(401).send({ error: "unauthorized" });
    const { timeoutSec } = req.query as { timeoutSec?: string };
    const ms = Math.min(Math.max(Number(timeoutSec) || 50, 1), 50) * 1000;
    // comando criado enquanto o aparelho não estava esperando (entre duas esperas): responde na hora
    const pending = await db.query("SELECT 1 FROM commands WHERE device_id = $1 AND status = 'pending' AND expires_at > now() LIMIT 1", [device.id]);
    if (pending.rowCount) return { wake: true };
    const abort = new AbortController();
    // conexão caiu (aparelho saiu da rede): solta a espera. O "close" da resposta, não da requisição (num GET
    // a requisição "fecha" logo que é lida)
    reply.raw.on("close", () => abort.abort());
    return { wake: await waker.wait(device.id, ms, abort.signal) };
  });


  /**
   * Apps que o aparelho deve ter (versão mais nova do repositório) e o próprio app do kiosk, se houver versão
   * publicada mais nova. O aparelho instala o que estiver faltando ou mais velho; nunca rebaixa.
   */
  async function managedArtifacts(tenantId: string, packages: string[], appVersionCode: number | null, pilot: boolean): Promise<Artifact[]> {
    const list = await latestArtifacts(db, tenantId, packages.filter((p) => p !== KIOSK_PACKAGE));
    // a versão do grupo do coletor: pilotos recebem a dos pilotos (se houver), os demais a de todos
    const release = config.autoUpdateApp ? await kioskFor(db, pilot) : null;
    if (release && appVersionCode !== null && release.versionCode > appVersionCode) {
      list.push({
        packageName: release.packageName,
        versionCode: release.versionCode,
        versionName: release.versionName,
        url: `/apks/${release.file}`,
        sha256: release.sha256,
        sizeBytes: release.sizeBytes,
      });
    }
    return list;
  }

  /**
   * O aparelho informou o serial pela primeira vez (ex.: cadastrado logo após o QR, antes de poder ler o serial).
   * Se já existe outro registro com esse serial na mesma empresa, é o mesmo aparelho cadastrado antes: herda o nome e o
   * duplicado sai. Em outra empresa, o registro de lá fica como transferido.
   */
  async function mergeBySerial(tenantId: string, deviceId: string, serial: string, currentName: string, enrollmentCodeId: string | null): Promise<string> {
    await asSystem(() => transferOut(db, tenantId, serial));
    const old = (
      await db.query("SELECT id, name, profile_id, config_overrides FROM devices WHERE tenant_id = $3 AND serial = $1 AND id <> $2 ORDER BY enrolled_at DESC LIMIT 1", [
        serial,
        deviceId,
        tenantId,
      ])
    ).rows[0];
    if (!old) return currentName;
    await db.query("DELETE FROM devices WHERE tenant_id = $3 AND serial = $1 AND id <> $2", [serial, deviceId, tenantId]);
    await db.query(
      `UPDATE devices SET name = $2, profile_id = COALESCE(profile_id, $3), config_overrides = COALESCE(config_overrides, $4) WHERE id = $1`,
      [deviceId, old.name, old.profile_id, old.config_overrides],
    );
    if (enrollmentCodeId) await db.query("UPDATE enrollment_codes SET uses = GREATEST(uses - 1, 0) WHERE id = $1", [enrollmentCodeId]);
    return old.name;
  }

  /**
   * Cadastro: o app troca o código (QR, ADB ou digitado) por um token só dele. Se já existe um aparelho com o
   * mesmo serial (ex.: resetado e cadastrado de novo), o registro é reaproveitado (mantém nome e histórico).
   */
  app.post("/v1/device/enroll", { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } }, async (req, reply) => {
    const body = Enroll.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "invalid_body", details: body.error.issues });
    const code = body.data.code.toUpperCase();
    // a empresa vem do código: achada como sistema (antes dela, nada se sabe); o cadastro roda na empresa (RLS)
    const owner = (await asSystem(() => db.query<{ tenant_id: string }>("SELECT tenant_id FROM enrollment_codes WHERE code = $1", [code]))).rows[0];
    if (!owner) return reply.code(403).send({ error: "invalid_code", message: "código de cadastro inválido, expirado ou esgotado" });
    setTenant(owner.tenant_id);
    // o mesmo serial em outra empresa fica como transferido (lá; por isso como sistema)
    const serial = hardwareFields(body.data.info).serial;
    if (serial) await asSystem(() => transferOut(db, owner.tenant_id, serial));
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      const ec = (
        await client.query(
          `SELECT id, tenant_id, name, profile_id FROM enrollment_codes
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
      // o código define a empresa do coletor. O mesmo serial nesta empresa é o mesmo coletor (reaproveita o registro);
      // em outra empresa, o registro de lá fica como transferido e o token antigo para de valer
      const existing = hw.serial
        ? (await client.query("SELECT id, name FROM devices WHERE tenant_id = $2 AND serial = $1 ORDER BY enrolled_at DESC LIMIT 1", [hw.serial, ec.tenant_id])).rows[0]
        : undefined;
      const defaultName = [hw.model, hw.serial ? hw.serial.slice(-4) : null].filter(Boolean).join(" ") || "Aparelho";
      let device: { id: string; name: string };
      if (existing) {
        device = (
          await client.query(
            `UPDATE devices SET token_hash = $2, enrollment_code_id = $3, enrolled_at = now(), last_seen_at = now(), last_ip = $4,
                    manufacturer = $5, model = $6, android_version = $7, app_version = $8, info = $9, info_updated_at = now(),
                    apps = NULL, apps_hash = NULL, config = NULL, config_revision = NULL, applied_hash = NULL,
                    profile_id = COALESCE($10, profile_id), transferred_at = NULL
             WHERE id = $1 RETURNING id, name`,
            [existing.id, sha256(token), ec.id, req.ip, hw.manufacturer, hw.model, hw.androidVersion, body.data.appVersion ?? null, body.data.info, ec.profile_id],
          )
        ).rows[0];
      } else {
        device = (
          await client.query(
            `INSERT INTO devices (tenant_id, name, token_hash, enrollment_code_id, last_seen_at, last_ip, serial, manufacturer, model,
                                  android_version, app_version, info, info_updated_at, profile_id)
             VALUES ($12, $1, $2, $3, now(), $4, $5, $6, $7, $8, $9, $10, now(), $11) RETURNING id, name`,
            [defaultName, sha256(token), ec.id, req.ip, hw.serial, hw.manufacturer, hw.model, hw.androidVersion, body.data.appVersion ?? null, body.data.info, ec.profile_id, ec.tenant_id],
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
    const device = await authDevice(db, req);
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
    if (b.appVersionCode !== undefined) set("app_version_code", b.appVersionCode);
    if (b.managedStatus) set("managed_status", JSON.stringify(b.managedStatus));
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
    if (b.applyResult) {
      if (b.applyResult.ok) set("applied_hash", b.applyResult.hash);
      set("failed_hash", b.applyResult.ok ? null : b.applyResult.hash);
      set("apply_error", b.applyResult.ok ? null : (b.applyResult.error ?? "falha ao aplicar"));
      set("apply_warnings", JSON.stringify(b.applyResult.warnings ?? []));
      sets.push("applied_at = now()");
    } else if (b.panelConfigHash !== undefined) {
      set("applied_hash", b.panelConfigHash);
    }
    let name = device.name;
    if (hw.serial && !device.serial) name = await mergeBySerial(device.tenant_id, device.id, hw.serial, device.name, device.enrollment_code_id);
    await db.query(`UPDATE devices SET ${sets.join(", ")} WHERE id = $1`, params);
    if (b.commandResults?.length) await recordResults(db, device.id, b.commandResults);

    // configuração do painel: vai só quando o aparelho ainda não aplicou a versão atual
    const row = (
      await db.query(
        `SELECT p.config AS profile_config, p.managed_apps, d.config_overrides, d.config_nonce, d.failed_hash, d.applied_hash, d.app_version_code, d.pilot, ${OPS_READER_ON_SQL} AS ops_reader_on
         FROM devices d LEFT JOIN profiles p ON p.id = d.profile_id WHERE d.id = $1`,
        [device.id],
      )
    ).rows[0];
    const desired = desiredConfig(row.profile_config, row.config_overrides, row.config_nonce);
    const reported = b.applyResult?.ok ? b.applyResult.hash : (b.panelConfigHash ?? row.applied_hash);
    // falhou com este mesmo hash: não reenvia em loop (o painel mostra o erro; reaplicar gera hash novo)
    const sendDesired = desired && desired.hash !== reported && desired.hash !== row.failed_hash;
    return {
      desired: sendDesired ? { hash: desired.hash, config: desired.config } : null,
      commands: await commandsForDevice(db, device.id),
      ackResults: (b.commandResults ?? []).map((r) => r.id),
      apps: await managedArtifacts(device.tenant_id, (row.managed_apps as string[] | null) ?? [], row.app_version_code, row.pilot === true),
      serverTime: new Date().toISOString(),
      name,
      checkinIntervalSec: config.checkinIntervalSec,
      appsHash,
      configRevision,
      // leitura do SSW: o app só lê a tela e manda eventos quando ligada (no coletor ou pela chave geral)
      opsReader: row.ops_reader_on === true,
      // leitor do SSW: o app baixa em /v1/device/reader quando o sha256 muda
      reader: await (async () => {
        const r = await readerFor(db, row.pilot === true);
        return r ? { sha256: r.sha256 } : null;
      })(),
    };
  });

  /** Leitor do SSW (texto do script). O app confere o sha256 informado no check-in antes de usar. */
  app.get("/v1/device/reader", async (req, reply) => {
    const device = await authDevice(db, req);
    if (!device) return reply.code(401).send({ error: "unauthorized" });
    const pilot = (await db.query<{ pilot: boolean }>("SELECT pilot FROM devices WHERE id = $1", [device.id])).rows[0]?.pilot === true;
    const r = await readerFor(db, pilot);
    if (!r) return reply.code(404).send({ error: "not_found" });
    return reply.header("content-type", "application/javascript; charset=utf-8").header("x-sha256", r.sha256).header("cache-control", "no-store").send(r.body);
  });
}
