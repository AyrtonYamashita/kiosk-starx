import type { FastifyReply, FastifyRequest } from "fastify";

/**
 * Empresa da requisição do painel: sempre a da sessão (copiada do usuário no login), nunca de cabeçalho, URL ou
 * corpo. Só chamar atrás de `requireTenant`.
 */
export function tenantOf(req: FastifyRequest): string {
  const t = req.admin?.tenantId;
  if (!t) throw new Error("rota de empresa sem empresa na sessão");
  return t;
}

/** Rotas com dados de uma empresa: o usuário da plataforma (sem empresa) não entra. */
export async function requireTenant(req: FastifyRequest, reply: FastifyReply) {
  if (!req.admin?.tenantId) {
    return reply.code(403).send({ error: "no_tenant", message: "Usuário da plataforma: esta tela é de uma empresa." });
  }
}

/** Rotas da plataforma (PStarX): criar empresas, publicar o app do kiosk. */
export async function requirePlatform(req: FastifyRequest, reply: FastifyReply) {
  if (!req.admin?.platform) return reply.code(403).send({ error: "forbidden", message: "só a plataforma" });
}
