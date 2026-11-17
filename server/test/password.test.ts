import crypto from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hashPassword, needsRehash, verifyPassword } from "../src/crypto.js";
import { setupApi } from "./helpers.js";

/** Hash no formato antigo (scrypt), como os que estão em produção antes da 1.2. */
function legacyScrypt(password: string): string {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(password, salt, 32, { N: 16384, r: 8, p: 1 });
  return `scrypt$16384$8$1$${salt.toString("base64url")}$${key.toString("base64url")}`;
}

let t: Awaited<ReturnType<typeof setupApi>>;
let ip = 50;
const login = (username: string, password: string) =>
  t.app.inject({
    method: "POST",
    url: "/v1/admin/login",
    payload: { username, password },
    headers: { "x-panel-secret": "segredo-do-painel-de-teste", "x-client-ip": `198.51.100.${ip++}` },
  });

beforeAll(async () => {
  t = await setupApi();
});
afterAll(async () => t?.close());

describe("Argon2id", () => {
  it("senha nova em Argon2id com os parâmetros da OWASP", async () => {
    const h = await hashPassword("uma-senha-boa-123");
    expect(h).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    expect(await verifyPassword("uma-senha-boa-123", h)).toBe(true);
    expect(await verifyPassword("outra-senha-123", h)).toBe(false);
    expect(needsRehash(h)).toBe(false);
    // hash diferente a cada vez (sal aleatório)
    expect(await hashPassword("uma-senha-boa-123")).not.toBe(h);
  });

  it("hash antigo (scrypt) continua entrando e vira Argon2id no login", async () => {
    const legacy = legacyScrypt("senha-antiga-456");
    expect(await verifyPassword("senha-antiga-456", legacy)).toBe(true);
    expect(needsRehash(legacy)).toBe(true);
    await t.db.query("UPDATE admins SET password_hash = $1 WHERE username = 'admin'", [legacy]);

    expect((await login("admin", "senha-antiga-456")).statusCode).toBe(200);
    const stored = (await t.db.query("SELECT password_hash FROM admins WHERE username = 'admin'")).rows[0].password_hash;
    expect(stored).toMatch(/^\$argon2id\$/);
    expect((await t.db.query("SELECT 1 FROM auth_events WHERE event = 'password_rehashed'")).rowCount).toBe(1);
    // a mesma senha continua entrando, agora pelo Argon2id
    expect((await login("admin", "senha-antiga-456")).statusCode).toBe(200);
    // senha errada num hash antigo não regrava nada
    await t.db.query("UPDATE admins SET password_hash = $1 WHERE username = 'admin'", [legacyScrypt("outra-coisa-789")]);
    expect((await login("admin", "senha-antiga-456")).statusCode).toBe(401);
    expect((await t.db.query("SELECT password_hash FROM admins WHERE username = 'admin'")).rows[0].password_hash).toMatch(/^scrypt\$/);
  });

  it("conta inexistente gasta tempo parecido com senha errada (o tempo não revela a conta)", async () => {
    await t.db.query("UPDATE admins SET password_hash = $1 WHERE username = 'admin'", [await hashPassword("senha-de-teste-123")]);
    await login("ninguem-aquecimento", "x-xxxxxxxxxx"); // calcula o hash falso uma vez
    const time = async (u: string) => {
      const t0 = performance.now();
      await login(u, "senha-errada-xx");
      return performance.now() - t0;
    };
    const unknown = (await time("ninguem-1")) + (await time("ninguem-2"));
    const existing = (await time("admin")) + (await time("admin"));
    // folga larga (CI/máquina carregada): só garante a mesma ordem de grandeza
    expect(unknown).toBeGreaterThan(existing * 0.4);
    expect(unknown).toBeLessThan(existing * 2.5);
  });
});
