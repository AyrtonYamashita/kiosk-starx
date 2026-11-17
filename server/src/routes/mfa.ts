import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { audit, lockedFor, lockKey, recordFailure } from "../auth.js";
import type { Config } from "../config.js";
import { newToken, sha256, verifyPassword } from "../crypto.js";
import type { Db } from "../db.js";
import { browserLabel, codeHmac, formatCode, hmacEqual, maskEmail, newCode, normalizeCode, otpEmail, type Mailer } from "../mfa.js";
import { decryptSecret, encryptSecret, newTotpSecret, otpauthUri, verifyTotp } from "../totp.js";

/**
 * Segundo fator (1.3a): código por e-mail, códigos de recuperação e "confiar neste navegador".
 *
 * Depois da senha certa (com AUTH_REQUIRE_2FA), o login devolve uma sessão "mfa" de 10 min que só serve aqui:
 * pedir/reenviar o código e conferir. Conferiu: a sessão "mfa" sai e nasce uma sessão normal (token novo).
 */
const MFA_SESSION_MIN = 10;
const MAX_ATTEMPTS_PER_CODE = 5;
const MAX_ATTEMPTS_PER_SESSION = 5;
const SEND_WINDOW_MIN = 15;
const SEND_MAX_PER_WINDOW = 3;
const SEND_MIN_GAP_SEC = 60;
const SEND_MAX_PER_IP_HOUR = 10;
const RECOVERY_CODES = 10;

type Admin = { id: string; username: string; email: string | null };

/** Limite de envio de código: por conta (3 a cada 15 min, 60 s entre envios) e por IP (10 por hora). */
async function sendBlockedFor(db: Db, adminId: string, ip: string): Promise<number> {
  const acc = (
    await db.query(
      `SELECT count(*)::int AS n, extract(epoch FROM now() - max(created_at))::int AS since,
              extract(epoch FROM min(created_at) + make_interval(mins => $2) - now())::int AS window_left
       FROM email_otps WHERE admin_id = $1 AND created_at > now() - make_interval(mins => $2)`,
      [adminId, SEND_WINDOW_MIN],
    )
  ).rows[0];
  if (acc.n >= SEND_MAX_PER_WINDOW) return Math.max(1, acc.window_left);
  if (acc.since !== null && acc.since < SEND_MIN_GAP_SEC) return SEND_MIN_GAP_SEC - acc.since;
  const byIp = (await db.query("SELECT count(*)::int AS n FROM email_otps WHERE ip = $1 AND created_at > now() - interval '1 hour'", [ip])).rows[0];
  if (byIp.n >= SEND_MAX_PER_IP_HOUR) return 15 * 60;
  return 0;
}

function retry(reply: FastifyReply, sec: number, message: string) {
  reply.header("retry-after", String(sec));
  return reply.code(429).send({ error: "too_many_requests", message, retryAfterSec: sec });
}

