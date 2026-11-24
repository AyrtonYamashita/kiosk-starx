import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { audit } from "../auth.js";
import type { Config } from "../config.js";
import { hashPassword } from "../crypto.js";
import { asSystem, type Db } from "../db.js";
import { requirePlatform } from "../tenant.js";
import { onlineWindowSec } from "./admin.js";
import { DisplayName } from "./security.js";

const Slug = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9][a-z0-9-]{1,39}$/, "apelido: 2 a 40 letras minúsculas, números ou hífen");
const TenantName = z.string().trim().min(2).max(80);
const CreateTenant = z.object({
  name: TenantName,
  slug: Slug,
  // primeiro administrador da empresa (a senha inicial vai por um canal seguro; ele troca em Conta)
  admin: z.object({
    username: z.string().trim().min(3).max(64).regex(/^[a-zA-Z0-9._-]+$/, "usuário: letras, números, ponto, hífen e sublinhado"),
    displayName: DisplayName.optional(),
    email: z.string().trim().toLowerCase().email().max(200),
    password: z.string().min(10, "a senha precisa ter pelo menos 10 caracteres").max(256),
  }),
});
const UpdateTenant = z
  .object({ name: TenantName.optional(), status: z.enum(["active", "suspended"]).optional() })
  .refine((v) => v.name !== undefined || v.status !== undefined, "nada para alterar");

const firstIssue = (e: z.ZodError) => e.issues[0]?.message ?? "dados inválidos";

/**
 * Painel da plataforma (PStarX), fase 3.4: empresas (criar com o primeiro admin, renomear, suspender) e "entrar como"
 * (suporte), com registro na auditoria da plataforma e na da empresa. Escopo da conta, só para usuários da
 * plataforma. As consultas cruzam empresas: rodam como sistema.
 */
