import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { ApkError, parseApk } from "../apk.js";
import type { Config } from "../config.js";
import { newToken, sha256 } from "../crypto.js";
import { asSystem, setTenant, type Db } from "../db.js";
import { authDevice } from "../deviceAuth.js";
import { certChecksum, readPending, readRelease, writeJsonAtomic, type Release } from "../release.js";
import { requirePlatform, tenantOf } from "../tenant.js";

const KIOSK_PACKAGE = "com.pstarx.kiosk";

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

/** Versão mais nova de cada pacote pedido que existe no repositório da empresa. */
export async function latestArtifacts(db: Db, tenantId: string, packages: string[]): Promise<Artifact[]> {
  if (packages.length === 0) return [];
  const r = await db.query(
    `SELECT DISTINCT ON (package_name) * FROM app_versions WHERE tenant_id = $2 AND package_name = ANY($1::text[])
     ORDER BY package_name, version_code DESC`,
    [packages, tenantId],
  );
  return r.rows.map(versionArtifact);
}

/** Uma versão específica (ou a mais nova, sem versionCode). */
export async function findArtifact(db: Db, tenantId: string, packageName: string, versionCode?: number | null): Promise<Artifact | null> {
  const r = versionCode
    ? await db.query("SELECT * FROM app_versions WHERE tenant_id = $3 AND package_name = $1 AND version_code = $2", [packageName, versionCode, tenantId])
    : await db.query("SELECT * FROM app_versions WHERE tenant_id = $2 AND package_name = $1 ORDER BY version_code DESC LIMIT 1", [packageName, tenantId]);
  return r.rows[0] ? versionArtifact(r.rows[0]) : null;
}

/**
 * APKs guardados pelo sha256: o mesmo arquivo enviado por duas empresas ocupa espaço uma vez. Só sai do disco quando
 * nenhuma versão (de nenhuma empresa) usa mais o arquivo.
 */
async function removeUnusedApks(db: Db, config: Config, shas: string[]) {
  for (const sha of new Set(shas)) {
    // olha todas as empresas (o arquivo é compartilhado): como sistema, senão o RLS só mostraria esta
    if ((await asSystem(() => db.query("SELECT 1 FROM app_versions WHERE sha256 = $1 LIMIT 1", [sha]))).rowCount) continue;
    fs.rmSync(apkFile(config, sha), { force: true });
  }
}

