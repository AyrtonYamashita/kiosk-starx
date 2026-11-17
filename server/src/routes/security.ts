import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { audit, clearLock, type LockKind } from "../auth.js";
import type { Config } from "../config.js";
import { hashPassword } from "../crypto.js";
import type { Db } from "../db.js";

/** Só o papel admin: usuários, desbloqueios, auditoria e sessões dos outros. */
async function requireRoleAdmin(req: FastifyRequest, reply: FastifyReply) {
  if (req.admin?.role !== "admin") return reply.code(403).send({ error: "forbidden", message: "só administradores" });
}

const Username = z.string().trim().min(3).max(64).regex(/^[a-zA-Z0-9._-]+$/, "usuário: letras, números, ponto, hífen e sublinhado");
const Email = z.string().trim().toLowerCase().email().max(200);
const Password = z.string().min(10, "a senha precisa ter pelo menos 10 caracteres").max(256);
const Role = z.enum(["admin", "operator"]);

const CreateUser = z.object({ username: Username, email: Email, role: Role, password: Password });
const UpdateUser = z
  .object({ email: Email.optional(), role: Role.optional(), disabled: z.boolean().optional(), password: Password.optional() })
  .refine((v) => Object.keys(v).length > 0, "nada para alterar");
const Unlock = z.object({ kind: z.enum(["ip", "account"]), key: z.string().min(1).max(200) });

function userJson(u: Record<string, any>) {
  return {
    id: u.id,
    username: u.username,
    email: u.email,
    role: u.role,
    disabled: !!u.disabled_at,
    createdAt: u.created_at,
    passwordChangedAt: u.password_changed_at,
    lastLoginAt: u.last_login_at ?? null,
    activeSessions: Number(u.active_sessions ?? 0),
    lockedUntil: u.locked_until ?? null,
  };
}

function firstIssue(e: z.ZodError) {
  return e.issues[0]?.message ?? "dados inválidos";
}