export async function platformRoutes(app: FastifyInstance, opts: { db: Db; config: Config }) {
  const { db, config } = opts;

  app.register(async (p) => {
    p.addHook("preHandler", requirePlatform);

    p.get("/v1/platform/tenants", async () => {
      const r = await asSystem(() =>
        db.query(
          `SELECT t.id, t.name, t.slug, t.status, t.created_at,
                  (SELECT count(*)::int FROM devices d WHERE d.tenant_id = t.id AND d.transferred_at IS NULL) AS devices,
                  (SELECT count(*)::int FROM devices d WHERE d.tenant_id = t.id AND d.transferred_at IS NULL
                      AND d.last_seen_at > now() - make_interval(secs => $1)) AS online,
                  (SELECT count(*)::int FROM admins a WHERE a.tenant_id = t.id AND a.disabled_at IS NULL) AS users,
                  (SELECT max(d.last_seen_at) FROM devices d WHERE d.tenant_id = t.id) AS last_seen_at
           FROM tenants t ORDER BY lower(t.name)`,
          [onlineWindowSec(config)],
        ),
      );
      return {
        tenants: r.rows.map((t) => ({
          id: t.id,
          name: t.name,
          slug: t.slug,
          status: t.status,
          createdAt: t.created_at,
          devices: t.devices,
          online: t.online,
          users: t.users,
          lastSeenAt: t.last_seen_at,
        })),
      };
    });

    /** Empresa nova com o primeiro administrador (tudo ou nada). */
    p.post("/v1/platform/tenants", async (req, reply) => {
      const body = CreateTenant.safeParse(req.body);
      if (!body.success) return reply.code(400).send({ error: "invalid_body", message: firstIssue(body.error) });
      const b = body.data;
      const hash = await hashPassword(b.admin.password);
      const c = await asSystem(() => db.connect());
      try {
        await c.query("BEGIN");
        const t = (await c.query("INSERT INTO tenants (name, slug) VALUES ($1, $2) RETURNING id, name, slug, status, created_at", [b.name, b.slug])).rows[0];
        const a = (
          await c.query(
            `INSERT INTO admins (tenant_id, username, display_name, email, role, password_hash, password_changed_at)
             VALUES ($1, $2, $3, $4, 'admin', $5, now()) RETURNING id`,
            [t.id, b.admin.username, b.admin.displayName ?? null, b.admin.email, hash],
          )
        ).rows[0];
        await c.query("COMMIT");
        await audit(db, req, "tenant_created", { adminId: req.admin!.id, tenantId: null, details: { tenantId: t.id, name: t.name, slug: t.slug, firstAdmin: b.admin.username } });
        await audit(db, req, "user_created", { adminId: req.admin!.id, tenantId: t.id, details: { userId: a.id, username: b.admin.username, role: "admin", by: "plataforma" } });
        return { id: t.id, name: t.name, slug: t.slug, status: t.status, createdAt: t.created_at, devices: 0, online: 0, users: 1, lastSeenAt: null };
      } catch (e) {
        await c.query("ROLLBACK").catch(() => undefined);
        if ((e as { code?: string }).code === "23505") {
          const detail = String((e as { constraint?: string }).constraint ?? "");
          const message = detail.includes("slug") ? "já existe uma empresa com esse apelido" : "esse e-mail já é de outro usuário";
          return reply.code(409).send({ error: "duplicate", message });
        }
        throw e;
      } finally {
        c.release();
      }
    });

    /** Renomear e suspender/reativar. Suspender encerra as sessões dos usuários da empresa. */
    p.patch("/v1/platform/tenants/:id", async (req, reply) => {
      const { id } = req.params as { id: string };
      const body = UpdateTenant.safeParse(req.body);
      if (!z.uuid().safeParse(id).success) return reply.code(404).send({ error: "not_found" });
      if (!body.success) return reply.code(400).send({ error: "invalid_body", message: firstIssue(body.error) });
      const r = await db.query(
        "UPDATE tenants SET name = COALESCE($2, name), status = COALESCE($3, status) WHERE id = $1 RETURNING id, name, slug, status",
        [id, body.data.name ?? null, body.data.status ?? null],
      );
      if (!r.rowCount) return reply.code(404).send({ error: "not_found" });
      if (body.data.status === "suspended") {
        await db.query("DELETE FROM sessions s USING admins a WHERE a.id = s.admin_id AND a.tenant_id = $1", [id]);
      }
      const event = body.data.status === "suspended" ? "tenant_suspended" : body.data.status === "active" ? "tenant_reactivated" : "tenant_updated";
      for (const tenantId of [null, id]) await audit(db, req, event, { adminId: req.admin!.id, tenantId, details: { tenantId: id, ...body.data } });
      return r.rows[0];
    });

    /**
     * "Entrar como" (suporte): esta sessão passa a ver a empresa como um administrador dela, até sair. Fica na
     * auditoria da plataforma e na da empresa; o painel mostra uma faixa enquanto durar.
     */
    p.post("/v1/platform/tenants/:id/enter", async (req, reply) => {
      const { id } = req.params as { id: string };
      if (!z.uuid().safeParse(id).success) return reply.code(404).send({ error: "not_found" });
      const t = (await db.query("SELECT id, name, slug FROM tenants WHERE id = $1", [id])).rows[0];
      if (!t) return reply.code(404).send({ error: "not_found" });
      await db.query("UPDATE sessions SET acting_tenant_id = $2 WHERE id = $1", [req.admin!.sessionId, id]);
      for (const tenantId of [null, id]) await audit(db, req, "tenant_enter", { adminId: req.admin!.id, tenantId, details: { tenantId: id, name: t.name } });
      return { ok: true, tenant: t };
    });

    p.post("/v1/platform/exit", async (req) => {
      const was = req.admin!.tenantId;
      await db.query("UPDATE sessions SET acting_tenant_id = NULL WHERE id = $1", [req.admin!.sessionId]);
      if (was) for (const tenantId of [null, was]) await audit(db, req, "tenant_exit", { adminId: req.admin!.id, tenantId, details: { tenantId: was } });
      return { ok: true };
    });

    /** Trilha da plataforma: eventos sem empresa (ações da plataforma, contas inexistentes, login sem senha). */
    p.get("/v1/platform/events", async (req) => {
      const limit = Math.min(Math.max(Number((req.query as { limit?: string }).limit) || 100, 1), 500);
      const r = await db.query(
        `SELECT e.id, e.event, e.identifier, e.ip, e.details, e.created_at, a.username
         FROM auth_events e LEFT JOIN admins a ON a.id = e.admin_id
         WHERE e.tenant_id IS NULL ORDER BY e.created_at DESC LIMIT $1`,
        [limit],
      );
      return {
        events: r.rows.map((e) => ({ id: Number(e.id), event: e.event, username: e.username, identifier: e.identifier, ip: e.ip, details: e.details, createdAt: e.created_at })),
      };
    });
  });
}
