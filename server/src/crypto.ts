import crypto from "node:crypto";
import { promisify } from "node:util";
import { Algorithm, hash as argon2Hash, verify as argon2Verify } from "@node-rs/argon2";

const scrypt = promisify(crypto.scrypt) as (pw: string, salt: Buffer, len: number, opts: crypto.ScryptOptions) => Promise<Buffer>;
const SCRYPT = { N: 16384, r: 8, p: 1 };

/** Token aleatório (base64url, 32 bytes). */
export function newToken(): string {
  return crypto.randomBytes(32).toString("base64url");
}

/** Código de cadastro legível: 10 caracteres sem 0/O/1/I. */
export function newEnrollmentCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.randomBytes(10);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}

export function sha256(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

/**
 * Senhas: Argon2id (parâmetros mínimos recomendados pela OWASP: 19 MiB, 2 iterações, 1 via), no formato PHC
 * ($argon2id$v=19$m=…). Hashes antigos em scrypt (scrypt$N$r$p$salt$hash) continuam valendo e são regravados em
 * Argon2id no próximo login certo (needsRehash).
 */
const ARGON2 = { algorithm: Algorithm.Argon2id, memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

export async function hashPassword(password: string): Promise<string> {
  return argon2Hash(password, ARGON2);
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  if (stored.startsWith("$argon2")) {
    try {
      return await argon2Verify(stored, password);
    } catch {
      return false;
    }
  }
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, n, r, p, salt, hash] = parts;
  const expected = Buffer.from(hash, "base64url");
  const key = await scrypt(password, Buffer.from(salt, "base64url"), expected.length, { N: Number(n), r: Number(r), p: Number(p) });
  return crypto.timingSafeEqual(key, expected);
}

/** O hash guardado é de um formato/parâmetro antigo (regravar depois de um login certo). */
export function needsRehash(stored: string): boolean {
  return !stored.startsWith(`$argon2id$v=19$m=${ARGON2.memoryCost},t=${ARGON2.timeCost},p=${ARGON2.parallelism}$`);
}
