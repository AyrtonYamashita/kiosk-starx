import type { FastifyRequest } from "fastify";
import { sha256 } from "./crypto.js";
import type { Db } from "./db.js";

export interface AuthDevice {
  id: string;
  name: string;
  serial: string | null;
  enrollment_code_id: string | null;
  apps_hash: string | null;
  config_revision: number | null;
}

/** Aparelho dono do token (Authorization: Bearer). null se ausente ou inválido. */
export async function authDevice(db: Db, req: FastifyRequest): Promise<AuthDevice | null> {
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) return null;
  const r = await db.query("SELECT id, name, serial, enrollment_code_id, apps_hash, config_revision FROM devices WHERE token_hash = $1", [sha256(auth.slice(7))]);
  return r.rows[0] ?? null;
}