export function mfaDeps(db: Db, config: Config, mailer: Mailer) {
  /** Gera, guarda (só o HMAC) e envia o código, sem esperar o e-mail sair. */
  async function sendEmailCode(req: FastifyRequest, admin: Admin, sessionId: string) {
    const code = newCode();
    const r = await db.query(
      `INSERT INTO email_otps (admin_id, session_id, code_hash, expires_at, ip) VALUES ($1, $2, $3, now() + make_interval(mins => $4), $5) RETURNING id`,
      [admin.id, sessionId, codeHmac(config.authSecret, code), config.otpTtlMin, req.ip],
    );
    // só o mais novo vale: os anteriores desta sessão deixam de valer
    await db.query("UPDATE email_otps SET used_at = now() WHERE session_id = $1 AND id <> $2 AND used_at IS NULL", [sessionId, r.rows[0].id]);
    const msg = otpEmail({ code, ttlMin: config.otpTtlMin, ip: req.ip, browser: browserLabel(req.headers["user-agent"]) });
    await audit(db, req, "mfa_challenge", { adminId: admin.id, details: { method: "email" } });
    // envio assíncrono: a resposta não espera o Resend; falha vai para o log e para a auditoria
    const log = req.log;
    void mailer({ to: admin.email!, ...msg, idempotencyKey: `otp-${r.rows[0].id}` }).catch(async (e) => {
      log.error({ err: (e as Error).message, adminId: admin.id }, "falha ao enviar o código por e-mail");
      await audit(db, req, "otp_send_failed", { adminId: admin.id, details: { error: (e as Error).message.slice(0, 200) } }).catch(() => undefined);
    });
  }

  /**
   * Chamado pelo login depois da senha certa. Devolve null se o 2FA não se aplica (login normal segue), ou a resposta
   * da etapa 2 (sessão "mfa" + métodos).
   */
  async function beginMfa(req: FastifyRequest, admin: Admin, trustToken: string | undefined) {
    if (!config.authRequire2fa) return null;
    if (trustToken) {
      const t = (
        await db.query(
          "UPDATE trusted_devices SET last_used_at = now() WHERE token_hash = $1 AND admin_id = $2 AND expires_at > now() RETURNING id",
          [sha256(trustToken), admin.id],
        )
      ).rows[0];
      if (t) return null; // navegador confiável: pula o segundo fator
    }
    const recoveryLeft = Number((await db.query("SELECT count(*) FROM recovery_codes WHERE admin_id = $1 AND used_at IS NULL", [admin.id])).rows[0].count);
    const hasTotp = !!(await db.query("SELECT 1 FROM admin_totp WHERE admin_id = $1 AND confirmed_at IS NOT NULL", [admin.id])).rowCount;
    const token = newToken();
    const s = (
      await db.query(
        `INSERT INTO sessions (admin_id, token_hash, expires_at, ip, user_agent, stage)
         VALUES ($1, $2, now() + make_interval(mins => $3), $4, $5, 'mfa') RETURNING id, expires_at`,
        [admin.id, sha256(token), MFA_SESSION_MIN, req.ip, (req.headers["user-agent"] ?? "").toString().slice(0, 300) || null],
      )
    ).rows[0];
    let codeSent = false;
    let retryAfterSec = 0;
    // com app autenticador o e-mail não sai sozinho: só se a pessoa pedir ("Receber código por e-mail")
    if (admin.email && !hasTotp) {
      retryAfterSec = await sendBlockedFor(db, admin.id, req.ip);
      if (!retryAfterSec) {
        await sendEmailCode(req, admin, s.id);
        codeSent = true;
      }
    }
    return {
      mfaRequired: true,
      token,
      expiresAt: s.expires_at,
      methods: [...(hasTotp ? ["totp"] : []), ...(admin.email ? ["email"] : []), ...(recoveryLeft ? ["recovery"] : [])],
      emailHint: admin.email ? maskEmail(admin.email) : null,
      codeSent,
      retryAfterSec,
      trustDays: config.trustDays,
    };
  }

  return { beginMfa, sendEmailCode };
}

/** Sessão "mfa" (etapa 2 do login). */
async function partialSession(db: Db, req: FastifyRequest) {
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) return null;
  const r = await db.query(
    `SELECT s.id, s.mfa_attempts, s.ip, s.user_agent, a.id AS admin_id, a.username, a.email
     FROM sessions s JOIN admins a ON a.id = s.admin_id
     WHERE s.token_hash = $1 AND s.stage = 'mfa' AND s.expires_at > now() AND a.disabled_at IS NULL`,
    [sha256(auth.slice(7))],
  );
  return r.rows[0] ?? null;
}

const Verify = z.object({
  method: z.enum(["totp", "email", "recovery"]),
  code: z.string().min(4).max(40),
  trustDevice: z.boolean().optional().default(false),
});