export async function securityRoutes(app: FastifyInstance, opts: { db: Db; config: Config }) {
  const { db, config } = opts;
  const liveSession = `s.expires_at > now() AND s.last_used_at > now() - make_interval(hours => ${Number(config.sessionIdleHours)})`;

  // ---------------------------------------------------------------- sessões ativas

  /** As minhas sessões; admin com ?all=1 vê as de todos. */
  app.get("/v1/admin/sessions", async (req) => {
    const all = (req.query as { all?: string }).all === "1" && req.admin!.role === "admin";
    const r = await db.query(
      `SELECT s.id, s.created_at, s.last_used_at, s.expires_at, s.ip, s.user_agent, a.username
       FROM sessions s JOIN admins a ON a.id = s.admin_id
       WHERE ${liveSession} ${all ? "" : "AND s.admin_id = $1"}
       ORDER BY s.last_used_at DESC`,
      all ? [] : [req.admin!.id],
    );
    return {
      idleHours: config.sessionIdleHours,
      sessions: r.rows.map((s) => ({
        id: s.id,
        username: s.username,
        createdAt: s.created_at,
        lastUsedAt: s.last_used_at,
        expiresAt: s.expires_at,
        ip: s.ip,
        userAgent: s.user_agent,
        current: s.id === req.admin!.sessionId,
      })),
    };
  });

  /** Encerra uma sessão (a própria, ou qualquer uma se admin). Vale na hora: o token deixa de existir. */
  app.delete("/v1/admin/sessions/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!z.uuid().safeParse(id).success) return reply.code(404).send({ error: "not_found" });
    const r =
      req.admin!.role === "admin"
        ? await db.query("DELETE FROM sessions WHERE id = $1 RETURNING admin_id", [id])
        : await db.query("DELETE FROM sessions WHERE id = $1 AND admin_id = $2 RETURNING admin_id", [id, req.admin!.id]);
    if (!r.rowCount) return reply.code(404).send({ error: "not_found" });
    await audit(db, req, "session_revoked", { adminId: req.admin!.id, details: { sessionId: id, owner: r.rows[0].admin_id } });
    return { ok: true };
  });

  // ---------------------------------------------------------------- só admin
  app.register(async (adm) => {
    adm.addHook("preHandler", requireRoleAdmin);

    adm.get("/v1/admin/users", async () => {
      const r = await db.query(
        `SELECT a.*,
                (SELECT count(*) FROM sessions s WHERE s.admin_id = a.id AND ${liveSession}) AS active_sessions,
                (SELECT max(created_at) FROM auth_events e WHERE e.admin_id = a.id AND e.event = 'login_success') AS last_login_at,
                (SELECT l.locked_until FROM auth_lockouts l WHERE l.kind = 'account' AND l.locked_until > now()
                   AND (l.key = lower(a.username) OR l.key = lower(a.email)) ORDER BY l.locked_until DESC LIMIT 1) AS locked_until
         FROM admins a ORDER BY a.disabled_at IS NOT NULL, lower(a.username)`,
      );
      return { users: r.rows.map(userJson) };
    });

    adm.post("/v1/admin/users", async (req, reply) => {
      const body = CreateUser.safeParse(req.body);
      if (!body.success) return reply.code(400).send({ error: "invalid_body", message: firstIssue(body.error) });
      try {
        const r = await db.query(
          "INSERT INTO admins (username, email, role, password_hash, password_changed_at) VALUES ($1, $2, $3, $4, now()) RETURNING *",
          [body.data.username, body.data.email, body.data.role, await hashPassword(body.data.password)],
        );
        await audit(db, req, "user_created", { adminId: req.admin!.id, details: { userId: r.rows[0].id, username: body.data.username, role: body.data.role } });
        return userJson(r.rows[0]);
      } catch (e) {
        if ((e as { code?: string }).code === "23505") return reply.code(409).send({ error: "duplicate", message: "já existe um usuário com esse nome ou e-mail" });
        throw e;
      }
    });

    adm.patch("/v1/admin/users/:id", async (req, reply) => {
      const { id } = req.params as { id: string };
      if (!z.uuid().safeParse(id).success) return reply.code(404).send({ error: "not_found" });
      const body = UpdateUser.safeParse(req.body);
      if (!body.success) return reply.code(400).send({ error: "invalid_body", message: firstIssue(body.error) });
      const b = body.data;
      const self = id === req.admin!.id;
      if (self && (b.disabled === true || b.role === "operator")) {
        return reply.code(400).send({ error: "self", message: "você não pode desativar nem rebaixar a própria conta" });
      }
      const cur = (await db.query("SELECT * FROM admins WHERE id = $1", [id])).rows[0];
      if (!cur) return reply.code(404).send({ error: "not_found" });
      // sempre sobra ao menos um admin ativo
      if ((b.role === "operator" || b.disabled === true) && cur.role === "admin" && !cur.disabled_at) {
        const admins = Number((await db.query("SELECT count(*) FROM admins WHERE role = 'admin' AND disabled_at IS NULL")).rows[0].count);
        if (admins <= 1) return reply.code(400).send({ error: "last_admin", message: "precisa sobrar pelo menos um administrador ativo" });
      }
      try {
        const r = await db.query(
          `UPDATE admins SET email = COALESCE($2, email), role = COALESCE($3, role),
             disabled_at = CASE WHEN $4::boolean IS NULL THEN disabled_at WHEN $4 THEN COALESCE(disabled_at, now()) ELSE NULL END,
             password_hash = COALESCE($5, password_hash),
             password_changed_at = CASE WHEN $5::text IS NULL THEN password_changed_at ELSE now() END
           WHERE id = $1 RETURNING *`,
          [id, b.email ?? null, b.role ?? null, b.disabled ?? null, b.password ? await hashPassword(b.password) : null],
        );
        // desativar, trocar papel ou senha: a pessoa precisa entrar de novo
        if (b.disabled === true || b.role || b.password) await db.query("DELETE FROM sessions WHERE admin_id = $1", [id]);
        const changes = Object.keys(b).map((k) => (k === "password" ? "password_reset" : k));
        await audit(db, req, "user_updated", { adminId: req.admin!.id, details: { userId: id, changes } });
        return userJson(r.rows[0]);
      } catch (e) {
        if ((e as { code?: string }).code === "23505") return reply.code(409).send({ error: "duplicate", message: "esse e-mail já é de outro usuário" });
        throw e;
      }
    });

    /** Bloqueios ativos (IP e conta). */
    adm.get("/v1/admin/security/lockouts", async () => {
      const r = await db.query("SELECT kind, key, level, locked_until FROM auth_lockouts WHERE locked_until > now() ORDER BY locked_until DESC");
      return { lockouts: r.rows.map((l) => ({ kind: l.kind, key: l.key, level: l.level, lockedUntil: l.locked_until })) };
    });

    /** Desbloqueio manual. */
    adm.post("/v1/admin/security/unlock", async (req, reply) => {
      const body = Unlock.safeParse(req.body);
      if (!body.success) return reply.code(400).send({ error: "invalid_body" });
      await clearLock(db, body.data.kind as LockKind, body.data.key);
      await audit(db, req, "unlock", { adminId: req.admin!.id, identifier: body.data.kind === "account" ? body.data.key : null, details: body.data });
      return { ok: true };
    });

    /** Auditoria: últimos eventos (filtro opcional por usuário). */
    adm.get("/v1/admin/security/events", async (req) => {
      const q = req.query as { userId?: string; limit?: string };
      const limit = Math.min(Math.max(Number(q.limit) || 100, 1), 500);
      const byUser = q.userId && z.uuid().safeParse(q.userId).success ? q.userId : null;
      const r = await db.query(
        `SELECT e.id, e.event, e.identifier, e.ip, e.user_agent, e.details, e.created_at, a.username
         FROM auth_events e LEFT JOIN admins a ON a.id = e.admin_id
         ${byUser ? "WHERE e.admin_id = $2" : ""}
         ORDER BY e.created_at DESC LIMIT $1`,
        byUser ? [limit, byUser] : [limit],
      );
      return {
        events: r.rows.map((e) => ({
          id: Number(e.id),
          event: e.event,
          username: e.username,
          identifier: e.identifier,
          ip: e.ip,
          userAgent: e.user_agent,
          details: e.details,
          createdAt: e.created_at,
        })),
      };
    });
  });
}
