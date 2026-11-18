import crypto from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { sha256hex, signBatch } from "../src/ops.js";
import { info, setupApi } from "./helpers.js";

let t: Awaited<ReturnType<typeof setupApi>>;
let deviceId: string;
let token: string;
let lastTs = Date.now() - 60_000;

const T0 = Date.now() - 10 * 60_000;
const at = (sec: number) => T0 + sec * 1000;
const id = () => crypto.randomUUID();
const tot = (qty: number, kg = qty * 4, value = qty * 199) => ({ qty, kg, value });

/** Envia um lote como o app: corpo exato + x-ts + HMAC (chave = SHA-256 do token). */
async function send(events: object[], o: { ts?: number; token?: string; device?: string; body?: string; signature?: string } = {}) {
  const ts = o.ts ?? (lastTs = Math.max(lastTs + 1, Date.now()));
  const body = o.body ?? JSON.stringify({ schema: 1, events });
  const res = await t.app.inject({
    method: "POST",
    url: "/v1/device/events",
    payload: body,
    headers: {
      "content-type": "application/json",
      "x-device-id": o.device ?? deviceId,
      "x-ts": String(ts),
      "x-signature": o.signature ?? signBatch(sha256hex(o.token ?? token), ts, body),
    },
  });
  return { status: res.statusCode, json: res.json(), ts, body };
}

const op = async () => (await t.db.query("SELECT * FROM ops_operations WHERE device_id = $1 ORDER BY started_at DESC LIMIT 1", [deviceId])).rows[0];
const state = async () => (await t.db.query("SELECT * FROM ops_device_state WHERE device_id = $1", [deviceId])).rows[0];

beforeAll(async () => {
  t = await setupApi();
  const code = (await t.api("POST", "/v1/admin/enrollments", { name: "Lote" })).json.code;
  const r = await t.api("POST", "/v1/device/enroll", { code, info: info("OPS1") }, "");
  deviceId = r.json.deviceId;
  token = r.json.token;
});
beforeEach(async () => {
  await t.db.query("DELETE FROM ops_events");
  await t.db.query("DELETE FROM ops_operations");
  await t.db.query("DELETE FROM ops_device_state");
});
afterAll(async () => t?.close());