/** Rotas da etapa 2 (fora do escopo de admin: autenticam com a sessão "mfa"). */
export async function mfaPublicRoutes(app: FastifyInstance, opts: { db: Db; config: Config; mailer: Mailer }) {
  const { db, config } = opts;
  const { sendEmailCode } = mfaDeps(db, config, opts.mailer);

  app.post("/v1/auth/mfa/email/send", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (req, reply) => {
    const s = await partialSession(db, req);
    if (!s) return reply.code(401).send({ error: "unauthorized", message: "a etapa de confirmação expirou: entre de novo" });
    if (!s.email) return reply.code(400).send({ error: "no_email", message: "sua conta não tem e-mail cadastrado: peça ao administrador" });
    const wait = await sendBlockedFor(db, s.admin_id, req.ip);
    if (wait) return retry(reply, wait, `Aguarde ${wait < 60 ? `${wait} s` : `${Math.ceil(wait / 60)} min`} para pedir outro código.`);
    await sendEmailCode(req, { id: s.admin_id, username: s.username, email: s.email }, s.id);
    return { ok: true, emailHint: maskEmail(s.email) };
  });

  app.post("/v1/auth/mfa/verify", { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } }, async (req, reply) => {
    const s = await partialSession(db, req);
    if (!s) return reply.code(401).send({ error: "unauthorized", message: "a etapa de confirmação expirou: entre de novo" });
    const body = Verify.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "invalid_body", message: "informe o código" });
    const accountKey = lockKey("account", s.username);
    const blocked = await lockedFor(db, "account", accountKey);
    if (blocked) return retry(reply, blocked, `Muitas tentativas. Tente de novo em ${blocked < 60 ? `${blocked} s` : `${Math.ceil(blocked / 60)} min`}.`);

    const code = normalizeCode(body.data.code);
    let ok = false;
    if (body.data.method === "email") {
      const otp = (
        await db.query(
          "SELECT id, code_hash, attempts FROM email_otps WHERE session_id = $1 AND used_at IS NULL AND expires_at > now() ORDER BY created_at DESC LIMIT 1",
          [s.id],
        )
      ).rows[0];
      if (!otp) return reply.code(400).send({ error: "code_expired", message: "código expirado ou já usado: peça outro" });
      ok = code.length === 8 && hmacEqual(otp.code_hash, codeHmac(config.authSecret, code));
      if (ok) await db.query("UPDATE email_otps SET used_at = now() WHERE id = $1", [otp.id]);
      else {
        // 5 erros no mesmo código: ele deixa de valer
        await db.query("UPDATE email_otps SET attempts = attempts + 1, used_at = CASE WHEN attempts + 1 >= $2 THEN now() ELSE NULL END WHERE id = $1", [
          otp.id,
          MAX_ATTEMPTS_PER_CODE,
        ]);
      }
    } else if (body.data.method === "totp") {
      const t = (await db.query("SELECT secret_enc, last_step FROM admin_totp WHERE admin_id = $1 AND confirmed_at IS NOT NULL", [s.admin_id])).rows[0];
      if (!t) return reply.code(400).send({ error: "no_totp", message: "app autenticador não ativado nesta conta" });
      const step = verifyTotp(decryptSecret(config.authSecret, t.secret_enc), code, t.last_step === null ? null : Number(t.last_step));
      // grava o passo só se ainda for o mais novo (duas conferências simultâneas do mesmo código: só uma passa)
      if (step !== null) {
        const r = await db.query("UPDATE admin_totp SET last_step = $2 WHERE admin_id = $1 AND (last_step IS NULL OR last_step < $2)", [s.admin_id, step]);
        ok = !!r.rowCount;
      }
    } else {
      const hash = codeHmac(config.authSecret, code);
      const r = await db.query("UPDATE recovery_codes SET used_at = now() WHERE admin_id = $1 AND code_hash = $2 AND used_at IS NULL RETURNING id", [s.admin_id, hash]);
      ok = !!r.rowCount;
    }

    if (!ok) {
      const attempts = s.mfa_attempts + 1;
      await db.query("UPDATE sessions SET mfa_attempts = $2 WHERE id = $1", [s.id, attempts]);
      const lockSec = await recordFailure(db, "account", accountKey);
      await audit(db, req, "mfa_failure", { adminId: s.admin_id, details: { method: body.data.method, attempts } });
      if (lockSec) await audit(db, req, "lockout", { adminId: s.admin_id, identifier: s.username, details: { accountSec: lockSec, stage: "mfa" } });
      if (attempts >= MAX_ATTEMPTS_PER_SESSION) {
        await db.query("DELETE FROM sessions WHERE id = $1", [s.id]);
        return reply.code(401).send({ error: "too_many_attempts", message: "muitos códigos errados: entre de novo com a senha" });
      }
      return reply.code(400).send({ error: "invalid_code", message: "código incorreto", attemptsLeft: MAX_ATTEMPTS_PER_SESSION - attempts });
    }

    // conferiu: a sessão "mfa" sai e nasce a sessão normal (token novo)
    await db.query("DELETE FROM sessions WHERE id = $1", [s.id]);
    const token = newToken();
    const expires = new Date(Date.now() + config.sessionTtlHours * 3600_000);
    await db.query("INSERT INTO sessions (admin_id, token_hash, expires_at, ip, user_agent) VALUES ($1, $2, $3, $4, $5)", [
      s.admin_id,
      sha256(token),
      expires,
      req.ip,
      (req.headers["user-agent"] ?? "").toString().slice(0, 300) || null,
    ]);
    let trustToken: string | null = null;
    let trustExpiresAt: Date | null = null;
    if (body.data.trustDevice) {
      trustToken = newToken();
      trustExpiresAt = new Date(Date.now() + config.trustDays * 86_400_000);
      await db.query("INSERT INTO trusted_devices (admin_id, token_hash, ip, user_agent, expires_at) VALUES ($1, $2, $3, $4, $5)", [
        s.admin_id,
        sha256(trustToken),
        req.ip,
        (req.headers["user-agent"] ?? "").toString().slice(0, 300) || null,
        trustExpiresAt,
      ]);
    }
    await audit(db, req, "mfa_success", { adminId: s.admin_id, details: { method: body.data.method, trustDevice: body.data.trustDevice } });
    await audit(db, req, "login_success", { adminId: s.admin_id, identifier: s.username, details: { mfa: body.data.method } });
    return { token, expiresAt: expires.toISOString(), idleHours: config.sessionIdleHours, trustToken, trustExpiresAt };
  });
}

