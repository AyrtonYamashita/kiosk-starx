import crypto from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sha256hex, signBatch } from "../src/ops.js";
import { reapplyErasures, subjectHash } from "../src/privacy.js";
import { info, setupApi } from "./helpers.js";

let t: Awaited<ReturnType<typeof setupApi>>;
let deviceId: string;
let token: string;
let lastTs = Date.now() - 60_000;
const id = () => crypto.randomUUID();
const tot = (qty: number) => ({ qty, kg: qty * 2, value: qty * 100 });

async function send(events: object[]) {
  const ts = (lastTs = Math.max(lastTs + 1, Date.now()));
  const body = JSON.stringify({ schema: 1, events });
  const res = await t.app.inject({
    method: "POST",
    url: "/v1/device/events",
    payload: body,
    headers: { "content-type": "application/json", "x-device-id": deviceId, "x-ts": String(ts), "x-signature": signBatch(sha256hex(token), ts, body) },
  });
  expect(res.statusCode).toBe(200);
}

/** Uma carga completa de um colaborador (sessão, início, bipagem, fim). */
async function carga(user: string, plate: string) {
  const T = Date.now() - 5 * 60_000;
  await send([
    { id: id(), at: T, type: "session", user, domain: "ALT", branch: "OTI" },
    { id: id(), at: T + 1000, type: "op_start", fn: "coleta", plate, total: tot(2) },
    { id: id(), at: T + 2000, type: "progress", fn: "coleta", plate, read: tot(2) },
    { id: id(), at: T + 3000, type: "op_end", fn: "coleta", plate, reason: "concluded" },
  ]);
}

beforeAll(async () => {
  t = await setupApi();
  const code = (await t.api("POST", "/v1/admin/enrollments", { name: "Privacidade" })).json.code;
  const r = await t.api("POST", "/v1/device/enroll", { code, info: info("PRV1") }, "");
  deviceId = r.json.deviceId;
  token = r.json.token;
  await t.api("PATCH", `/v1/admin/devices/${deviceId}`, { opsReader: true });
  await carga("carla.silva", "PRV1A11");
  await carga("bruno.lima", "PRV2B22");
  await carga("carla.silva", "PRV3C33");
});
afterAll(async () => t?.close());

describe("direitos dos titulares (LGPD, Art. 18)", () => {
  it("busca colaboradores com resumo", async () => {
    const r = (await t.api("GET", "/v1/admin/privacy/subjects?q=carla")).json;
    expect(r.subjects).toEqual([expect.objectContaining({ user: "carla.silva", operations: 2 })]);
    expect((await t.api("GET", "/v1/admin/privacy/subjects")).json.subjects.map((s: { user: string }) => s.user).sort()).toEqual(["bruno.lima", "carla.silva"]);
  });

  it("exporta só os dados do colaborador, com a descrição do tratamento", async () => {
    const r = await t.api("GET", "/v1/admin/privacy/subjects/carla.silva/export");
    expect(r.status).toBe(200);
    expect(r.json.titular).toEqual({ usuario_ssw: "carla.silva" });
    expect(r.json.cargas.map((c: { placa: string }) => c.placa).sort()).toEqual(["PRV1A11", "PRV3C33"]);
    expect(r.json.sobre_o_tratamento.finalidades.length).toBeGreaterThan(0);
    // nada do colega
    expect(JSON.stringify(r.json)).not.toContain("bruno.lima");
    expect(JSON.stringify(r.json)).not.toContain("PRV2B22");
    expect((await t.api("GET", "/v1/admin/privacy/subjects/ninguem/export")).status).toBe(404);
    const log = await t.db.query("SELECT details FROM auth_events WHERE event = 'privacy_export' ORDER BY id DESC LIMIT 1");
    expect(log.rows[0].details).toEqual({ cargas: 2 });
  });

  it("anonimiza: tira o usuário de cargas, estado e eventos; guarda só o hash; reaplica após restaurar backup", async () => {
    const r = await t.api("POST", "/v1/admin/privacy/subjects/carla.silva/anonymize");
    expect(r.status).toBe(200);
    expect(r.json.operations).toBe(2);
    const left = await t.db.query("SELECT count(*)::int AS n FROM ops_operations WHERE ssw_user = 'carla.silva'");
    expect(left.rows[0].n).toBe(0);
    const ev = await t.db.query("SELECT count(*)::int AS n FROM ops_events WHERE data->>'user' = 'carla.silva'");
    expect(ev.rows[0].n).toBe(0);
    // o colega não muda
    expect((await t.db.query("SELECT count(*)::int AS n FROM ops_operations WHERE ssw_user = 'bruno.lima'")).rows[0].n).toBe(1);
    // a tabela de anonimizações não guarda o nome; a trilha também não
    const er = (await t.db.query("SELECT subject_hash FROM privacy_erasures")).rows;
    expect(er).toEqual([{ subject_hash: subjectHash(t.config.authSecret, "carla.silva") }]);
    const audit = (await t.db.query("SELECT details FROM auth_events WHERE event = 'privacy_anonymize'")).rows[0].details;
    expect(JSON.stringify(audit)).not.toContain("carla");
    // backup antigo restaurado: o nome volta numa carga; a rotina reaplica
    await t.db.query("UPDATE ops_operations SET ssw_user = 'carla.silva' WHERE plate = 'PRV1A11'");
    expect(await reapplyErasures(t.db, t.config.authSecret)).toBe(1);
    expect((await t.db.query("SELECT ssw_user FROM ops_operations WHERE plate = 'PRV1A11'")).rows[0].ssw_user).toBeNull();
    // de novo: nada encontrado
    expect((await t.api("POST", "/v1/admin/privacy/subjects/carla.silva/anonymize")).status).toBe(404);
  });

  it("usuário do painel baixa os próprios dados, sem segredos", async () => {
    const r = await t.api("GET", "/v1/admin/me/export");
    expect(r.status).toBe(200);
    expect(r.json.conta).toMatchObject({ usuario: "admin", papel: "admin" });
    const s = JSON.stringify(r.json);
    for (const segredo of ["password_hash", "token_hash", "secret_enc", "code_hash"]) expect(s).not.toContain(segredo);
  });

  it("só administradores acessam os dados dos colaboradores", async () => {
    expect((await t.api("POST", "/v1/admin/users", { username: "op.priv", email: "op.priv@pstarx.com", role: "operator", password: "senha-do-operador-1" })).status).toBe(200);
    const op = (await t.api("POST", "/v1/admin/login", { username: "op.priv", password: "senha-do-operador-1" }, "")).json.token;
    expect((await t.api("GET", "/v1/admin/privacy/subjects", undefined, op)).status).toBe(403);
    expect((await t.api("GET", "/v1/admin/privacy/subjects/bruno.lima/export", undefined, op)).status).toBe(403);
    expect((await t.api("POST", "/v1/admin/privacy/subjects/bruno.lima/anonymize", undefined, op)).status).toBe(403);
    // mas baixa os próprios dados
    expect((await t.api("GET", "/v1/admin/me/export", undefined, op)).status).toBe(200);
  });
});

