import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyRetention } from "../src/retention.js";
import { info, setupApi } from "./helpers.js";

let t: Awaited<ReturnType<typeof setupApi>>;
let deviceId: string;

const O = { operationIdentifiedDays: 365, screenshotDays: 7, commandDays: 180, authEventDays: 365, authUnknownDays: 30, adminDisabledDays: 365 };
const ago = (days: number) => `now() - interval '${days} days'`;

beforeAll(async () => {
  t = await setupApi();
  const code = (await t.api("POST", "/v1/admin/enrollments", { name: "Prazos" })).json.code;
  deviceId = (await t.api("POST", "/v1/device/enroll", { code, info: info("RTN1") }, "")).json.deviceId;
});
afterAll(async () => t?.close());

describe("prazos de guarda (LGPD)", () => {
  it("tira o usuário do SSW só das cargas vencidas e mantém os números", async () => {
    const ins = (plate: string, days: number) =>
      t.db.query(
        `INSERT INTO ops_operations (device_id, fn, plate, ssw_user, started_at, ended_at, end_reason, total_qty, read_qty)
         VALUES ($1, 'coleta', $2, 'joana', ${ago(days)}, ${ago(days)}, 'concluded', 10, 10)`,
        [deviceId, plate],
      );
    await ins("VELHA01", 400);
    await ins("NOVA001", 10);
    const r = await applyRetention(t.db, O);
    expect(r.operationsAnonymized).toBe(1);
    const rows = (await t.db.query("SELECT plate, ssw_user, read_qty FROM ops_operations WHERE plate IN ('VELHA01','NOVA001') ORDER BY plate")).rows;
    expect(rows).toEqual([
      { plate: "NOVA001", ssw_user: "joana", read_qty: "10" },
      { plate: "VELHA01", ssw_user: null, read_qty: "10" },
    ]);
    // de novo: nada a fazer
    expect((await applyRetention(t.db, O)).operationsAnonymized).toBe(0);
  });

  it("apaga capturas de tela vencidas e comandos encerrados vencidos (os pendentes ficam)", async () => {
    await t.db.query(`INSERT INTO screenshots (device_id, mime, data, created_at) VALUES ($1, 'image/jpeg', '\\x00', ${ago(8)}), ($1, 'image/jpeg', '\\x00', ${ago(1)})`, [
      deviceId,
    ]);
    await t.db.query(
      `INSERT INTO commands (device_id, type, status, created_at, expires_at) VALUES
         ($1, 'lock', 'ok', ${ago(200)}, ${ago(199)}),
         ($1, 'lock', 'pending', ${ago(200)}, now() + interval '1 day'),
         ($1, 'lock', 'ok', ${ago(5)}, ${ago(4)})`,
      [deviceId],
    );
    const r = await applyRetention(t.db, O);
    expect(r.screenshots).toBe(1);
    expect(r.commands).toBe(1);
    expect(Number((await t.db.query("SELECT count(*) FROM screenshots WHERE device_id = $1", [deviceId])).rows[0].count)).toBe(1);
    const left = (await t.db.query("SELECT status FROM commands WHERE device_id = $1 ORDER BY status", [deviceId])).rows.map((x) => x.status);
    expect(left).toEqual(["ok", "pending"]);
  });

  it("apaga a trilha vencida: 1 ano com conta, 30 dias sem conta", async () => {
    const admin = (await t.db.query("SELECT id FROM admins LIMIT 1")).rows[0].id;
    await t.db.query(
      `INSERT INTO auth_events (admin_id, identifier, event, created_at) VALUES
         ($1, 'x', 'teste_velho_conta', ${ago(400)}),
         ($1, 'x', 'teste_recente_conta', ${ago(100)}),
         (NULL, 'naoexiste', 'teste_velho_sem_conta', ${ago(40)}),
         (NULL, 'naoexiste', 'teste_recente_sem_conta', ${ago(5)})`,
      [admin],
    );
    await applyRetention(t.db, O);
    const left = (await t.db.query("SELECT event FROM auth_events WHERE event LIKE 'teste_%' ORDER BY event")).rows.map((x) => x.event);
    expect(left).toEqual(["teste_recente_conta", "teste_recente_sem_conta"]);
  });

  it("anonimiza usuário do painel desativado há mais de 1 ano e não toca nos ativos", async () => {
    const mk = async (u: string, disabled: string | null) =>
      (
        await t.db.query(
          `INSERT INTO admins (tenant_id, username, email, password_hash, role, disabled_at)
           VALUES ((SELECT id FROM tenants LIMIT 1), $1, $2, 'hash', 'operator', ${disabled ?? "NULL"}) RETURNING id`,
          [u, `${u}@exemplo.com`],
        )
      ).rows[0].id as string;
    const old = await mk("saiu.ha.tempo", ago(400));
    const recent = await mk("saiu.agora", ago(10));
    const active = await mk("ativo", null);
    await t.db.query(`INSERT INTO sessions (admin_id, token_hash, expires_at) VALUES ($1, 'tok-${old}', now() + interval '1 day')`, [old]);
    await t.db.query("INSERT INTO auth_events (admin_id, identifier, event) VALUES ($1, 'saiu.ha.tempo', 'login_ok')", [old]);

    const r = await applyRetention(t.db, O);
    expect(r.adminsAnonymized).toBe(1);
    const a = (await t.db.query("SELECT id, username, email, password_hash FROM admins WHERE id = ANY($1)", [[old, recent, active]])).rows;
    const byId = Object.fromEntries(a.map((x) => [x.id, x]));
    expect(byId[old]).toMatchObject({ username: `removido-${old.slice(0, 8)}`, email: null, password_hash: "!" });
    expect(byId[recent].username).toBe("saiu.agora");
    expect(byId[active].email).toBe("ativo@exemplo.com");
    expect(Number((await t.db.query("SELECT count(*) FROM sessions WHERE admin_id = $1", [old])).rows[0].count)).toBe(0);
    expect((await t.db.query("SELECT identifier FROM auth_events WHERE admin_id = $1", [old])).rows[0].identifier).toBeNull();
    // o anonimizado não consegue entrar
    const login = await t.api("POST", "/v1/admin/login", { username: `removido-${old.slice(0, 8)}`, password: "qualquer" }, "");
    expect(login.status).toBe(401);
    expect((await applyRetention(t.db, O)).adminsAnonymized).toBe(0);
  });
});