/** Na Conta (sessão normal): códigos de recuperação e navegadores confiáveis. Admin: zerar o 2FA de alguém. */
export async function mfaAccountRoutes(app: FastifyInstance, opts: { db: Db; config: Config }) {
  const { db, config } = opts;

  app.get("/v1/admin/mfa", async (req) => {
    const left = Number((await db.query("SELECT count(*) FROM recovery_codes WHERE admin_id = $1 AND used_at IS NULL", [req.admin!.id])).rows[0].count);
    const devices = await db.query(
      "SELECT id, ip, user_agent, created_at, last_used_at, expires_at FROM trusted_devices WHERE admin_id = $1 AND expires_at > now() ORDER BY last_used_at DESC",
      [req.admin!.id],
    );
    const totp = (await db.query("SELECT confirmed_at FROM admin_totp WHERE admin_id = $1 AND confirmed_at IS NOT NULL", [req.admin!.id])).rows[0];
    return {
      required: config.authRequire2fa,
      email: req.admin!.email,
      totp: { enabled: !!totp, since: totp?.confirmed_at ?? null },
      recoveryCodesLeft: left,
      trustDays: config.trustDays,
      trustedDevices: devices.rows.map((d) => ({ id: d.id, ip: d.ip, userAgent: d.user_agent, createdAt: d.created_at, lastUsedAt: d.last_used_at, expiresAt: d.expires_at })),
    };
  });

  /** Gera 10 códigos novos (os anteriores deixam de valer). Mostrados uma única vez. */
  app.post("/v1/admin/mfa/recovery-codes", async (req) => {
    const codes = Array.from({ length: RECOVERY_CODES }, () => newCode());
    await db.query("DELETE FROM recovery_codes WHERE admin_id = $1", [req.admin!.id]);
    for (const c of codes) await db.query("INSERT INTO recovery_codes (admin_id, code_hash) VALUES ($1, $2)", [req.admin!.id, codeHmac(config.authSecret, c)]);
    await audit(db, req, "recovery_codes_generated", { adminId: req.admin!.id, details: { count: RECOVERY_CODES } });
    return { codes: codes.map(formatCode) };
  });

  app.delete("/v1/admin/mfa/trusted-devices/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!z.uuid().safeParse(id).success) return reply.code(404).send({ error: "not_found" });
    const r = await db.query("DELETE FROM trusted_devices WHERE id = $1 AND admin_id = $2", [id, req.admin!.id]);
    if (!r.rowCount) return reply.code(404).send({ error: "not_found" });
    await audit(db, req, "trusted_device_revoked", { adminId: req.admin!.id, details: { deviceId: id } });
    return { ok: true };
  });

  /** Confere a senha atual (ativar/desativar o app). Erro conta no bloqueio da conta, como no login. */
  async function checkPassword(req: FastifyRequest, reply: FastifyReply, password: unknown): Promise<boolean> {
    const key = lockKey("account", req.admin!.username);
    const blocked = await lockedFor(db, "account", key);
    if (blocked) {
      retry(reply, blocked, `Muitas tentativas. Tente de novo em ${blocked < 60 ? `${blocked} s` : `${Math.ceil(blocked / 60)} min`}.`);
      return false;
    }
    const row = (await db.query("SELECT password_hash FROM admins WHERE id = $1", [req.admin!.id])).rows[0];
    if (typeof password === "string" && password && row && (await verifyPassword(password, row.password_hash))) return true;
    await recordFailure(db, "account", key);
    await audit(db, req, "password_check_failed", { adminId: req.admin!.id });
    reply.code(400).send({ error: "invalid_password", message: "senha atual incorreta" });
    return false;
  }

  /** Ativar o app, passo 1: senha atual → chave nova (QR Code). Só vale depois de confirmada com um código. */
  app.post("/v1/admin/mfa/totp/setup", async (req, reply) => {
    const { password } = (req.body ?? {}) as { password?: unknown };
    if (!(await checkPassword(req, reply, password))) return reply;
    if ((await db.query("SELECT 1 FROM admin_totp WHERE admin_id = $1 AND confirmed_at IS NOT NULL", [req.admin!.id])).rowCount)
      return reply.code(409).send({ error: "already_enabled", message: "o app autenticador já está ativo: desative antes de trocar" });
    const secret = newTotpSecret();
    await db.query(
      `INSERT INTO admin_totp (admin_id, secret_enc) VALUES ($1, $2)
       ON CONFLICT (admin_id) DO UPDATE SET secret_enc = EXCLUDED.secret_enc, confirmed_at = NULL, last_step = NULL, created_at = now()`,
      [req.admin!.id, encryptSecret(config.authSecret, secret)],
    );
    return { secret, uri: otpauthUri(secret, req.admin!.email ?? req.admin!.username) };
  });

  /** Ativar o app, passo 2: o primeiro código do app confirma que a chave foi lida. */
  app.post("/v1/admin/mfa/totp/confirm", async (req, reply) => {
    const { code } = (req.body ?? {}) as { code?: unknown };
    const t = (
      await db.query("SELECT secret_enc FROM admin_totp WHERE admin_id = $1 AND confirmed_at IS NULL AND created_at > now() - interval '30 minutes'", [
        req.admin!.id,
      ])
    ).rows[0];
    if (!t) return reply.code(400).send({ error: "no_setup", message: "comece a ativação de novo" });
    const step = typeof code === "string" ? verifyTotp(decryptSecret(config.authSecret, t.secret_enc), code, null) : null;
    if (step === null) return reply.code(400).send({ error: "invalid_code", message: "código incorreto: confira o relógio do celular e digite o código atual" });
    await db.query("UPDATE admin_totp SET confirmed_at = now(), last_step = $2 WHERE admin_id = $1", [req.admin!.id, step]);
    await audit(db, req, "totp_enabled", { adminId: req.admin!.id });
    return { ok: true };
  });

  app.post("/v1/admin/mfa/totp/disable", async (req, reply) => {
    const { password } = (req.body ?? {}) as { password?: unknown };
    if (!(await checkPassword(req, reply, password))) return reply;
    const r = await db.query("DELETE FROM admin_totp WHERE admin_id = $1", [req.admin!.id]);
    if (r.rowCount) await audit(db, req, "totp_disabled", { adminId: req.admin!.id });
    return { ok: true };
  });

  /** Admin: zera o 2FA de alguém (perdeu o acesso): códigos de recuperação, navegadores confiáveis e sessões. */
  app.post("/v1/admin/users/:id/reset-mfa", async (req, reply) => {
    if (req.admin!.role !== "admin") return reply.code(403).send({ error: "forbidden", message: "só administradores" });
    const { id } = req.params as { id: string };
    if (!z.uuid().safeParse(id).success) return reply.code(404).send({ error: "not_found" });
    if (!(await db.query("SELECT 1 FROM admins WHERE id = $1", [id])).rowCount) return reply.code(404).send({ error: "not_found" });
    await db.query("DELETE FROM recovery_codes WHERE admin_id = $1", [id]);
    await db.query("DELETE FROM trusted_devices WHERE admin_id = $1", [id]);
    await db.query("DELETE FROM admin_totp WHERE admin_id = $1", [id]);
    if (id !== req.admin!.id) await db.query("DELETE FROM sessions WHERE admin_id = $1", [id]);
    await audit(db, req, "mfa_reset", { adminId: req.admin!.id, details: { userId: id } });
    return { ok: true };
  });
}

/** Troca de senha: navegadores confiáveis deixam de valer (quem tinha a senha antiga não pula o 2FA). */
export async function revokeTrust(db: Db, adminId: string) {
  await db.query("DELETE FROM trusted_devices WHERE admin_id = $1", [adminId]);
}
