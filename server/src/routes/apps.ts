import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { ApkError, parseApk } from "../apk.js";
import type { Config } from "../config.js";
import { newToken, sha256 } from "../crypto.js";
import type { Db } from "../db.js";
import { authDevice } from "../deviceAuth.js";

/** APK que o aparelho deve instalar. `url` é relativa à API (o app prefixa o endereço do painel). */
export interface Artifact {
  packageName: string;
  versionCode: number;
  versionName: string | null;
  url: string;
  sha256: string;
  sizeBytes: number;
}

const PACKAGE = /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z0-9_]+)+$/;
export const PackageName = z.string().regex(PACKAGE).max(255);
const UPLOAD_TOKEN_MIN = 15;

export function apkFile(config: Config, sha: string): string {
  if (!/^[0-9a-f]{64}$/.test(sha)) throw new Error("sha256 inválido");
  return path.join(config.appsDir, `${sha}.apk`);
}

function versionArtifact(v: Record<string, any>): Artifact {
  return {
    packageName: v.package_name,
    versionCode: Number(v.version_code),
    versionName: v.version_name,
    url: `/v1/device/apps/${v.id}/apk`,
    sha256: v.sha256,
    sizeBytes: Number(v.size_bytes),
  };
}

/** Versão mais nova de cada pacote pedido que existe no repositório. */
export async function latestArtifacts(db: Db, packages: string[]): Promise<Artifact[]> {
  if (packages.length === 0) return [];
  const r = await db.query(
    `SELECT DISTINCT ON (package_name) * FROM app_versions WHERE package_name = ANY($1::text[])
     ORDER BY package_name, version_code DESC`,
    [packages],
  );
  return r.rows.map(versionArtifact);
}

/** Uma versão específica (ou a mais nova, sem versionCode). */
export async function findArtifact(db: Db, packageName: string, versionCode?: number | null): Promise<Artifact | null> {
  const r = versionCode
    ? await db.query("SELECT * FROM app_versions WHERE package_name = $1 AND version_code = $2", [packageName, versionCode])
    : await db.query("SELECT * FROM app_versions WHERE package_name = $1 ORDER BY version_code DESC LIMIT 1", [packageName]);
  return r.rows[0] ? versionArtifact(r.rows[0]) : null;
}

