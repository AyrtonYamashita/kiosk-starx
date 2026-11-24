import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPool, migrate, type Db } from "../src/db.js";
import { info, setupApi } from "./helpers.js";

const DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgres://kiosk:kiosk@127.0.0.1:5434/kiosk";

/** Código de erro do Postgres de uma consulta que deveria falhar. */
async function pgError(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    return (e as { code?: string }).code ?? "?";
  }
  return "ok";
}

describe("3.1: atualização com dados existentes", () => {
  const schema = `test_upg_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  let db: Db;
  beforeAll(async () => {
    db = createPool(DATABASE_URL, schema);
    await migrate(db, schema, { until: "016_tenants.sql" });
  });
  afterAll(async () => {
    await db.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await db.end();
  });

  it("todos os dados atuais vão para a Alt Brasil; o usuário da PStarX vira plataforma, sem empresa", async () => {
    // instalação de hoje (antes da 016): o usuário da PStarX, o admin da Alt Brasil, perfil, código, coletor, carga...
    const owner = (
      await db.query("INSERT INTO admins (username, password_hash, email, created_at) VALUES ('ayrton', 'x', 'AyrtonYamashita@pstarx.com', now() - interval '1 year') RETURNING id")
    ).rows[0].id;
    const other = (await db.query("INSERT INTO admins (username, password_hash, email) VALUES ('ticba', 'x', 'ticba@altbrasil.com.br') RETURNING id")).rows[0].id;
    await db.query("INSERT INTO sessions (admin_id, token_hash, expires_at) VALUES ($1, 't0', now() + interval '1 day')", [owner]);
    await db.query("INSERT INTO push_subscriptions (admin_id, endpoint, p256dh, auth) VALUES ($1, 'https://push/0', 'p', 'a')", [owner]);
    await db.query("INSERT INTO auth_events (admin_id, event) VALUES ($1, 'login_success')", [owner]);
    const profile = (await db.query("INSERT INTO profiles (name) VALUES ('Galpão') RETURNING id")).rows[0].id;
    const code = (await db.query("INSERT INTO enrollment_codes (code, name, profile_id) VALUES ('ABCD1234', 'Galpão', $1) RETURNING id", [profile])).rows[0].id;
    const device = (
      await db.query("INSERT INTO devices (name, token_hash, enrollment_code_id, profile_id, serial) VALUES ('C6000', 'h1', $1, $2, 'S1') RETURNING id", [code, profile])
    ).rows[0].id;
    await db.query("INSERT INTO commands (device_id, type, expires_at) VALUES ($1, 'lock', now() + interval '1 hour')", [device]);
    await db.query("INSERT INTO ops_operations (device_id, fn, plate, started_at) VALUES ($1, 'coleta', 'ABC1234', now())", [device]);
    await db.query("INSERT INTO apps (package_name, label, signing_cert_sha256) VALUES ('com.x', 'X', 'c')");
    await db.query("INSERT INTO app_versions (package_name, version_code, sha256, size_bytes) VALUES ('com.x', 1, 's', 1)");
    await db.query("INSERT INTO sessions (admin_id, token_hash, expires_at) VALUES ($1, 't1', now() + interval '1 day')", [other]);
    await db.query("INSERT INTO push_subscriptions (admin_id, endpoint, p256dh, auth) VALUES ($1, 'https://push/1', 'p', 'a')", [other]);
    await db.query("INSERT INTO privacy_erasures (kind, subject_hash, created_by) VALUES ('ssw_user', 'h', $1)", [owner]);
    await db.query("INSERT INTO auth_events (admin_id, event) VALUES ($1, 'login_success'), (NULL, 'login_failure')", [other]);

    expect(await migrate(db, schema)).toEqual(["016_tenants.sql"]);

    const t = (await db.query("SELECT id, name, slug, status FROM tenants")).rows;
    expect(t).toEqual([{ id: expect.any(String), name: "Alt Brasil", slug: "altbrasil", status: "active" }]);
    const first = t[0].id;
    for (const tbl of ["profiles", "enrollment_codes", "devices", "commands", "ops_operations", "apps", "app_versions", "privacy_erasures", "ops_settings"]) {
      const r = (await db.query(`SELECT count(*)::int AS n, count(*) FILTER (WHERE tenant_id = $1)::int AS ok FROM ${tbl}`, [first])).rows[0];
      expect({ tbl, ...r }).toEqual({ tbl, n: r.n, ok: r.n });
      expect(r.n).toBeGreaterThan(0);
    }
    expect((await db.query("SELECT username, platform, tenant_id FROM admins ORDER BY username")).rows).toEqual([
      { username: "ayrton", platform: true, tenant_id: null },
      { username: "ticba", platform: false, tenant_id: first },
    ]);
    // ligados a um usuário: a empresa dele (a plataforma não tem); conta inexistente também fica sem empresa
    for (const tbl of ["sessions", "push_subscriptions"]) {
      const rows = (await db.query(`SELECT admin_id, tenant_id FROM ${tbl} ORDER BY admin_id = $1 DESC`, [owner])).rows;
      expect(rows).toEqual([
        { admin_id: owner, tenant_id: null },
        { admin_id: other, tenant_id: first },
      ]);
    }
    expect((await db.query("SELECT admin_id, event, tenant_id FROM auth_events ORDER BY id")).rows).toEqual([
      { admin_id: owner, event: "login_success", tenant_id: null },
      { admin_id: other, event: "login_success", tenant_id: first },
      { admin_id: null, event: "login_failure", tenant_id: null },
    ]);
    // ajustes da leitura do SSW: continuam numa linha só, agora da Alt Brasil
    expect((await db.query("SELECT tenant_id, reader_all FROM ops_settings")).rows).toEqual([{ tenant_id: first, reader_all: false }]);
  });
});

describe("3.1: isolamento no banco", () => {
  let t: Awaited<ReturnType<typeof setupApi>>;
  let first: string;
  beforeAll(async () => {
    t = await setupApi();
    first = (await t.db.query("SELECT id FROM tenants WHERE slug = 'principal'")).rows[0].id;
  });
  afterAll(async () => t?.close());

  it("com uma empresa só, a API segue igual: tudo cai na empresa principal", async () => {
    const me = await t.api("GET", "/v1/admin/me");
    expect(me.json).toMatchObject({ username: "admin", platform: false, tenant: { id: first, name: "Empresa principal", slug: "principal" } });
    const profile = await t.api("POST", "/v1/admin/profiles", { name: "Padrão", config: {} });
    expect(profile.status).toBe(200);
    const code = (await t.api("POST", "/v1/admin/enrollments", { name: "Galpão" })).json.code;
    const enroll = await t.api("POST", "/v1/device/enroll", { code, info: info("TEN1") }, "");
    expect(enroll.status).toBe(200);
    const rows = (
      await t.db.query(
        `SELECT (SELECT tenant_id FROM devices WHERE id = $1) AS device, (SELECT tenant_id FROM profiles WHERE name = 'Padrão') AS profile,
                (SELECT tenant_id FROM sessions LIMIT 1) AS session`,
        [enroll.json.deviceId],
      )
    ).rows[0];
    expect(rows).toEqual({ device: first, profile: first, session: first });
  });

  it("com duas empresas: gravação sem empresa falha, nomes repetem entre empresas e nada aponta para a outra", async () => {
    const b = (await t.db.query("INSERT INTO tenants (name, slug) VALUES ('Transportadora B', 'transp-b') RETURNING id")).rows[0].id;
    // a empresa nova ganha a sua linha de ajustes
    expect((await t.db.query("SELECT count(*)::int AS n FROM ops_settings WHERE tenant_id = $1", [b])).rows[0].n).toBe(1);

    // sem empresa informada (e com duas existentes): recusa em vez de adivinhar
    expect(await pgError(t.db.query("INSERT INTO profiles (name) VALUES ('Sem empresa')"))).toBe("23502");

    // usuário: de empresa precisa de empresa; da plataforma não pode ter
    expect(await pgError(t.db.query("INSERT INTO admins (username, password_hash) VALUES ('sem-empresa', 'x')"))).toBe("23514");
    expect(await pgError(t.db.query("INSERT INTO admins (tenant_id, username, password_hash, platform) VALUES ($1, 'plat-b', 'x', true)", [b]))).toBe("23514");
    await t.db.query("INSERT INTO admins (username, password_hash, platform, email) VALUES ('suporte', $1, true, 'suporte@pstarx.com')", [
      (await t.db.query("SELECT password_hash FROM admins WHERE username = 'admin'")).rows[0].password_hash,
    ]);
    const login = await t.api("POST", "/v1/admin/login", { username: "suporte", password: "senha-de-teste-123" }, "");
    expect(login.status).toBe(200);
    expect((await t.api("GET", "/v1/admin/me", undefined, login.json.token)).json).toMatchObject({ username: "suporte", platform: true, tenant: null });
    expect((await t.db.query("SELECT s.tenant_id FROM sessions s JOIN admins a ON a.id = s.admin_id WHERE a.username = 'suporte'")).rows).toEqual([{ tenant_id: null }]);

    // mesmo nome de perfil, usuário e app em empresas diferentes
    const profB = (await t.db.query("INSERT INTO profiles (tenant_id, name) VALUES ($1, 'Padrão') RETURNING id", [b])).rows[0].id;
    await t.db.query("INSERT INTO admins (tenant_id, username, password_hash) VALUES ($1, 'admin', 'x')", [b]);
    await t.db.query("INSERT INTO apps (tenant_id, package_name, label, signing_cert_sha256) VALUES ($1, 'com.x', 'X', 'c'), ($2, 'com.x', 'X', 'c')", [first, b]);
    expect(await pgError(t.db.query("INSERT INTO profiles (tenant_id, name) VALUES ($1, 'Padrão')", [b]))).toBe("23505");

    // coletor da B não pode usar o perfil nem o código da outra empresa
    const profA = (await t.db.query("SELECT id FROM profiles WHERE tenant_id = $1 AND name = 'Padrão'", [first])).rows[0].id;
    const codeA = (await t.db.query("SELECT id FROM enrollment_codes WHERE tenant_id = $1 LIMIT 1", [first])).rows[0].id;
    expect(await pgError(t.db.query("INSERT INTO devices (tenant_id, name, token_hash, profile_id) VALUES ($1, 'x', 'hx1', $2)", [b, profA]))).toBe("23503");
    expect(await pgError(t.db.query("INSERT INTO devices (tenant_id, name, token_hash, enrollment_code_id) VALUES ($1, 'x', 'hx2', $2)", [b, codeA]))).toBe("23503");

    // coletor da B: comandos e cargas herdam a empresa dele
    const devB = (await t.db.query("INSERT INTO devices (tenant_id, name, token_hash, profile_id) VALUES ($1, 'B1', 'hb1', $2) RETURNING id", [b, profB])).rows[0].id;
    const cmd = (await t.db.query("INSERT INTO commands (device_id, type, expires_at) VALUES ($1, 'lock', now() + interval '1 hour') RETURNING tenant_id", [devB])).rows[0];
    expect(cmd.tenant_id).toBe(b);
    // e não podem ser gravados com a empresa errada
    expect(
      await pgError(t.db.query("INSERT INTO commands (tenant_id, device_id, type, expires_at) VALUES ($1, $2, 'lock', now() + interval '1 hour')", [first, devB])),
    ).toBe("23503");

    // apagar a empresa leva tudo dela junto (e só dela)
    await t.db.query("DELETE FROM tenants WHERE id = $1", [b]);
    for (const tbl of ["devices", "commands", "profiles", "admins", "apps", "ops_settings"]) {
      expect((await t.db.query(`SELECT count(*)::int AS n FROM ${tbl} WHERE tenant_id = $1`, [b])).rows[0].n).toBe(0);
    }
    expect((await t.db.query("SELECT count(*)::int AS n FROM apps WHERE tenant_id = $1", [first])).rows[0].n).toBe(1);
  });
});
