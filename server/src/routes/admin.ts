import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import type { Config } from "../config.js";
import { hashPassword, needsRehash, newEnrollmentCode, newToken, sha256, verifyPassword } from "../crypto.js";
import type { Db } from "../db.js";
import { redactConfig } from "../kioskConfig.js";
import { provisioningPayload, readRelease } from "../release.js";
import { appRepoRoutes } from "./apps.js";
import { commandRoutes } from "./commands.js";
import { configStatus, profileRoutes } from "./profiles.js";
import { securityRoutes } from "./security.js";
import { mfaAccountRoutes, mfaDeps, mfaPublicRoutes, revokeTrust } from "./mfa.js";
import { passkeyAccountRoutes, passkeyPublicRoutes } from "./passkeys.js";
import { opsAdminRoutes } from "./opsAdmin.js";
import type { OpsLive } from "../opsLive.js";
import type { Mailer } from "../mfa.js";
import { audit, clearLock, lockedFor, lockKey, recordFailure } from "../auth.js";
import type { Waker } from "../wake.js";

declare module "fastify" {
  interface FastifyRequest {
    admin?: { id: string; username: string; email: string | null; role: "admin" | "operator"; sessionId: string };
  }
}

/** Login por usuário ou e-mail. */
const Login = z.object({
  username: z.string().trim().min(1).max(200),
  password: z.string().min(1).max(256),
  /** "confiar neste navegador" (cookie do painel): pula o segundo fator por 30 dias */
  trustToken: z.string().max(200).optional(),
});

/** 429 com Retry-After e mensagem genérica (não diz se a conta existe). */
function tooMany(reply: FastifyReply, sec: number) {
  reply.header("retry-after", String(sec));
  const min = Math.ceil(sec / 60);
  return reply.code(429).send({
    error: "too_many_attempts",
    message: `Muitas tentativas. Tente de novo em ${sec < 60 ? `${sec} s` : `${min} min`}.`,
    retryAfterSec: sec,
  });
}
const ChangePassword = z.object({ current: z.string().min(1), next: z.string().min(10).max(256) });
/** Renomear e/ou marcar o piloto da leitura do SSW. */
const DevicePatch = z
  .object({ name: z.string().trim().min(1).max(80).optional(), opsReader: z.boolean().optional() })
  .refine((b) => b.name !== undefined || b.opsReader !== undefined);
const CreateCode = z.object({
  name: z.string().trim().min(1).max(80),
  maxUses: z.number().int().min(1).max(100_000).nullable().optional(),
  expiresInDays: z.number().int().min(1).max(3650).nullable().optional(),
  initialConfig: z.record(z.string(), z.unknown()).nullable().optional(),
  profileId: z.uuid().nullable().optional(),
});
const Qr = z.object({
  wifi: z
    .object({
      ssid: z.string().min(1).max(64),
      password: z.string().max(128).optional(),
      security: z.enum(["WPA", "WEP", "NONE"]).optional(),
      hidden: z.boolean().optional(),
    })
    .nullable()
    .optional(),
});

/** Fora disso, o aparelho é considerado offline. */
export function onlineWindowSec(config: Config) {
  return config.checkinIntervalSec * 3;
}