/** Repositório de apps da empresa no painel (escopo de empresa). */
export async function appRepoRoutes(app: FastifyInstance, opts: { db: Db; config: Config }) {
  const { db, config } = opts;

  app.get("/v1/admin/apps", async (req) => {
    const t = tenantOf(req);
    const apps = (await db.query("SELECT * FROM apps WHERE tenant_id = $1 ORDER BY lower(label)", [t])).rows;
    const versions = (await db.query("SELECT * FROM app_versions WHERE tenant_id = $1 ORDER BY package_name, version_code DESC", [t])).rows;
    const profiles = (await db.query("SELECT id, name, managed_apps FROM profiles WHERE tenant_id = $1 ORDER BY name", [t])).rows;
    // aparelhos com o app instalado, por versão (da lista de apps do último check-in)
    const installed = (
      await db.query(
        `SELECT a->>'packageName' AS package, (a->>'versionCode')::bigint AS version_code, count(*)::int AS devices
         FROM devices d, jsonb_array_elements(COALESCE(d.apps, '[]'::jsonb)) a
         WHERE d.tenant_id = $2 AND a->>'packageName' = ANY($1::text[]) GROUP BY 1, 2`,
        [apps.map((a) => a.package_name), t],
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

  app.patch("/v1/admin/apps/:pkg", async (req, reply) => {
    const { pkg } = req.params as { pkg: string };
    const body = z.object({ label: z.string().trim().min(1).max(80) }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "invalid_body" });
    const r = await db.query("UPDATE apps SET label = $2 WHERE tenant_id = $3 AND package_name = $1", [pkg, body.data.label, tenantOf(req)]);
    if (!r.rowCount) return reply.code(404).send({ error: "not_found" });
    return { ok: true };
  });

  app.delete("/v1/admin/apps/:pkg", async (req, reply) => {
    const { pkg } = req.params as { pkg: string };
    const t = tenantOf(req);
    const used = (await db.query("SELECT name FROM profiles WHERE tenant_id = $2 AND managed_apps ? $1 ORDER BY name", [pkg, t])).rows;
    if (used.length) {
      return reply.code(409).send({ error: "in_use", message: `o app está nos perfis: ${used.map((p) => p.name).join(", ")}. Tire de lá antes.` });
    }
    const files = (await db.query("SELECT sha256 FROM app_versions WHERE tenant_id = $2 AND package_name = $1", [pkg, t])).rows;
    const r = await db.query("DELETE FROM apps WHERE tenant_id = $2 AND package_name = $1", [pkg, t]);
    if (!r.rowCount) return reply.code(404).send({ error: "not_found" });
    await removeUnusedApks(db, config, files.map((f) => f.sha256));
    return { ok: true };
  });

  app.delete("/v1/admin/apps/:pkg/versions/:versionCode", async (req, reply) => {
    const { pkg, versionCode } = req.params as { pkg: string; versionCode: string };
    const r = await db.query("DELETE FROM app_versions WHERE tenant_id = $3 AND package_name = $1 AND version_code = $2 RETURNING sha256", [
      pkg,
      Number(versionCode) || -1,
      tenantOf(req),
    ]);
    if (!r.rowCount) return reply.code(404).send({ error: "not_found" });
    await removeUnusedApks(db, config, [r.rows[0].sha256]);
    return { ok: true };
  });
}

/** App do kiosk (um só para todas as empresas) e token de envio de APK. Escopo da conta: vale para a plataforma. */
export async function kioskReleaseRoutes(app: FastifyInstance, opts: { db: Db; config: Config }) {
  const { db, config } = opts;

  // ---------------------------------------------------------------- app do kiosk (atualização automática)

  app.get("/v1/admin/kiosk-release", async (req) => {
    // versões nos coletores: os da empresa; a plataforma vê o total de todas
    const t = req.admin!.tenantId;
    // a plataforma (sem empresa) soma os coletores de todas: como sistema
    const run = <T,>(fn: () => Promise<T>) => (t ? fn() : asSystem(fn));
    const versions = (
      await run(() => db.query(
        `SELECT app_version AS version_name, app_version_code AS version_code, count(*)::int AS devices
         FROM devices WHERE $1::uuid IS NULL OR tenant_id = $1 GROUP BY 1, 2 ORDER BY 2 DESC NULLS LAST`,
        [t],
      ))
    ).rows;
    const pendingFile = path.join(config.apkDir, "pending.json");
    const uploadedBy = fs.existsSync(pendingFile) ? (JSON.parse(fs.readFileSync(pendingFile, "utf8")).uploadedBy ?? null) : null;
    return {
      release: readRelease(config.apkDir),
      pending: readPending(config.apkDir),
      pendingUploadedBy: uploadedBy,
      autoUpdate: config.autoUpdateApp,
      maxApkMb: config.maxApkMb,
      devices: versions.map((v) => ({ versionName: v.version_name, versionCode: v.version_code, devices: v.devices })),
    };
  });

  /** Publica a versão pendente: vira o release.json (QR e atualização automática dos aparelhos). */
  app.post("/v1/admin/kiosk-release/publish", { preHandler: requirePlatform }, async (req, reply) => {
    const pending = readPending(config.apkDir);
    if (!pending) return reply.code(404).send({ error: "no_pending", message: "nenhuma versão pendente" });
    const current = readRelease(config.apkDir);
    if (current && pending.versionCode <= current.versionCode) {
      return reply.code(409).send({ error: "not_newer", message: "a versão pendente não é mais nova que a publicada" });
    }
    const { uploadedBy: _ignored, ...release } = JSON.parse(fs.readFileSync(path.join(config.apkDir, "pending.json"), "utf8"));
    writeJsonAtomic(path.join(config.apkDir, "release.json"), release);
    fs.rmSync(path.join(config.apkDir, "pending.json"), { force: true });
    req.log.info({ versionCode: pending.versionCode, by: req.admin!.username }, "app do kiosk publicado");
    return { release: readRelease(config.apkDir) };
  });

  app.delete("/v1/admin/kiosk-release/pending", { preHandler: requirePlatform }, async (req, reply) => {
    const pending = readPending(config.apkDir);
    if (!pending) return reply.code(404).send({ error: "no_pending" });
    if (pending.file !== readRelease(config.apkDir)?.file) fs.rmSync(path.join(config.apkDir, pending.file), { force: true });
    fs.rmSync(path.join(config.apkDir, "pending.json"), { force: true });
    return { ok: true };
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
    return { token, uploadUrl: `${config.publicUrl}/v1/upload/apk`, kioskUploadUrl: `${config.publicUrl}/v1/upload/kiosk-apk`, maxApkMb: config.maxApkMb };
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

  /** Consome o token de uso único; devolve quem enviou (com a empresa e se é da plataforma) ou null. */
  async function consumeToken(req: FastifyRequest): Promise<{ username: string; tenant_id: string | null; platform: boolean } | null> {
    const token = req.headers["x-upload-token"];
    if (typeof token !== "string" || !token) return null;
    return (
      (
        await db.query(
          `UPDATE upload_tokens u SET used_at = now() FROM admins a
           WHERE u.token_hash = $1 AND u.used_at IS NULL AND u.expires_at > now() AND a.id = u.admin_id
           RETURNING a.username, a.tenant_id, a.platform`,
          [sha256(token)],
        )
      ).rows[0] ?? null
    );
  }

  for (const url of ["/v1/upload/apk", "/v1/upload/kiosk-apk"]) {
    app.options(url, async (req, reply) => {
      cors(req, reply);
      return reply.code(204).send();
    });
  }

  /**
   * Versão nova do próprio app do kiosk. Fica pendente (pending.json) até "Publicar" no painel. Exige o mesmo
   * certificado da versão publicada (senão os aparelhos recusam a atualização) e versionCode maior.
   */
  app.post("/v1/upload/kiosk-apk", { bodyLimit }, async (req, reply) => {
    cors(req, reply);
    const t = await consumeToken(req);
    if (!t) return reply.code(401).send({ error: "unauthorized", message: "token de envio inválido ou expirado: recarregue a página" });
    // o app do kiosk é um só para todas as empresas: só a plataforma publica
    if (!t.platform) return reply.code(403).send({ error: "forbidden", message: "só a plataforma publica o app do kiosk" });
    const buf = req.body;
    if (!Buffer.isBuffer(buf) || buf.length === 0) return reply.code(400).send({ error: "invalid_body", message: "arquivo vazio" });
    let apk;
    try {
      apk = parseApk(buf);
    } catch (e) {
      return reply.code(400).send({ error: "invalid_apk", message: e instanceof ApkError ? e.message : "não é um APK válido" });
    }
    if (apk.packageName !== KIOSK_PACKAGE) {
      return reply.code(400).send({ error: "not_kiosk", message: `este APK é ${apk.packageName}, não o StarX Kiosk (${KIOSK_PACKAGE}). Apps comuns vão no repositório abaixo.` });
    }
    const checksum = certChecksum(apk.signingCertSha256);
    const current = readRelease(config.apkDir);
    if (current && current.signatureChecksum !== checksum) {
      return reply.code(409).send({
        error: "signature_mismatch",
        message: "assinado com outra chave: os aparelhos recusariam a atualização. Gere o APK com a keystore de release (~/.starx-kiosk/signing).",
      });
    }
    if (current && apk.versionCode <= current.versionCode) {
      return reply.code(409).send({ error: "not_newer", message: `a versão publicada já é ${current.versionName} (${current.versionCode}): aumente o versionCode` });
    }
    const file = `starx-kiosk-${apk.versionCode}.apk`;
    const sha = crypto.createHash("sha256").update(buf).digest("hex");
    const pending: Release = {
      packageName: apk.packageName,
      versionCode: apk.versionCode,
      versionName: apk.versionName ?? String(apk.versionCode),
      file,
      sizeBytes: buf.length,
      sha256: sha,
      signatureChecksum: checksum,
      builtAt: new Date().toISOString(),
    };
    fs.mkdirSync(config.apkDir, { recursive: true });
    // descarta um pendente anterior (outro arquivo)
    const old = readPending(config.apkDir);
    if (old && old.file !== file && old.file !== current?.file) fs.rmSync(path.join(config.apkDir, old.file), { force: true });
    const dest = path.join(config.apkDir, file);
    fs.writeFileSync(`${dest}.tmp`, buf);
    fs.renameSync(`${dest}.tmp`, dest);
    writeJsonAtomic(path.join(config.apkDir, "pending.json"), { ...pending, uploadedBy: t.username });
    req.log.info({ versionCode: apk.versionCode, by: t.username }, "APK do kiosk enviado (pendente)");
    return { pending };
  });

  app.post("/v1/upload/apk", { bodyLimit }, async (req, reply) => {
    cors(req, reply);
    const t = await consumeToken(req);
    if (!t) return reply.code(401).send({ error: "unauthorized", message: "token de envio inválido ou expirado: recarregue a página" });
    // repositório de apps: da empresa de quem enviou
    const tenantId = t.tenant_id;
    if (!tenantId) return reply.code(403).send({ error: "no_tenant", message: "Usuário da plataforma: o repositório de apps é de uma empresa." });
    setTenant(tenantId);
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
        message: "o próprio StarX Kiosk não entra no repositório: envie em \"App do kiosk\", no alto desta página",
      });
    }
    const sha = crypto.createHash("sha256").update(buf).digest("hex");
    const { label: rawLabel } = req.query as { label?: string };
    const label = rawLabel?.trim().slice(0, 80);

    const existing = (await db.query("SELECT * FROM apps WHERE tenant_id = $2 AND package_name = $1", [apk.packageName, tenantId])).rows[0];
    if (existing && existing.signing_cert_sha256 !== apk.signingCertSha256) {
      return reply.code(409).send({
        error: "signature_mismatch",
        message: "assinatura diferente das versões já enviadas: o Android não instalaria por cima. Remova o app do repositório para trocar de assinatura.",
      });
    }
    const same = (
      await db.query("SELECT sha256 FROM app_versions WHERE tenant_id = $3 AND package_name = $1 AND version_code = $2", [apk.packageName, apk.versionCode, tenantId])
    ).rows[0];
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
           WHERE d.tenant_id = $2 AND a->>'packageName' = $1 AND a->>'label' IS NOT NULL LIMIT 1`,
          [apk.packageName, tenantId],
        )
      ).rows[0];
      await db.query("INSERT INTO apps (tenant_id, package_name, label, signing_cert_sha256) VALUES ($4, $1, $2, $3)", [
        apk.packageName,
        label || seen?.label || apk.packageName,
        apk.signingCertSha256,
        tenantId,
      ]);
    } else if (label) {
      await db.query("UPDATE apps SET label = $2 WHERE tenant_id = $3 AND package_name = $1", [apk.packageName, label, tenantId]);
    }
    if (!same) {
      await db.query(
        `INSERT INTO app_versions (tenant_id, package_name, version_code, version_name, min_sdk, sha256, size_bytes, uploaded_by)
         VALUES ($8, $1, $2, $3, $4, $5, $6, $7)`,
        [apk.packageName, apk.versionCode, apk.versionName, apk.minSdk, sha, buf.length, t.username, tenantId],
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
    // só versões do repositório da empresa do coletor
    const v = (await db.query("SELECT package_name, version_code, sha256, size_bytes FROM app_versions WHERE id = $1 AND tenant_id = $2", [id, device.tenant_id])).rows[0];
    if (!v) return reply.code(404).send({ error: "not_found" });
    const file = apkFile(config, v.sha256);
    if (!fs.existsSync(file)) return reply.code(410).send({ error: "gone", message: "arquivo do APK não encontrado no servidor" });
    reply.header("content-type", "application/vnd.android.package-archive");
    reply.header("content-length", String(v.size_bytes));
    reply.header("content-disposition", `attachment; filename="${v.package_name}-${v.version_code}.apk"`);
    return reply.send(fs.createReadStream(file));
  });
}
