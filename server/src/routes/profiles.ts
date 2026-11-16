import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import type { Db } from "../db.js";
import { PackageName } from "./apps.js";
import type { Waker } from "../wake.js";
import { desiredConfig, prepareConfig, redactConfig, type StoredConfig } from "../kioskConfig.js";

const ProfileBody = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().max(500).optional().default(""),
  config: z.unknown(),
  /** Apps que o perfil mantém instalados e atualizados (pacotes do repositório). Ausente = não muda. */
  managedApps: z.array(PackageName).max(100).optional(),
});
const DeviceConfigBody = z.object({
  profileId: z.uuid().nullable(),
  overrides: z.unknown().nullable().optional(),
});
const BulkBody = z.object({ deviceIds: z.array(z.uuid()).min(1).max(1000), profileId: z.uuid().nullable() });

export type ConfigStatus = "none" | "applied" | "modified" | "pending" | "error";

/**
 * Situação da configuração do painel num aparelho:
 *  none: sem perfil/ajustes · pending: ainda não aplicou a versão atual · applied: aplicada e sem mudanças locais ·
 *  modified: aplicada, mas alterada depois no aparelho (tela/ADB) · error: o aparelho recusou esta versão.
 */
export function configStatus(d: {
  profile_config: StoredConfig | null;
  config_overrides: StoredConfig | null;
  config_nonce: number;
  applied_hash: string | null;
  failed_hash: string | null;
  config_source: string | null;
}): { status: ConfigStatus; desiredHash: string | null } {
  const desired = desiredConfig(d.profile_config, d.config_overrides, d.config_nonce);
  if (!desired) return { status: "none", desiredHash: null };
  if (d.failed_hash === desired.hash) return { status: "error", desiredHash: desired.hash };
  if (d.applied_hash !== desired.hash) return { status: "pending", desiredHash: desired.hash };
  return { status: d.config_source === "painel" ? "applied" : "modified", desiredHash: desired.hash };
}