describe("eventos do leitor do SSW: uma descarga", () => {
  it("sessão + início + bipagens + fim viram uma operação com tempos por volume", async () => {
    const r = await send([
      { id: id(), at: at(0), type: "session", user: "ayrton", domain: "ALT", branch: "OTI" },
      { id: id(), at: at(5), type: "op_start", fn: "coleta", plate: "ABC1D23", units: ["ALT", "OTI", "BOT", "CGB"], total: tot(10) },
    ]);
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ accepted: 2, duplicates: 0 });
    expect(typeof r.json.serverTime).toBe("number");

    let o = await op();
    expect(o).toMatchObject({ fn: "coleta", plate: "ABC1D23", ssw_user: "ayrton", domain: "ALT", branch: "OTI", ended_at: null });
    expect(o.units).toEqual(["ALT", "OTI", "BOT", "CGB"]);
    expect(Number(o.total_qty)).toBe(10);
    expect((await state()).screen).toBe("bipagem");

    // 1º volume aos 20 s, 2º aos 30 s, mais 2 de uma vez aos 50 s (20 s para 2 volumes)
    await send([
      { id: id(), at: at(20), type: "progress", fn: "coleta", plate: "ABC1D23", read: tot(1) },
      { id: id(), at: at(30), type: "progress", fn: "coleta", plate: "ABC1D23", read: tot(2) },
    ]);
    await send([{ id: id(), at: at(50), type: "progress", fn: "coleta", plate: "ABC1D23", read: tot(4) }]);
    o = await op();
    expect(o.scans).toBe(4);
    expect(Number(o.read_qty)).toBe(4);
    expect(Number(o.read_value)).toBe(4 * 199);
    expect(new Date(o.first_scan_at).getTime()).toBe(at(20));
    expect(new Date(o.last_scan_at).getTime()).toBe(at(50));
    // intervalos: 10 s (1 volume) + 20 s (2 volumes) = 30 s em 3 volumes
    expect(Number(o.scan_interval_sum_ms)).toBe(30_000);
    expect(o.scan_interval_count).toBe(3);

    await send([{ id: id(), at: at(90), type: "op_end", fn: "coleta", plate: "ABC1D23", reason: "concluded" }]);
    o = await op();
    expect(o.end_reason).toBe("concluded");
    expect(new Date(o.ended_at).getTime()).toBe(at(90));
    const s = await state();
    expect(s.operation_id).toBeNull();
    expect(s.ssw_user).toBe("ayrton");
  });

  it("recarregar a mesma descarga continua a operação; outra placa encerra a anterior", async () => {
    await send([{ id: id(), at: at(0), type: "op_start", fn: "manifesto", plate: "AAA1234", total: tot(5) }]);
    const first = await op();
    await send([{ id: id(), at: at(10), type: "op_start", fn: "manifesto", plate: "AAA1234", total: tot(6), read: tot(1) }]);
    expect((await op()).id).toBe(first.id);
    expect(Number((await op()).total_qty)).toBe(6);
    await send([{ id: id(), at: at(20), type: "op_start", fn: "romaneio", plate: "BBB9876", total: tot(3) }]);
    const prev = (await t.db.query("SELECT end_reason FROM ops_operations WHERE id = $1", [first.id])).rows[0];
    expect(prev.end_reason).toBe("replaced");
    expect((await op()).plate).toBe("BBB9876");
  });

  it("progresso sem início (app reiniciado no meio) abre a operação; sair do SSW encerra", async () => {
    await send([{ id: id(), at: at(0), type: "progress", fn: "coleta", plate: "CCC1111", read: tot(3), total: tot(8) }]);
    const o = await op();
    expect(o).toMatchObject({ plate: "CCC1111", scans: 0 });
    expect(Number(o.total_qty)).toBe(8);
    await send([{ id: id(), at: at(30), type: "session", user: null }]);
    expect((await op()).end_reason).toBe("left");
    expect((await state()).screen).toBe("login");
  });

  it("eventos fora de ordem no lote são aplicados pela hora do aparelho", async () => {
    await send([
      { id: id(), at: at(20), type: "progress", fn: "coleta", plate: "DDD2222", read: tot(1) },
      { id: id(), at: at(0), type: "op_start", fn: "coleta", plate: "DDD2222", total: tot(4) },
    ]);
    const o = await op();
    expect(new Date(o.started_at).getTime()).toBe(at(0));
    expect(o.scans).toBe(1);
  });

  it("heartbeat atualiza a tela e o 'vivo' do coletor", async () => {
    await send([{ id: id(), at: at(0), type: "heartbeat", screen: "menu", user: "joao" }]);
    const s = await state();
    expect(s).toMatchObject({ screen: "menu", ssw_user: "joao" });
    expect(new Date(s.last_heartbeat_at).getTime()).toBe(at(0));
  });
});

