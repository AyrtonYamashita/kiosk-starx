import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type RegistrationResponseJSON,
} from "@simplewebauthn/server";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { audit, lockedFor, lockKey, recordFailure } from "../auth.js";
import type { Config } from "../config.js";
import type { Db } from "../db.js";
import { checkCurrentPassword, completeMfa, issueSession, partialSession } from "./mfa.js";

/**
 * Passkeys (1.3c): biometria/PIN do aparelho (Windows Hello, Touch ID, Android, chave de segurança).
 *
 * - Login sem senha: "Entrar com passkey" — a passkey já é 2 fatores (aparelho + biometria/PIN) e não cai em phishing.
 * - Etapa 2 do login: mais uma opção para quem entrou com a senha.
 * Sempre com verificação do usuário (biometria/PIN), desafio de uso único (5 min), origem e domínio conferidos.
 */
const CHALLENGE_MIN = 5;
const MAX_PASSKEYS = 10;

type Purpose = "register" | "login" | "mfa";

function retry(reply: FastifyReply, sec: number) {
  reply.header("retry-after", String(sec));
  return reply
    .code(429)
    .send({ error: "too_many_requests", message: `Muitas tentativas. Tente de novo em ${sec < 60 ? `${sec} s` : `${Math.ceil(sec / 60)} min`}.`, retryAfterSec: sec });
}

async function saveChallenge(db: Db, req: FastifyRequest, purpose: Purpose, challenge: string, ids: { adminId?: string; sessionId?: string } = {}) {
  await db.query("DELETE FROM webauthn_challenges WHERE expires_at < now()");
  const r = await db.query(
    `INSERT INTO webauthn_challenges (purpose, admin_id, session_id, challenge, ip, expires_at)
     VALUES ($1, $2, $3, $4, $5, now() + make_interval(mins => $6)) RETURNING id`,
    [purpose, ids.adminId ?? null, ids.sessionId ?? null, challenge, req.ip, CHALLENGE_MIN],
  );
  return r.rows[0].id as string;
}

/** Consome o desafio (uso único: some na hora, deu certo ou não). */
async function takeChallenge(db: Db, id: unknown, purpose: Purpose, ids: { adminId?: string; sessionId?: string } = {}) {
  if (typeof id !== "string" || !z.uuid().safeParse(id).success) return null;
  const r = await db.query(
    `DELETE FROM webauthn_challenges WHERE id = $1 AND purpose = $2 AND expires_at > now()
       AND ($3::uuid IS NULL OR admin_id = $3) AND ($4::uuid IS NULL OR session_id = $4)
     RETURNING challenge`,
    [id, purpose, ids.adminId ?? null, ids.sessionId ?? null],
  );
  return (r.rows[0]?.challenge as string | undefined) ?? null;
}

/**
 * Confere uma assinatura de passkey (login sem senha ou etapa 2). Devolve o admin ou um erro. `onlyAdmin`: na etapa 2 a
 * passkey precisa ser da pessoa que digitou a senha.
 */
async function verifyAssertion(db: Db, config: Config, challenge: string, response: AuthenticationResponseJSON, onlyAdmin?: string) {
  const cred = (
    await db.query(
      `SELECT c.id, c.admin_id, c.credential_id, c.public_key, c.counter, c.transports, a.username, a.disabled_at
       FROM webauthn_credentials c JOIN admins a ON a.id = c.admin_id WHERE c.credential_id = $1`,
      [String(response?.id ?? "")],
    )
  ).rows[0];
  if (!cred || cred.disabled_at || (onlyAdmin && cred.admin_id !== onlyAdmin)) return { error: "unknown_credential" as const, cred };
  try {
    const v = await verifyAuthenticationResponse({
      response,
      expectedChallenge: challenge,
      expectedOrigin: config.webauthnOrigins,
      expectedRPID: config.webauthnRpId,
      credential: { id: cred.credential_id, publicKey: new Uint8Array(cred.public_key), counter: Number(cred.counter), transports: cred.transports ?? undefined },
      requireUserVerification: true,
    });
    if (!v.verified) return { error: "not_verified" as const, cred };
    // contador só anda para a frente (a biblioteca já recusa se voltar); grava com a mesma condição
    const u = await db.query(
      "UPDATE webauthn_credentials SET counter = $2, last_used_at = now() WHERE id = $1 AND (counter < $2 OR ($2 = 0 AND counter = 0)) RETURNING id",
      [cred.id, v.authenticationInfo.newCounter],
    );
    if (!u.rowCount) return { error: "counter" as const, cred };
    return { cred };
  } catch (e) {
    return { error: "invalid" as const, cred, detail: (e as Error).message.slice(0, 200) };
  }
}

