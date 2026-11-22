import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import type { Config } from "../config.js";
import type { Db } from "../db.js";
import { audit } from "../auth.js";
import { anonymizeSubject, exportAdmin, exportSubject, searchSubjects } from "../privacy.js";

const User = z.string().trim().min(1).max(64);

/** Direitos dos titulares (LGPD, Art. 18): colaboradores (pelo usuário do SSW) e o próprio usuário do painel. */
export async function privacyRoutes(app: FastifyInstance, opts: { db: Db; config: Config }) {
  const { db, config } = opts;

  const onlyAdmin = async (req: FastifyRequest, reply: FastifyReply) => {
    if (req.admin?.role !== "admin") return reply.code(403).send({ error: "forbidden", message: "só administradores" });
  };

  app.get("/v1/admin/privacy/subjects", { preHandler: onlyAdmin }, async (req) => {
    const q = String((req.query as { q?: string }).q ?? "").trim().slice(0, 64);
    return { subjects: await searchSubjects(db, q) };
  });

  app.get("/v1/admin/privacy/subjects/:user/export", { preHandler: onlyAdmin }, async (req, reply) => {
    const user = User.safeParse((req.params as { user: string }).user);
    if (!user.success) return reply.code(400).send({ error: "invalid_user" });
    const data = await exportSubject(db, user.data);
    if (!data.cargas.length && !data.eventos_guardados.length && !data.estado_atual.length) {
      return reply.code(404).send({ error: "not_found", message: "Nenhum dado com esse usuário do SSW." });
    }
    await audit(db, req, "privacy_export", { adminId: req.admin!.id, details: { cargas: data.cargas.length } });
    return data;
  });

  app.post("/v1/admin/privacy/subjects/:user/anonymize", { preHandler: onlyAdmin }, async (req, reply) => {
    const user = User.safeParse((req.params as { user: string }).user);
    if (!user.success) return reply.code(400).send({ error: "invalid_user" });
    const r = await anonymizeSubject(db, config.authSecret, user.data, req.admin!.id);
    if (!r.operations && !r.current && !r.events) return reply.code(404).send({ error: "not_found", message: "Nenhum dado com esse usuário do SSW." });
    // a trilha não guarda o usuário anonimizado (só o que mudou)
    await audit(db, req, "privacy_anonymize", { adminId: req.admin!.id, details: r });
    return { ok: true, ...r };
  });

  app.get("/v1/admin/me/export", async (req) => {
    const data = await exportAdmin(db, req.admin!.id);
    await audit(db, req, "privacy_self_export", { adminId: req.admin!.id });
    return data;
  });
}