/** Repositório de apps no painel (dentro do escopo autenticado). */
export async function appRepoRoutes(app: FastifyInstance, opts: { db: Db; config: Config }) {
  const { db, config } = opts;

  app.get("/v1/admin/apps", async () => {
    const apps = (await db.query("SELECT * FROM apps ORDER BY lower(label)")).rows;
    const versions = (await db.query("SELECT * FROM app_versions ORDER BY package_name, version_code DESC")).rows;
    const profiles = (await db.query("SELECT id, name, managed_apps FROM profiles ORDER BY name")).rows;
    // aparelhos com o app instalado, por versão (da lista de apps do último check-in)
    const installed = (
      await db.query(
        `SELECT a->>'packageName' AS package, (a->>'versionCode')::bigint AS version_code, count(*)::int AS devices
         FROM devices d, jsonb_array_elements(COALESCE(d.apps, '[]'::jsonb)) a
         WHERE a->>'packageName' = ANY($1::text[]) GROUP BY 1, 2`,
        [apps.map((a) => a.package_name)],
      )
    ).rows;
    return {
      maxApkMb: config.maxApkMb,
      apps: apps.map((a) => {
        const vs = versions.filter((v) => v.package_name === a.package_name);
        const latest = vs[0] ? Number(vs[0].version_code) : null;
        const inst = installed.filter((i) => i.package === a.package_name);
        return {
          packageName: a.package_name,
          label: a.label,
          signingCertSha256: a.signing_cert_sha256,
          createdAt: a.created_at,
          versions: vs.map((v) => ({
            id: v.id,
            versionCode: Number(v.version_code),
            versionName: v.version_name,
            minSdk: v.min_sdk,
            sizeBytes: Number(v.size_bytes),
            sha256: v.sha256,
            uploadedBy: v.uploaded_by,
            uploadedAt: v.uploaded_at,
            devices: inst.filter((i) => Number(i.version_code) === Number(v.version_code)).reduce((n, i) => n + i.devices, 0),
          })),
          installedDevices: inst.reduce((n, i) => n + i.devices, 0),
          upToDateDevices: inst.filter((i) => latest !== null && Number(i.version_code) >= latest).reduce((n, i) => n + i.devices, 0),
          profiles: profiles.filter((p) => (p.managed_apps as string[]).includes(a.package_name)).map((p) => ({ id: p.id, name: p.name })),
        };
      }),
    };
  });

  /** Token de uso único para o navegador enviar um APK direto para a API. */
  app.post("/v1/admin/apps/upload-token", async (req) => {
    const token = newToken();
    await db.query("DELETE FROM upload_tokens WHERE expires_at < now()");
    await db.query("INSERT INTO upload_tokens (token_hash, admin_id, expires_at) VALUES ($1, $2, now() + make_interval(mins => $3))", [
      sha256(token),
      req.admin!.id,
      UPLOAD_TOKEN_MIN,
    ]);
    return { token, uploadUrl: `${config.publicUrl}/v1/upload/apk`, maxApkMb: config.maxApkMb };
  });

  app.patch("/v1/admin/apps/:pkg", async (req, reply) => {
    const { pkg } = req.params as { pkg: string };
    const body = z.object({ label: z.string().trim().min(1).max(80) }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "invalid_body" });
    const r = await db.query("UPDATE apps SET label = $2 WHERE package_name = $1", [pkg, body.data.label]);
    if (!r.rowCount) return reply.code(404).send({ error: "not_found" });
    return { ok: true };
  });

  app.delete("/v1/admin/apps/:pkg", async (req, reply) => {
    const { pkg } = req.params as { pkg: string };
    const used = (await db.query("SELECT name FROM profiles WHERE managed_apps ? $1 ORDER BY name", [pkg])).rows;
    if (used.length) {
      return reply.code(409).send({ error: "in_use", message: `o app está nos perfis: ${used.map((p) => p.name).join(", ")}. Tire de lá antes.` });
    }
    const files = (await db.query("SELECT sha256 FROM app_versions WHERE package_name = $1", [pkg])).rows;
    const r = await db.query("DELETE FROM apps WHERE package_name = $1", [pkg]);
    if (!r.rowCount) return reply.code(404).send({ error: "not_found" });
    for (const f of files) fs.rmSync(apkFile(config, f.sha256), { force: true });
    return { ok: true };
  });

  app.delete("/v1/admin/apps/:pkg/versions/:versionCode", async (req, reply) => {
    const { pkg, versionCode } = req.params as { pkg: string; versionCode: string };
    const r = await db.query("DELETE FROM app_versions WHERE package_name = $1 AND version_code = $2 RETURNING sha256", [pkg, Number(versionCode) || -1]);
    if (!r.rowCount) return reply.code(404).send({ error: "not_found" });
    fs.rmSync(apkFile(config, r.rows[0].sha256), { force: true });
    return { ok: true };
  });
}

/**
 * Envio de APK pelo navegador (fora do escopo de admin: autentica com o token de uso único). CORS só para o painel.
 * Corpo: o próprio arquivo (application/octet-stream). ?label= opcional.
 */