/** Rotas sem sessão normal: login com passkey e etapa 2. */
export async function passkeyPublicRoutes(app: FastifyInstance, opts: { db: Db; config: Config }) {
  const { db, config } = opts;

  app.post("/v1/auth/passkey/options", { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } }, async (req, reply) => {
    const ipBlocked = await lockedFor(db, "ip", lockKey("ip", req.ip));
    if (ipBlocked) return retry(reply, ipBlocked);
    // sem lista de credenciais: o navegador oferece as passkeys deste site (não revela contas)
    const options = await generateAuthenticationOptions({ rpID: config.webauthnRpId, userVerification: "required", timeout: CHALLENGE_MIN * 60_000 });
    const challengeId = await saveChallenge(db, req, "login", options.challenge);
    return { challengeId, options };
  });

  app.post("/v1/auth/passkey/verify", { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } }, async (req, reply) => {
    const ipKey = lockKey("ip", req.ip);
    const ipBlocked = await lockedFor(db, "ip", ipKey);
    if (ipBlocked) return retry(reply, ipBlocked);
    const { challengeId, response } = (req.body ?? {}) as { challengeId?: unknown; response?: AuthenticationResponseJSON };
    const challenge = await takeChallenge(db, challengeId, "login");
    if (!challenge) return reply.code(400).send({ error: "challenge_expired", message: "a confirmação expirou: tente de novo" });
    const r = await verifyAssertion(db, config, challenge, response as AuthenticationResponseJSON);
    if (r.error) {
      await recordFailure(db, "ip", ipKey);
      await audit(db, req, "passkey_failure", { adminId: r.cred?.admin_id, details: { reason: r.error, ...(r.detail ? { detail: r.detail } : {}) } });
      return reply.code(401).send({ error: "passkey_failed", message: "não foi possível entrar com esta passkey" });
    }
    const session = await issueSession(db, config, req, r.cred.admin_id);
    await audit(db, req, "login_success", { adminId: r.cred.admin_id, identifier: r.cred.username, details: { method: "passkey" } });
    return session;
  });

  // etapa 2 (depois da senha): passkeys desta pessoa
  app.post("/v1/auth/mfa/passkey/options", { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } }, async (req, reply) => {
    const s = await partialSession(db, req);
    if (!s) return reply.code(401).send({ error: "unauthorized", message: "a etapa de confirmação expirou: entre de novo" });
    const creds = (await db.query("SELECT credential_id, transports FROM webauthn_credentials WHERE admin_id = $1", [s.admin_id])).rows;
    if (!creds.length) return reply.code(400).send({ error: "no_passkey", message: "nenhuma passkey nesta conta" });
    const options = await generateAuthenticationOptions({
      rpID: config.webauthnRpId,
      userVerification: "required",
      timeout: CHALLENGE_MIN * 60_000,
      allowCredentials: creds.map((c) => ({ id: c.credential_id, transports: c.transports ?? undefined })),
    });
    const challengeId = await saveChallenge(db, req, "mfa", options.challenge, { adminId: s.admin_id, sessionId: s.id });
    return { challengeId, options };
  });

  app.post("/v1/auth/mfa/passkey/verify", { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } }, async (req, reply) => {
    const s = await partialSession(db, req);
    if (!s) return reply.code(401).send({ error: "unauthorized", message: "a etapa de confirmação expirou: entre de novo" });
    const accountKey = lockKey("account", s.username);
    const blocked = await lockedFor(db, "account", accountKey);
    if (blocked) return retry(reply, blocked);
    const { challengeId, response, trustDevice } = (req.body ?? {}) as { challengeId?: unknown; response?: AuthenticationResponseJSON; trustDevice?: unknown };
    const challenge = await takeChallenge(db, challengeId, "mfa", { adminId: s.admin_id, sessionId: s.id });
    if (!challenge) return reply.code(400).send({ error: "challenge_expired", message: "a confirmação expirou: tente de novo" });
    const r = await verifyAssertion(db, config, challenge, response as AuthenticationResponseJSON, s.admin_id);
    if (r.error) {
      await recordFailure(db, "account", accountKey);
      await audit(db, req, "mfa_failure", { adminId: s.admin_id, details: { method: "passkey", reason: r.error } });
      return reply.code(400).send({ error: "passkey_failed", message: "passkey não confirmada" });
    }
    return completeMfa(db, config, req, s, "passkey", trustDevice === true);
  });
}

