import crypto from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sha256hex, signBatch } from "../src/ops.js";
import { pruneOpsEvents } from "../src/opsRetention.js";
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

/** Envelhece os eventos (como se tivessem chegado há `days` dias). */
const age = (ids: string[], days: number) =>
  t.db.query("UPDATE ops_events SET received_at = now() - make_interval(days => $2) WHERE id = ANY($1::uuid[])", [ids, days]);
const count = async (type?: string) =>
  Number((await t.db.query("SELECT count(*) FROM ops_events WHERE device_id = $1 AND ($2::text IS NULL OR type = $2)", [deviceId, type ?? null])).rows[0].count);
const detail = async (op?: string) => (await t.api("GET", `/v1/admin/ops/devices/${deviceId}${op ? `?op=${op}` : ""}`)).json;

beforeAll(async () => {
  t = await setupApi();
  const code = (await t.api("POST", "/v1/admin/enrollments", { name: "Limpeza" })).json.code;
  const r = await t.api("POST", "/v1/device/enroll", { code, info: info("RET1") }, "");
  deviceId = r.json.deviceId;
  token = r.json.token;
  await t.api("PATCH", `/v1/admin/devices/${deviceId}`, { opsReader: true });
});
afterAll(async () => t?.close());

describe("limpeza dos eventos do SSW (2.5)", () => {
  it("apaga sinal de vida velho e eventos de 90+ dias; a carga e o gráfico dela ficam", async () => {
    const T0 = Date.now() - 20 * 60_000;
    const at = (s: number) => T0 + s * 1000;
    // carga antiga: início, 3 bipagens (uma repetida, sem aumento), fim
    const old = [
      { id: id(), at: at(0), type: "session", user: "maria", domain: "ALT", branch: "OTI" },
      { id: id(), at: at(1), type: "op_start", fn: "coleta", plate: "OLD1A11", total: tot(5) },
      { id: id(), at: at(4), type: "progress", fn: "coleta", plate: "OLD1A11", read: tot(1) },
      { id: id(), at: at(6), type: "progress", fn: "coleta", plate: "OLD1A11", read: tot(1) },
      { id: id(), at: at(9), type: "progress", fn: "coleta", plate: "OLD1A11", read: tot(3) },
      { id: id(), at: at(12), type: "op_end", fn: "coleta", plate: "OLD1A11", reason: "concluded" },
    ];
    await send(old);
    const oldOp = (await t.db.query("SELECT id FROM ops_operations WHERE plate = 'OLD1A11'")).rows[0].id as string;
    const before = await detail(oldOp);
    expect(before.scans.map((s: { qty: number }) => s.qty)).toEqual([3, 1]);

    // sinais de vida: um de 8 dias, um de ontem
    const hbOld = { id: id(), at: at(13), type: "heartbeat", screen: "menu" };
    const hbNew = { id: id(), at: at(14), type: "heartbeat", screen: "menu" };
    await send([hbOld, hbNew]);
    await age([hbOld.id], 8);
    await age([hbNew.id], 1);

    // carga nova (não envelhece)
    await send([
      { id: id(), at: at(20), type: "op_start", fn: "manifesto", plate: "NEW2B22", total: tot(2) },
      { id: id(), at: at(25), type: "progress", fn: "manifesto", plate: "NEW2B22", read: tot(1) },
    ]);
    await age(old.map((e) => e.id), 91);

    const total = await count();
    const r = await pruneOpsEvents(t.db, { eventDays: 90, heartbeatDays: 7, batch: 2 });
    expect(r).toEqual({ heartbeats: 1, curves: 1, events: old.length });
    expect(await count()).toBe(total - old.length - 1);
    expect(await count("heartbeat")).toBe(1);

    // a carga continua com o mesmo gráfico (agora guardado nela)
    const saved = (await t.db.query("SELECT scan_curve, scans, read_qty FROM ops_operations WHERE id = $1", [oldOp])).rows[0];
    expect(saved.scan_curve).toEqual([
      [at(1), 0],
      [at(4), 1],
      [at(9), 3],
    ]);
    expect(Number(saved.read_qty)).toBe(3);
    const after = await detail(oldOp);
    expect(after.scans).toEqual(before.scans);
    expect(after.operation).toMatchObject({ plate: "OLD1A11", endReason: "concluded" });

    // a carga nova não foi tocada; rodar de novo não faz nada
    expect((await detail()).scans.map((s: { qty: number }) => s.qty)).toEqual([1]);
    expect(await pruneOpsEvents(t.db, { eventDays: 90, heartbeatDays: 7 })).toEqual({ heartbeats: 0, curves: 0, events: 0 });
  });

  it("carga que continuou depois da limpeza: gráfico guardado + bipagens novas", async () => {
    const T0 = Date.now() - 10 * 60_000;
    const at = (s: number) => T0 + s * 1000;
    const first = [
      { id: id(), at: at(0), type: "op_start", fn: "romaneio", plate: "LONG3C33", total: tot(9) },
      { id: id(), at: at(3), type: "progress", fn: "romaneio", plate: "LONG3C33", read: tot(2) },
    ];
    await send(first);
    await age(first.map((e) => e.id), 95);
    await pruneOpsEvents(t.db, { eventDays: 90, heartbeatDays: 7 });
    await send([{ id: id(), at: at(10), type: "progress", fn: "romaneio", plate: "LONG3C33", read: tot(5) }]);
    const d = await detail();
    expect(d.operation.plate).toBe("LONG3C33");
    expect(d.scans.map((s: { qty: number; intervalSec: number | null }) => [s.qty, s.intervalSec])).toEqual([
      [5, 7],
      [2, null],
    ]);
  });
});
