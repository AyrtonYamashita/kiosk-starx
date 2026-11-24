import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asSystem, runInContext } from "../src/db.js";
import { addTenant, setupApi } from "./helpers.js";

/**
 * Fase 3.3: o banco separa as empresas sozinho (segunda barreira, por baixo do filtro da API). Consultas sem
 * "WHERE tenant_id" — o erro que o RLS existe para pegar — só devolvem a empresa do contexto. A bateria de
 * isolamento (isolation.test.ts) roda com o RLS ligado: toda requisição usa o papel restrito.
 */
let t: Awaited<ReturnType<typeof setupApi>>;
let A: string;
let B: string;
const inTenant = <T>(tenantId: string | null, fn: () => Promise<T>) => runInContext({ system: false, tenantId }, fn);
async function pgError(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    return (e as { code?: string }).code ?? "?";
  }
  return "ok";
}

beforeAll(async () => {
  t = await setupApi();
  A = (await t.db.query("SELECT id FROM tenants WHERE slug = 'principal'")).rows[0].id;
  B = (await addTenant(t, "rls-b")).tenantId;
  // fora de requisição = sistema: grava nas duas empresas
  await t.db.query("INSERT INTO devices (tenant_id, name, token_hash) VALUES ($1, 'A1', 'ra1'), ($1, 'A2', 'ra2'), ($2, 'B1', 'rb1')", [A, B]);
  await t.db.query("INSERT INTO profiles (tenant_id, name) VALUES ($1, 'Perfil A'), ($2, 'Perfil B')", [A, B]);
});
afterAll(async () => t?.close());

describe("RLS no banco", () => {
  it("requisição roda com o papel restrito; sistema com o dono", async () => {
    expect((await inTenant(A, () => t.db.query("SELECT current_user AS u"))).rows[0].u).toBe("kiosk_app");
    expect((await t.db.query("SELECT current_user AS u")).rows[0].u).not.toBe("kiosk_app");
    expect((await inTenant(A, () => asSystem(() => t.db.query("SELECT current_user AS u"))))).toMatchObject({ rows: [{ u: expect.not.stringMatching(/^kiosk_app$/) }] });
  });

  it("consulta sem filtro de empresa só devolve a empresa do contexto; sem empresa, nada", async () => {
    const names = async (tenant: string | null) => (await inTenant(tenant, () => t.db.query("SELECT name FROM devices ORDER BY name"))).rows.map((r) => r.name);
    expect(await names(A)).toEqual(["A1", "A2"]);
    expect(await names(B)).toEqual(["B1"]);
    expect(await names(null)).toEqual([]);
    // join "esquecido" também não cruza
    const joined = await inTenant(B, () => t.db.query("SELECT d.name, p.name AS profile FROM devices d CROSS JOIN profiles p ORDER BY 1, 2"));
    expect(joined.rows).toEqual([{ name: "B1", profile: "Perfil B" }]);
  });

  it("não altera, não apaga e não grava na outra empresa", async () => {
    expect((await inTenant(A, () => t.db.query("UPDATE devices SET name = 'roubado'"))).rowCount).toBe(2);
    expect((await inTenant(A, () => t.db.query("DELETE FROM profiles WHERE name = 'Perfil B'"))).rowCount).toBe(0);
    expect(await pgError(inTenant(A, () => t.db.query("INSERT INTO profiles (tenant_id, name) VALUES ($1, 'intruso')", [B])))).toBe("42501");
    // mudar a linha de empresa também é recusado
    expect(await pgError(inTenant(A, () => t.db.query("UPDATE profiles SET tenant_id = $1 WHERE name = 'Perfil A'", [B])))).toBe("42501");
    expect((await t.db.query("SELECT name FROM devices WHERE tenant_id = $1", [B])).rows).toEqual([{ name: "B1" }]);
    expect((await t.db.query("SELECT count(*)::int AS n FROM profiles WHERE name = 'Perfil B'")).rows[0].n).toBe(1);
  });

  it("transação (connect) leva o contexto do momento; a conexão devolvida não carrega a empresa para o próximo", async () => {
    const c = await inTenant(B, () => t.db.connect());
    try {
      await c.query("BEGIN");
      expect((await c.query("SELECT count(*)::int AS n FROM devices")).rows[0].n).toBe(1);
      await c.query("COMMIT");
    } finally {
      c.release();
    }
    // a mesma conexão volta ao pool; o próximo, sem empresa, não herda a B
    expect((await inTenant(null, () => t.db.query("SELECT count(*)::int AS n FROM devices"))).rows[0].n).toBe(0);
    expect((await t.db.query("SELECT count(*)::int AS n FROM devices WHERE token_hash LIKE 'r%'")).rows[0].n).toBe(3);
  });
});