const Name = z.string().trim().min(1).max(60);

/** Na Conta: cadastrar (com a senha atual), listar e remover passkeys. */
export async function passkeyAccountRoutes(app: FastifyInstance, opts: { db: Db; config: Config }) {
  const { db, config } = opts;

  app.post("/v1/admin/passkeys/register/options", async (req, reply) => {
    const { password } = (req.body ?? {}) as { password?: unknown };
    if (!(await checkCurrentPassword(db, req, reply, password))) return reply;
    const existing = (await db.query("SELECT credential_id, transports FROM webauthn_credentials WHERE admin_id = $1", [req.admin!.id])).rows;
    if (existing.length >= MAX_PASSKEYS) return reply.code(400).send({ error: "too_many", message: `limite de ${MAX_PASSKEYS} passkeys por conta` });
    const options = await generateRegistrationOptions({
      rpName: "StarX Kiosk",
      rpID: config.webauthnRpId,
      userName: req.admin!.email ?? req.admin!.username,
      userDisplayName: req.admin!.username,
      // identificador fixo da pessoa (o id da conta) — o aparelho substitui a passkey antiga do mesmo usuário
      userID: new Uint8Array(Buffer.from(req.admin!.id.replace(/-/g, ""), "hex")),
      attestationType: "none",
      timeout: CHALLENGE_MIN * 60_000,
      excludeCredentials: existing.map((c) => ({ id: c.credential_id, transports: c.transports ?? undefined })),
      // "required": a passkey fica no aparelho/conta (necessário para o login sem digitar usuário)
      authenticatorSelection: { residentKey: "required", userVerification: "required" },
    });
    const challengeId = await saveChallenge(db, req, "register", options.challenge, { adminId: req.admin!.id });
    return { challengeId, options };
  });

  app.post("/v1/admin/passkeys/register/verify", async (req, reply) => {
    const { challengeId, response, name } = (req.body ?? {}) as { challengeId?: unknown; response?: RegistrationResponseJSON; name?: unknown };
    const label = Name.safeParse(name ?? "Passkey");
    if (!label.success) return reply.code(400).send({ error: "invalid_name", message: "dê um nome de até 60 caracteres" });
    const challenge = await takeChallenge(db, challengeId, "register", { adminId: req.admin!.id });
    if (!challenge) return reply.code(400).send({ error: "challenge_expired", message: "o cadastro expirou: comece de novo" });
    let v: Awaited<ReturnType<typeof verifyRegistrationResponse>>;
    try {
      v = await verifyRegistrationResponse({
        response: response as RegistrationResponseJSON,
        expectedChallenge: challenge,
        expectedOrigin: config.webauthnOrigins,
        expectedRPID: config.webauthnRpId,
        requireUserVerification: true,
      });
    } catch (e) {
      await audit(db, req, "passkey_register_failed", { adminId: req.admin!.id, details: { detail: (e as Error).message.slice(0, 200) } });
      return reply.code(400).send({ error: "invalid_response", message: "não foi possível confirmar a passkey" });
    }
    if (!v.verified) return reply.code(400).send({ error: "invalid_response", message: "não foi possível confirmar a passkey" });
    const info = v.registrationInfo;
    const r = await db.query(
      `INSERT INTO webauthn_credentials (admin_id, credential_id, public_key, counter, transports, device_type, backed_up, name)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (credential_id) DO NOTHING RETURNING id`,
      [
        req.admin!.id,
        info.credential.id,
        Buffer.from(info.credential.publicKey),
        info.credential.counter,
        info.credential.transports ?? null,
        info.credentialDeviceType,
        info.credentialBackedUp,
        label.data,
      ],
    );
    if (!r.rowCount) return reply.code(409).send({ error: "already_registered", message: "esta passkey já está cadastrada" });
    await audit(db, req, "passkey_registered", { adminId: req.admin!.id, details: { passkeyId: r.rows[0].id, name: label.data, synced: info.credentialBackedUp } });
    return { ok: true, id: r.rows[0].id };
  });

  app.delete("/v1/admin/passkeys/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!z.uuid().safeParse(id).success) return reply.code(404).send({ error: "not_found" });
    const r = await db.query("DELETE FROM webauthn_credentials WHERE id = $1 AND admin_id = $2 RETURNING name", [id, req.admin!.id]);
    if (!r.rowCount) return reply.code(404).send({ error: "not_found" });
    await audit(db, req, "passkey_removed", { adminId: req.admin!.id, details: { passkeyId: id, name: r.rows[0].name } });
    return { ok: true };
  });
}