export async function uploadRoutes(app: FastifyInstance, opts: { db: Db; config: Config }) {
  const { db, config } = opts;
  const bodyLimit = config.maxApkMb * 1024 * 1024;

  for (const type of ["application/octet-stream", "application/vnd.android.package-archive"]) {
    app.addContentTypeParser(type, { parseAs: "buffer", bodyLimit }, (_req, body, done) => done(null, body));
  }

  const cors = (req: FastifyRequest, reply: FastifyReply) => {
    const origin = req.headers.origin;
    if (origin && config.panelOrigins.includes(origin)) {
      reply.header("access-control-allow-origin", origin);
      reply.header("vary", "Origin");
      reply.header("access-control-allow-methods", "POST, OPTIONS");
      reply.header("access-control-allow-headers", "content-type, x-upload-token");
      reply.header("access-control-max-age", "600");
    }
  };

  app.options("/v1/upload/apk", async (req, reply) => {
    cors(req, reply);
    return reply.code(204).send();
  });

  app.post("/v1/upload/apk", { bodyLimit }, async (req, reply) => {
    cors(req, reply);
    const token = req.headers["x-upload-token"];
    if (typeof token !== "string" || !token) return reply.code(401).send({ error: "unauthorized", message: "token de envio ausente" });
    const t = (
      await db.query(
        `UPDATE upload_tokens u SET used_at = now() FROM admins a
         WHERE u.token_hash = $1 AND u.used_at IS NULL AND u.expires_at > now() AND a.id = u.admin_id
         RETURNING a.username`,
        [sha256(token)],
      )
    ).rows[0];
    if (!t) return reply.code(401).send({ error: "unauthorized", message: "token de envio inválido ou expirado: recarregue a página" });
    const buf = req.body;
    if (!Buffer.isBuffer(buf) || buf.length === 0) return reply.code(400).send({ error: "invalid_body", message: "arquivo vazio" });

    let apk;
    try {
      apk = parseApk(buf);
    } catch (e) {
      return reply.code(400).send({ error: "invalid_apk", message: e instanceof ApkError ? e.message : "não é um APK válido" });
    }
    if (apk.packageName === "com.pstarx.kiosk") {
      return reply.code(400).send({
        error: "kiosk_app",
        message: "o próprio StarX Kiosk não entra no repositório: publique com publishApk (deploy/README.md) e os aparelhos se atualizam sozinhos",
      });
    }
    const sha = crypto.createHash("sha256").update(buf).digest("hex");
    const { label: rawLabel } = req.query as { label?: string };
    const label = rawLabel?.trim().slice(0, 80);

    const existing = (await db.query("SELECT * FROM apps WHERE package_name = $1", [apk.packageName])).rows[0];
    if (existing && existing.signing_cert_sha256 !== apk.signingCertSha256) {
      return reply.code(409).send({
        error: "signature_mismatch",
        message: "assinatura diferente das versões já enviadas: o Android não instalaria por cima. Remova o app do repositório para trocar de assinatura.",
      });
    }
    const same = (await db.query("SELECT sha256 FROM app_versions WHERE package_name = $1 AND version_code = $2", [apk.packageName, apk.versionCode])).rows[0];
    if (same && same.sha256 !== sha) {
      return reply.code(409).send({ error: "duplicate_version", message: `a versão ${apk.versionCode} já existe com outro arquivo: aumente o versionCode` });
    }

    // grava o arquivo antes do registro (o registro sem arquivo quebraria a instalação)
    fs.mkdirSync(config.appsDir, { recursive: true });
    const dest = apkFile(config, sha);
    if (!fs.existsSync(dest)) {
      const tmp = `${dest}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, buf);
      fs.renameSync(tmp, dest);
    }
    if (!existing) {
      // nome: o informado, ou o que os aparelhos mostram, ou o pacote
      const seen = (
        await db.query(
          `SELECT a->>'label' AS label FROM devices d, jsonb_array_elements(COALESCE(d.apps, '[]'::jsonb)) a
           WHERE a->>'packageName' = $1 AND a->>'label' IS NOT NULL LIMIT 1`,
          [apk.packageName],
        )
      ).rows[0];
      await db.query("INSERT INTO apps (package_name, label, signing_cert_sha256) VALUES ($1, $2, $3)", [
        apk.packageName,
        label || seen?.label || apk.packageName,
        apk.signingCertSha256,
      ]);
    } else if (label) {
      await db.query("UPDATE apps SET label = $2 WHERE package_name = $1", [apk.packageName, label]);
    }
    if (!same) {
      await db.query(
        `INSERT INTO app_versions (package_name, version_code, version_name, min_sdk, sha256, size_bytes, uploaded_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [apk.packageName, apk.versionCode, apk.versionName, apk.minSdk, sha, buf.length, t.username],
      );
    }
    req.log.info({ packageName: apk.packageName, versionCode: apk.versionCode, by: t.username }, "APK enviado ao repositório");
    return { packageName: apk.packageName, versionCode: apk.versionCode, versionName: apk.versionName, sha256: sha, sizeBytes: buf.length, alreadyExisted: !!same };
  });
}

/** Download do APK pelo aparelho (com o token do aparelho). */
export async function deviceAppRoutes(app: FastifyInstance, opts: { db: Db; config: Config }) {
  const { db, config } = opts;
  app.get("/v1/device/apps/:id/apk", async (req, reply) => {
    const device = await authDevice(db, req);
    if (!device) return reply.code(401).send({ error: "unauthorized" });
    const { id } = req.params as { id: string };
    if (!z.uuid().safeParse(id).success) return reply.code(404).send({ error: "not_found" });
    const v = (await db.query("SELECT package_name, version_code, sha256, size_bytes FROM app_versions WHERE id = $1", [id])).rows[0];
    if (!v) return reply.code(404).send({ error: "not_found" });
    const file = apkFile(config, v.sha256);
    if (!fs.existsSync(file)) return reply.code(410).send({ error: "gone", message: "arquivo do APK não encontrado no servidor" });
    reply.header("content-type", "application/vnd.android.package-archive");
    reply.header("content-length", String(v.size_bytes));
    reply.header("content-disposition", `attachment; filename="${v.package_name}-${v.version_code}.apk"`);
    return reply.send(fs.createReadStream(file));
  });
}