/** Registrado dentro do escopo autenticado do painel (herda o preHandler de admin). */
export async function profileRoutes(app: FastifyInstance, opts: { db: Db; waker: Waker }) {
  const { db, waker } = opts;
  /** Aparelhos de um perfil: recebem a configuração nova na hora. */
  const wakeProfile = async (profileId: string) =>
    waker.wake((await db.query("SELECT id FROM devices WHERE profile_id = $1", [profileId])).rows.map((r) => r.id as string));

  const uuidParam = (req: FastifyRequest) => {
    const { id } = req.params as { id: string };
    return z.uuid().safeParse(id).success ? id : null;
  };

  app.get("/v1/admin/profiles", async () => {
    const r = await db.query(
      `SELECT p.*, (SELECT count(*)::int FROM devices d WHERE d.profile_id = p.id) AS devices FROM profiles p ORDER BY p.name`,
    );
    return { profiles: r.rows.map(profileJson) };
  });

  app.get("/v1/admin/profiles/:id", async (req, reply) => {
    const id = uuidParam(req);
    const p = id && (await db.query(`SELECT p.*, (SELECT count(*)::int FROM devices d WHERE d.profile_id = p.id) AS devices FROM profiles p WHERE id = $1`, [id])).rows[0];
    if (!p) return reply.code(404).send({ error: "not_found" });
    const devices = (await db.query("SELECT id, name, serial FROM devices WHERE profile_id = $1 ORDER BY name", [id])).rows;
    return { ...profileJson(p), deviceList: devices };
  });

  /** Pacotes que não estão no repositório (mensagem de erro) ou null se todos existem. */
  async function missingApps(packages: string[] | undefined): Promise<string | null> {
    if (!packages?.length) return null;
    const found = new Set((await db.query("SELECT package_name FROM apps WHERE package_name = ANY($1::text[])", [packages])).rows.map((r) => r.package_name));
    const missing = packages.filter((p) => !found.has(p));
    return missing.length ? `apps fora do repositório: ${missing.join(", ")}` : null;
  }

  app.post("/v1/admin/profiles", async (req, reply) => {
    const body = ProfileBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "invalid_body", message: "nome obrigatório" });
    const v = prepareConfig(body.data.config, null);
    if (!v.ok) return reply.code(400).send({ error: "invalid_config", message: v.errors.join("; "), errors: v.errors });
    const missing = await missingApps(body.data.managedApps);
    if (missing) return reply.code(400).send({ error: "invalid_apps", message: missing });
    try {
      const r = await db.query("INSERT INTO profiles (name, description, config, managed_apps) VALUES ($1, $2, $3, $4) RETURNING *, 0 AS devices", [
        body.data.name,
        body.data.description,
        v.config,
        JSON.stringify([...new Set(body.data.managedApps ?? [])]),
      ]);
      return profileJson(r.rows[0]);
    } catch (e) {
      if ((e as { code?: string }).code === "23505") return reply.code(409).send({ error: "duplicate", message: "já existe um perfil com esse nome" });
      throw e;
    }
  });

  app.put("/v1/admin/profiles/:id", async (req, reply) => {
    const id = uuidParam(req);
    const body = ProfileBody.safeParse(req.body);
    if (!id || !body.success) return reply.code(400).send({ error: "invalid_body", message: "nome obrigatório" });
    const prev = (await db.query("SELECT config FROM profiles WHERE id = $1", [id])).rows[0];
    if (!prev) return reply.code(404).send({ error: "not_found" });
    const v = prepareConfig(body.data.config, prev.config);
    if (!v.ok) return reply.code(400).send({ error: "invalid_config", message: v.errors.join("; "), errors: v.errors });
    const missing = await missingApps(body.data.managedApps);
    if (missing) return reply.code(400).send({ error: "invalid_apps", message: missing });
    try {
      const r = await db.query(
        `UPDATE profiles SET name = $2, description = $3, config = $4, managed_apps = COALESCE($5, managed_apps), updated_at = now() WHERE id = $1
         RETURNING *, (SELECT count(*)::int FROM devices d WHERE d.profile_id = $1) AS devices`,
        [id, body.data.name, body.data.description, v.config, body.data.managedApps ? JSON.stringify([...new Set(body.data.managedApps)]) : null],
      );
      await wakeProfile(id);
      return profileJson(r.rows[0]);
    } catch (e) {
      if ((e as { code?: string }).code === "23505") return reply.code(409).send({ error: "duplicate", message: "já existe um perfil com esse nome" });
      throw e;
    }
  });

  /** Excluir: os aparelhos ficam sem perfil e mantêm a configuração que já têm. */
  app.delete("/v1/admin/profiles/:id", async (req, reply) => {
    const id = uuidParam(req);
    const r = id ? await db.query("DELETE FROM profiles WHERE id = $1", [id]) : null;
    if (!r?.rowCount) return reply.code(404).send({ error: "not_found" });
    return { ok: true };
  });

  // ---------------------------------------------------------------- configuração por aparelho

  app.put("/v1/admin/devices/:id/config", async (req, reply) => {
    const id = uuidParam(req);
    const body = DeviceConfigBody.safeParse(req.body);
    if (!id || !body.success) return reply.code(400).send({ error: "invalid_body" });
    const prev = (await db.query("SELECT config_overrides FROM devices WHERE id = $1", [id])).rows[0];
    if (!prev) return reply.code(404).send({ error: "not_found" });
    let overrides: StoredConfig | null = null;
    if (body.data.overrides && Object.keys(body.data.overrides as object).length > 0) {
      const v = prepareConfig(body.data.overrides, prev.config_overrides);
      if (!v.ok) return reply.code(400).send({ error: "invalid_config", message: v.errors.join("; "), errors: v.errors });
      overrides = v.config;
    }
    if (body.data.profileId && !(await db.query("SELECT 1 FROM profiles WHERE id = $1", [body.data.profileId])).rowCount) {
      return reply.code(400).send({ error: "invalid_profile", message: "perfil não existe" });
    }
    await db.query("UPDATE devices SET profile_id = $2, config_overrides = $3, failed_hash = NULL WHERE id = $1", [id, body.data.profileId, overrides]);
    waker.wake([id]);
    return { ok: true };
  });

  /** Reaplicar: manda de novo a configuração do painel (desfaz mudanças feitas no aparelho). */
  app.post("/v1/admin/devices/:id/config/reapply", async (req, reply) => {
    const id = uuidParam(req);
    const r = id ? await db.query("UPDATE devices SET config_nonce = config_nonce + 1, failed_hash = NULL WHERE id = $1", [id]) : null;
    if (!r?.rowCount) return reply.code(404).send({ error: "not_found" });
    waker.wake([id!]);
    return { ok: true };
  });

  app.post("/v1/admin/devices/bulk/profile", async (req, reply) => {
    const body = BulkBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "invalid_body" });
    if (body.data.profileId && !(await db.query("SELECT 1 FROM profiles WHERE id = $1", [body.data.profileId])).rowCount) {
      return reply.code(400).send({ error: "invalid_profile", message: "perfil não existe" });
    }
    const r = await db.query("UPDATE devices SET profile_id = $2, failed_hash = NULL WHERE id = ANY($1::uuid[])", [body.data.deviceIds, body.data.profileId]);
    waker.wake(body.data.deviceIds);
    return { ok: true, updated: r.rowCount };
  });

  /** Apps vistos nos aparelhos (para escolher os apps do kiosk no editor). */
  app.get("/v1/admin/apps-catalog", async () => {
    const r = await db.query(
      `SELECT a->>'packageName' AS package, max(a->>'label') AS label, count(*)::int AS devices, bool_or((a->>'system')::boolean) AS system
       FROM devices d, jsonb_array_elements(COALESCE(d.apps, '[]'::jsonb)) a
       GROUP BY 1 ORDER BY 2`,
    );
    return { apps: r.rows };
  });
}

function profileJson(p: Record<string, any>) {
  return {
    id: p.id,
    name: p.name,
    description: p.description,
    config: redactConfig(p.config),
    managedApps: (p.managed_apps as string[] | null) ?? [],
    devices: p.devices ?? 0,
    createdAt: p.created_at,
    updatedAt: p.updated_at,
  };
}