describe("eventos do leitor do SSW: abuso", () => {
  it("o mesmo evento reenviado (lote novo) não conta de novo", async () => {
    const start = { id: id(), at: at(0), type: "op_start", fn: "coleta", plate: "EEE3333", total: tot(5) };
    const p1 = { id: id(), at: at(10), type: "progress", fn: "coleta", plate: "EEE3333", read: tot(1) };
    await send([start, p1]);
    const again = await send([start, p1, { id: id(), at: at(20), type: "progress", fn: "coleta", plate: "EEE3333", read: tot(2) }]);
    expect(again.json).toMatchObject({ accepted: 1, duplicates: 2 });
    expect((await op()).scans).toBe(2);
    expect(Number((await t.db.query("SELECT count(*) FROM ops_events")).rows[0].count)).toBe(3);
  });

  it("lote capturado e reenviado (mesma hora e assinatura) é recusado", async () => {
    const r = await send([{ id: id(), at: at(0), type: "heartbeat", screen: "menu" }]);
    expect(r.status).toBe(200);
    const replay = await send([], { ts: r.ts, body: r.body });
    expect(replay.status).toBe(409);
  });

  it("assinatura errada, token de outro, conteúdo alterado ou aparelho removido: 401", async () => {
    const ev = [{ id: id(), at: at(0), type: "heartbeat", screen: "menu" }];
    expect((await send(ev, { signature: "0".repeat(64) })).status).toBe(401);
    expect((await send(ev, { token: "token-de-outro" })).status).toBe(401);
    // assina um corpo e manda outro
    const ts = (lastTs += 1000);
    const signed = JSON.stringify({ schema: 1, events: ev });
    const tampered = JSON.stringify({ schema: 1, events: [{ ...ev[0], screen: "bipagem" }] });
    expect((await send([], { ts, body: tampered, signature: signBatch(sha256hex(token), ts, signed) })).status).toBe(401);
    expect((await send(ev, { device: crypto.randomUUID() })).status).toBe(401);
    // sem cabeçalhos
    const bare = await t.app.inject({ method: "POST", url: "/v1/device/events", payload: { schema: 1, events: ev } });
    expect(bare.statusCode).toBe(401);
    expect((await t.db.query("SELECT count(*) FROM ops_events")).rows[0].count).toBe("0");
  });

  it("relógio do aparelho muito fora: 401 com a hora do servidor (o app corrige)", async () => {
    const r = await send([{ id: id(), at: at(0), type: "heartbeat", screen: "menu" }], { ts: Date.now() - 10 * 60_000 });
    expect(r.status).toBe(401);
    expect(r.json.error).toBe("clock_skew");
    expect(Math.abs(r.json.serverTime - Date.now())).toBeLessThan(5000);
  });

  it("formato inválido, versão desconhecida, lote grande demais: recusados", async () => {
    expect((await send([{ id: id(), at: at(0), type: "desconhecido" }])).status).toBe(400);
    expect((await send([], { body: JSON.stringify({ schema: 2, events: [{ id: id(), at: at(0), type: "heartbeat", screen: "menu" }] }) })).status).toBe(400);
    expect((await send([{ id: "nao-e-uuid", at: at(0), type: "heartbeat", screen: "menu" }])).status).toBe(400);
    expect((await send([{ id: id(), at: at(0), type: "progress", fn: "coleta", plate: "X", read: { qty: -1, kg: 0, value: 0 } }])).status).toBe(400);
    const many = Array.from({ length: 201 }, () => ({ id: id(), at: at(0), type: "heartbeat", screen: "menu" }));
    expect((await send(many)).status).toBe(400);
    const huge = [{ id: id(), at: at(0), type: "session", user: "x".repeat(70_000) }];
    expect((await send(huge)).status).toBe(413);
    expect((await send([], { body: "{nao é json" })).status).toBe(400);
  });

  it("aparelho removido no painel deixa de mandar eventos", async () => {
    const code = (await t.api("POST", "/v1/admin/enrollments", { name: "Lote 2" })).json.code;
    const other = await t.api("POST", "/v1/device/enroll", { code, info: info("OPS2") }, "");
    const ev = [{ id: id(), at: at(0), type: "heartbeat", screen: "menu" }];
    expect((await send(ev, { device: other.json.deviceId, token: other.json.token })).status).toBe(200);
    expect((await t.api("DELETE", `/v1/admin/devices/${other.json.deviceId}`)).status).toBe(200);
    expect((await send([{ ...ev[0], id: id() }], { device: other.json.deviceId, token: other.json.token })).status).toBe(401);
  });

  it("limite de envios por coletor", async () => {
    let limited = 0;
    for (let i = 0; i < 125; i++) {
      const r = await send([{ id: id(), at: at(i), type: "heartbeat", screen: "menu" }]);
      if (r.status === 429) limited++;
    }
    expect(limited).toBeGreaterThan(0);
  });
});