export async function adminRoutes(app: FastifyInstance, opts: { db: Db; config: Config; waker: Waker; mailer: Mailer; live: OpsLive }) {
  const { db, config, waker } = opts;
  const { beginMfa } = mfaDeps(db, config, opts.mailer);
  await app.register(mfaPublicRoutes, { db, config, mailer: opts.mailer });
  await app.register(passkeyPublicRoutes, { db, config });

  async function requireAdmin(req: FastifyRequest, reply: FastifyReply) {
    const auth = req.headers.authorization;
    if (!auth?.startsWith("Bearer ")) return reply.code(401).send({ error: "unauthorized" });
    const tokenHash = sha256(auth.slice(7));
    // vale até a validade máxima (2 dias) e enquanto não ficar parada além do limite de inatividade (8 h)
    const r = await db.query(
      `UPDATE sessions s SET last_used_at = now() FROM admins a
       WHERE s.token_hash = $1 AND s.stage = 'full' AND s.expires_at > now() AND s.last_used_at > now() - make_interval(hours => $2)
         AND a.id = s.admin_id AND a.disabled_at IS NULL
       RETURNING s.id AS session_id, a.id, a.username, a.email, a.role`,
      [tokenHash, config.sessionIdleHours],
    );
    if (!r.rows[0]) {
      // sessão vencida por inatividade/validade: sai do banco (logout no servidor)
      // (só sessão normal: a provisória do 2FA não é derrubada por quem a usa numa rota do painel)
      await db.query("DELETE FROM sessions WHERE token_hash = $1 AND stage = 'full'", [tokenHash]);
      return reply.code(401).send({ error: "unauthorized" });
    }
    const a = r.rows[0];
    req.admin = { id: a.id, username: a.username, email: a.email, role: a.role, sessionId: a.session_id };
  }

  // ---------------------------------------------------------------- sessão

  app.post("/v1/admin/login", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (req, reply) => {
    const body = Login.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "invalid_body" });
    const identifier = body.data.username;
    const ipKey = lockKey("ip", req.ip);
    const accountKey = lockKey("account", identifier);

    // bloqueado (IP ou conta): nem confere a senha
    const blocked = Math.max(await lockedFor(db, "ip", ipKey), await lockedFor(db, "account", accountKey));
    if (blocked > 0) {
      await audit(db, req, "login_blocked", { identifier, details: { retryAfterSec: blocked } });
      return tooMany(reply, blocked);
    }

    const admin = (
      await db.query("SELECT id, username, email, password_hash, disabled_at FROM admins WHERE username = $1 OR lower(email) = lower($1) ORDER BY username = $1 DESC LIMIT 1", [
        identifier,
      ])
    ).rows[0];
    // conta bloqueada pelo segundo fator (erros de código contam no usuário, qualquer que seja o identificador digitado)
    if (admin) {
      const mfaLock = await lockedFor(db, "account", lockKey("account", admin.username));
      if (mfaLock > 0) {
        await audit(db, req, "login_blocked", { adminId: admin.id, identifier, details: { retryAfterSec: mfaLock } });
        return tooMany(reply, mfaLock);
      }
    }
    // conta inexistente gasta o mesmo tempo (hash falso): a resposta não revela quais contas existem
    const passwordOk = admin ? await verifyPassword(body.data.password, admin.password_hash) : await verifyPassword(body.data.password, await DUMMY_HASH_PROMISE()).then(() => false);
    const ok = passwordOk && !admin.disabled_at;
    if (!ok) {
      const reason = !admin ? "unknown_account" : admin.disabled_at ? "disabled" : "bad_password";
      const lockIp = await recordFailure(db, "ip", ipKey);
      const lockAccount = await recordFailure(db, "account", accountKey);
      await audit(db, req, "login_failure", { adminId: admin?.id ?? null, identifier, details: { reason } });
      if (lockIp || lockAccount) {
        await audit(db, req, "lockout", { adminId: admin?.id ?? null, identifier, details: { ipSec: lockIp, accountSec: lockAccount } });
      }
      req.log.warn({ identifier, reason }, "login recusado");
      return reply.code(401).send({ error: "invalid_credentials", message: "usuário ou senha incorretos" });
    }

    await clearLock(db, "account", accountKey);
    await clearLock(db, "ip", ipKey);
    // senha antiga (scrypt): regrava em Argon2id agora que a senha certa está em mãos
    if (needsRehash(admin.password_hash)) {
      await db.query("UPDATE admins SET password_hash = $2 WHERE id = $1", [admin.id, await hashPassword(body.data.password)]);
      await audit(db, req, "password_rehashed", { adminId: admin.id, details: { to: "argon2id" } });
    }
    // segundo fator: com AUTH_REQUIRE_2FA (e navegador não confiável), a resposta é a etapa 2, não a sessão
    const mfa = await beginMfa(req, admin, body.data.trustToken);
    if (mfa) {
      await audit(db, req, "login_password_ok", { adminId: admin.id, identifier, details: { codeSent: mfa.codeSent } });
      return mfa;
    }
    // sessão nova a cada login (rotação): o token anterior do navegador, se houver, o painel descarta
    const token = newToken();
    const expires = new Date(Date.now() + config.sessionTtlHours * 3600_000);
    await db.query("INSERT INTO sessions (admin_id, token_hash, expires_at, ip, user_agent) VALUES ($1, $2, $3, $4, $5)", [
      admin.id,
      sha256(token),
      expires,
      req.ip,
      (req.headers["user-agent"] ?? "").toString().slice(0, 300) || null,
    ]);
    await db.query("DELETE FROM sessions WHERE expires_at < now() OR last_used_at < now() - make_interval(hours => $1)", [config.sessionIdleHours]);
    await db.query("DELETE FROM email_otps WHERE created_at < now() - interval '1 day'");
    await audit(db, req, "login_success", { adminId: admin.id, identifier });
    return { token, expiresAt: expires.toISOString(), idleHours: config.sessionIdleHours };
  });

  app.register(async (priv) => {
    priv.addHook("preHandler", requireAdmin);

    await priv.register(profileRoutes, { db, waker });
    await priv.register(commandRoutes, { db, waker });
    await priv.register(appRepoRoutes, { db, config });

    priv.post("/v1/admin/logout", async (req) => {
      await db.query("DELETE FROM sessions WHERE id = $1", [req.admin!.sessionId]);
      await audit(db, req, "logout", { adminId: req.admin!.id });
      return { ok: true };
    });

    priv.get("/v1/admin/me", async (req) => ({
      id: req.admin!.id,
      username: req.admin!.username,
      email: req.admin!.email,
      role: req.admin!.role,
    }));

    await priv.register(securityRoutes, { db, config });
    await priv.register(mfaAccountRoutes, { db, config });
    await priv.register(passkeyAccountRoutes, { db, config });
    await priv.register(opsAdminRoutes, { db, config, live: opts.live });

    priv.post("/v1/admin/password", async (req, reply) => {
      const body = ChangePassword.safeParse(req.body);
      if (!body.success) return reply.code(400).send({ error: "invalid_body", message: "a nova senha precisa ter pelo menos 10 caracteres" });
      const row = (await db.query("SELECT password_hash FROM admins WHERE id = $1", [req.admin!.id])).rows[0];
      if (!(await verifyPassword(body.data.current, row.password_hash))) return reply.code(400).send({ error: "invalid_password", message: "senha atual incorreta" });
      await db.query("UPDATE admins SET password_hash = $2, password_changed_at = now() WHERE id = $1", [req.admin!.id, await hashPassword(body.data.next)]);
      // derruba as outras sessões
      await db.query("DELETE FROM sessions WHERE admin_id = $1 AND id <> $2", [req.admin!.id, req.admin!.sessionId]);
      await revokeTrust(db, req.admin!.id);
      await audit(db, req, "password_changed", { adminId: req.admin!.id });
      return { ok: true };
    });

    // ---------------------------------------------------------------- aparelhos

    priv.get("/v1/admin/devices", async () => {
      const r = await db.query(
        `SELECT d.id, d.name, d.serial, d.manufacturer, d.model, d.android_version, d.app_version, d.enrolled_at, d.last_seen_at, d.last_ip,
                d.info->'battery' AS battery, d.info->'network' AS network, d.info->'app' AS app, d.config_revision, d.config_source,
                (d.info->>'uptimeMs')::bigint AS uptime_ms, d.info_updated_at, d.info->'session' AS session,
                d.config->'kiosk'->>'mode' AS kiosk_mode, (d.config->'kiosk'->>'enabled')::boolean AS kiosk_enabled,
                d.last_seen_at > now() - make_interval(secs => $1) AS online,
                d.profile_id, p.name AS profile_name, p.config AS profile_config, d.config_overrides, d.config_nonce, d.applied_hash, d.failed_hash,
                d.ops_reader, s.ssw_user
         FROM devices d LEFT JOIN profiles p ON p.id = d.profile_id LEFT JOIN ops_device_state s ON s.device_id = d.id ORDER BY d.name`,
        [onlineWindowSec(config)],
      );
      return {
        onlineWindowSec: onlineWindowSec(config),
        devices: r.rows.map((d) => ({
          id: d.id,
          name: d.name,
          serial: d.serial,
          manufacturer: d.manufacturer,
          model: d.model,
          androidVersion: d.android_version,
          appVersion: d.app_version,
          enrolledAt: d.enrolled_at,
          lastSeenAt: d.last_seen_at,
          lastIp: d.last_ip,
          online: d.online === true,
          battery: d.battery ?? null,
          network: d.network
            ? {
                type: d.network.type,
                ssid: d.network.wifi?.ssid ?? null,
                rssi: d.network.wifi?.rssi ?? null,
                ip: d.network.ipAddresses?.[0] ?? null,
                mac: d.network.wifiMac ?? null,
              }
            : null,
          // tempo ligado no último contato (o painel soma o tempo desde então, se o aparelho está online)
          uptimeMs: d.uptime_ms !== null ? Number(d.uptime_ms) : null,
          infoUpdatedAt: d.info_updated_at,
          // usuário logado no SSW (leitura da fase 2.4); antes dela, info.session.user (reservado)
          loggedUser: d.ssw_user ?? (typeof d.session?.user === "string" && d.session.user ? d.session.user : null),
          opsReader: d.ops_reader === true,
          kioskActive: d.app?.kioskActive ?? null,
          kioskMode: d.kiosk_mode,
          kioskEnabled: d.kiosk_enabled,
          configRevision: d.config_revision,
          profileId: d.profile_id,
          profileName: d.profile_name,
          hasOverrides: !!d.config_overrides,
          configStatus: configStatus(d).status,
        })),
      };
    });

    priv.get("/v1/admin/devices/:id", async (req, reply) => {
      const { id } = req.params as { id: string };
      if (!z.uuid().safeParse(id).success) return reply.code(404).send({ error: "not_found" });
      const r = await db.query(
        `SELECT d.*, e.name AS enrollment_name, d.last_seen_at > now() - make_interval(secs => $2) AS online,
                p.name AS profile_name, p.config AS profile_config, p.managed_apps,
                (SELECT ssw_user FROM ops_device_state s WHERE s.device_id = d.id) AS ssw_user
         FROM devices d LEFT JOIN enrollment_codes e ON e.id = d.enrollment_code_id LEFT JOIN profiles p ON p.id = d.profile_id
         WHERE d.id = $1`,
        [id, onlineWindowSec(config)],
      );
      const d = r.rows[0];
      if (!d) return reply.code(404).send({ error: "not_found" });
      return {
        id: d.id,
        name: d.name,
        serial: d.serial,
        manufacturer: d.manufacturer,
        model: d.model,
        androidVersion: d.android_version,
        appVersion: d.app_version,
        enrolledAt: d.enrolled_at,
        enrollmentName: d.enrollment_name,
        lastSeenAt: d.last_seen_at,
        lastIp: d.last_ip,
        online: d.online === true,
        info: d.info,
        infoUpdatedAt: d.info_updated_at,
        apps: d.apps ?? [],
        appsUpdatedAt: d.apps_updated_at,
        config: d.config,
        configRevision: d.config_revision,
        configSource: d.config_source,
        configUpdatedAt: d.config_updated_at,
        profileId: d.profile_id,
        profileName: d.profile_name,
        overrides: redactConfig(d.config_overrides),
        configStatus: configStatus(d).status,
        applyError: d.apply_error,
        applyWarnings: d.apply_warnings ?? [],
        appliedAt: d.applied_at,
        appVersionCode: d.app_version_code,
        managedApps: (d.managed_apps as string[] | null) ?? [],
        managedStatus: d.managed_status ?? {},
        lastScreenshotAt: d.last_screenshot_at,
        opsReader: d.ops_reader === true,
        sswUser: d.ssw_user ?? null,
      };
    });

    priv.patch("/v1/admin/devices/:id", async (req, reply) => {
      const { id } = req.params as { id: string };
      const body = DevicePatch.safeParse(req.body);
      if (!body.success || !z.uuid().safeParse(id).success) return reply.code(400).send({ error: "invalid_body" });
      const { name, opsReader } = body.data;
      const r = await db.query(
        `UPDATE devices d SET name = COALESCE($2, d.name), ops_reader = COALESCE($3, d.ops_reader)
         FROM (SELECT id, ops_reader AS before FROM devices WHERE id = $1 FOR UPDATE) o
         WHERE d.id = o.id RETURNING o.before`,
        [id, name ?? null, opsReader ?? null],
      );
      if (!r.rowCount) return reply.code(404).send({ error: "not_found" });
      if (opsReader !== undefined && opsReader !== r.rows[0].before) {
        await audit(db, req, opsReader ? "ops_reader_on" : "ops_reader_off", { adminId: req.admin?.id ?? null, details: { deviceId: id } });
        // o coletor fica sabendo no próximo check-in; o aviso antecipa
        waker.wake([id]);
      }
      return { ok: true };
    });

    /** Remove do painel. O token deixa de valer: o aparelho mostra "removido do painel" até ser cadastrado de novo. */
    priv.delete("/v1/admin/devices/:id", async (req, reply) => {
      const { id } = req.params as { id: string };
      if (!z.uuid().safeParse(id).success) return reply.code(404).send({ error: "not_found" });
      const r = await db.query("DELETE FROM devices WHERE id = $1", [id]);
      if (!r.rowCount) return reply.code(404).send({ error: "not_found" });
      opts.live.removed(id);
      return { ok: true };
    });

    // ---------------------------------------------------------------- códigos de cadastro

    priv.get("/v1/admin/enrollments", async () => {
      const r = await db.query(
        `SELECT e.*, (SELECT count(*)::int FROM devices d WHERE d.enrollment_code_id = e.id) AS devices, p.name AS profile_name
         FROM enrollment_codes e LEFT JOIN profiles p ON p.id = e.profile_id ORDER BY e.created_at DESC`,
      );
      return {
        release: readRelease(config.apkDir),
        enrollments: r.rows.map(codeJson),
      };
    });

    priv.post("/v1/admin/enrollments", async (req, reply) => {
      const body = CreateCode.safeParse(req.body);
      if (!body.success) return reply.code(400).send({ error: "invalid_body", details: body.error.issues });
      const b = body.data;
      if (b.profileId && !(await db.query("SELECT 1 FROM profiles WHERE id = $1", [b.profileId])).rowCount) {
        return reply.code(400).send({ error: "invalid_profile", message: "perfil não existe" });
      }
      const expires = b.expiresInDays ? new Date(Date.now() + b.expiresInDays * 86_400_000) : null;
      const r = await db.query(
        `INSERT INTO enrollment_codes (code, name, max_uses, expires_at, initial_config, profile_id) VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING *, 0 AS devices, (SELECT name FROM profiles WHERE id = $6) AS profile_name`,
        [newEnrollmentCode(), b.name, b.maxUses ?? null, expires, b.initialConfig ?? null, b.profileId ?? null],
      );
      return codeJson(r.rows[0]);
    });

    priv.delete("/v1/admin/enrollments/:id", async (req, reply) => {
      const { id } = req.params as { id: string };
      if (!z.uuid().safeParse(id).success) return reply.code(404).send({ error: "not_found" });
      const r = await db.query("UPDATE enrollment_codes SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL", [id]);
      if (!r.rowCount) return reply.code(404).send({ error: "not_found" });
      return { ok: true };
    });

    /** Conteúdo do QR de provisionamento (o painel desenha o QR). O Wi-Fi vai só no QR, não fica gravado. */
    priv.post("/v1/admin/enrollments/:id/qr", async (req, reply) => {
      const { id } = req.params as { id: string };
      const body = Qr.safeParse(req.body ?? {});
      if (!body.success || !z.uuid().safeParse(id).success) return reply.code(400).send({ error: "invalid_body" });
      const e = (await db.query("SELECT * FROM enrollment_codes WHERE id = $1", [id])).rows[0];
      if (!e) return reply.code(404).send({ error: "not_found" });
      const release = readRelease(config.apkDir);
      if (!release) return reply.code(409).send({ error: "no_release", message: "nenhum APK publicado no servidor (veja deploy/README.md)" });
      return {
        payload: provisioningPayload(release, {
          publicUrl: config.publicUrl,
          code: e.code,
          initialConfig: e.initial_config,
          wifi: body.data.wifi ?? undefined,
        }),
        release,
      };
    });
  });

  function codeJson(e: Record<string, any>) {
    const now = Date.now();
    const status = e.revoked_at
      ? "revoked"
      : e.expires_at && new Date(e.expires_at).getTime() <= now
        ? "expired"
        : e.max_uses !== null && e.uses >= e.max_uses
          ? "exhausted"
          : "active";
    return {
      id: e.id,
      code: e.code,
      name: e.name,
      maxUses: e.max_uses,
      uses: e.uses,
      devices: e.devices ?? 0,
      expiresAt: e.expires_at,
      revokedAt: e.revoked_at,
      createdAt: e.created_at,
      initialConfig: e.initial_config,
      profileId: e.profile_id,
      profileName: e.profile_name ?? null,
      status,
      serverUrl: config.publicUrl,
    };
  }
}

// hash falso (Argon2id, mesmos parâmetros) para gastar o mesmo tempo quando a conta não existe: o tempo de resposta
// não revela quais contas existem. Calculado uma vez, na primeira tentativa.
let dummyHash: Promise<string> | null = null;
const DUMMY_HASH_PROMISE = () => (dummyHash ??= hashPassword(newToken()));

export async function ensureAdmin(db: Db, config: Config, log: { info: (msg: string) => void }) {
  const count = Number((await db.query("SELECT count(*) FROM admins")).rows[0].count);
  if (count > 0 || !config.adminUsername || !config.adminPassword) return;
  await db.query("INSERT INTO admins (username, password_hash) VALUES ($1, $2)", [config.adminUsername, await hashPassword(config.adminPassword)]);
  log.info(`administrador inicial "${config.adminUsername}" criado (troque a senha e remova ADMIN_PASSWORD do .env)`);
}
