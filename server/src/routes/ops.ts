import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import type { Db } from "../db.js";
import { applyBatch, OPS_MAX_BODY, OPS_MAX_SKEW_MS, OPS_READER_ON_SQL, OpsBatch, type OpsBus, signatureOk } from "../ops.js";

/**
 * Recebimento dos eventos do leitor do SSW (fase 2.2): POST /v1/device/events.
 * Sem token no cabeçalho: o lote é assinado com HMAC (chave = SHA-256 do token do aparelho).
 */
export async function opsDeviceRoutes(app: FastifyInstance, opts: { db: Db; bus: OpsBus }) {
  const { db, bus } = opts;

  // corpo como texto: a assinatura vale sobre os bytes exatos que chegaram
  app.addContentTypeParser("application/json", { parseAs: "string", bodyLimit: OPS_MAX_BODY }, (req, body, done) => {
    (req as FastifyRequest & { rawBody?: string }).rawBody = body as string;
    try {
      done(null, JSON.parse(body as string));
    } catch {
      const err = new Error("JSON inválido") as Error & { statusCode: number };
      err.statusCode = 400;
      done(err, undefined);
    }
  });

  app.post(
    "/v1/device/events",
    {
      bodyLimit: OPS_MAX_BODY,
      config: {
        // por coletor (o id vem no cabeçalho; sem ele, por IP)
        rateLimit: { max: 120, timeWindow: "1 minute", keyGenerator: (req: FastifyRequest) => `ops:${String(req.headers["x-device-id"] ?? req.ip).slice(0, 64)}` },
      },
    },
    async (req, reply) => {
      const serverTime = Date.now();
      const deviceId = String(req.headers["x-device-id"] ?? "");
      const tsRaw = String(req.headers["x-ts"] ?? "");
      const signature = String(req.headers["x-signature"] ?? "").toLowerCase();
      const raw = (req as FastifyRequest & { rawBody?: string }).rawBody;
      const deny = () => reply.code(401).send({ error: "unauthorized", serverTime });

      if (!z.uuid().safeParse(deviceId).success || !/^\d{12,14}$/.test(tsRaw) || !raw) return deny();
      const ts = Number(tsRaw);
      const dev = (
        await db.query<{ token_hash: string; ops_reader: boolean }>(`SELECT token_hash, ${OPS_READER_ON_SQL} AS ops_reader FROM devices d WHERE id = $1`, [deviceId])
      ).rows[0];
      // aparelho removido (revogado) ou assinatura errada: mesma resposta
      if (!dev || !signatureOk(dev.token_hash, ts, raw, signature)) {
        req.log.warn({ deviceId }, "lote de eventos recusado: aparelho ou assinatura inválidos");
        return deny();
      }
      // relógio do aparelho muito fora: devolve a hora do servidor para o app corrigir
      if (Math.abs(ts - serverTime) > OPS_MAX_SKEW_MS) return reply.code(401).send({ error: "clock_skew", serverTime });
      // leitura desligada no painel (no coletor ou pela chave geral): o app para de ler e descarta a fila
      if (!dev.ops_reader) return reply.code(403).send({ error: "ops_disabled", message: "leitura do SSW desligada para este coletor", serverTime });

      const body = OpsBatch.safeParse(req.body);
      if (!body.success) {
        return reply.code(400).send({ error: "invalid_body", message: body.error.issues.slice(0, 3).map((i) => `${i.path.join(".")}: ${i.message}`).join("; "), serverTime });
      }

      const c = await db.connect();
      try {
        await c.query("BEGIN");
        // um lote por vez por coletor; só entra se for mais novo que o último aceito (reenvio capturado não entra)
        const last = (await c.query<{ ops_last_ts: string }>("SELECT ops_last_ts FROM devices WHERE id = $1 FOR UPDATE", [deviceId])).rows[0];
        if (!last) {
          await c.query("ROLLBACK");
          return deny();
        }
        if (ts <= Number(last.ops_last_ts)) {
          await c.query("ROLLBACK");
          return reply.code(409).send({ error: "stale", message: "lote antigo ou repetido", serverTime });
        }
        const r = await applyBatch(c, deviceId, body.data.events);
        await c.query("UPDATE devices SET ops_last_ts = $2 WHERE id = $1", [deviceId, ts]);
        await c.query("COMMIT");
        if (r.accepted) bus.changed(deviceId);
        return { ...r, serverTime };
      } catch (e) {
        await c.query("ROLLBACK").catch(() => undefined);
        throw e;
      } finally {
        c.release();
      }
    },
  );
}