describe("aviso de privacidade no coletor (0.5.4)", () => {
  const hash = "a".repeat(64);

  it("o perfil aceita o texto do aviso", async () => {
    const r = await t.api("POST", "/v1/admin/profiles", { name: "Com aviso", config: { display: { privacyNotice: "Seus dados de carga são lidos para coordenar a operação." } } });
    expect(r.status).toBeLessThan(300);
    expect((await t.api("POST", "/v1/admin/profiles", { name: "Aviso longo", config: { display: { privacyNotice: "x".repeat(4001) } } })).status).toBe(400);
  });

  it("registra a ciência com o usuário do SSW do momento, uma vez por versão do texto", async () => {
    await send([{ id: id(), at: Date.now() - 1000, type: "session", user: "diego.rocha", domain: "ALT", branch: "OTI" }]);
    const at = Date.now() - 500;
    const r = await t.api("POST", "/v1/device/checkin", { info: info("PRV1"), privacyAck: { hash, at } }, token);
    expect(r.status).toBe(200);
    expect(r.json.privacyAcked).toBe(hash);
    // reenvio (o app repete até ver a confirmação): não duplica
    expect((await t.api("POST", "/v1/device/checkin", { info: info("PRV1"), privacyAck: { hash, at } }, token)).status).toBe(200);
    const rows = (await t.db.query("SELECT ssw_user FROM privacy_acks WHERE device_id = $1", [deviceId])).rows;
    expect(rows).toEqual([{ ssw_user: "diego.rocha" }]);
    // hash inválido é recusado
    expect((await t.api("POST", "/v1/device/checkin", { privacyAck: { hash: "xyz", at } }, token)).status).toBe(400);
    // aparece no detalhe do coletor
    const d = (await t.api("GET", `/v1/admin/devices/${deviceId}`)).json;
    expect(d.privacyAck).toMatchObject({ sswUser: "diego.rocha", hash });
  });

  it("entra na exportação do colaborador e sai na anonimização", async () => {
    const ex = (await t.api("GET", "/v1/admin/privacy/subjects/diego.rocha/export")).json;
    expect(ex.ciencia_do_aviso_de_privacidade).toHaveLength(1);
    const an = await t.api("POST", "/v1/admin/privacy/subjects/diego.rocha/anonymize");
    expect(an.status).toBe(200);
    expect(an.json.acks).toBe(1);
    expect((await t.db.query("SELECT ssw_user FROM privacy_acks WHERE device_id = $1", [deviceId])).rows[0].ssw_user).toBeNull();
  });
});
