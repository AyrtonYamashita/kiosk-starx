import crypto from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { sha256hex, signBatch } from "../src/ops.js";
import { info, setupApi } from "./helpers.js";

let t: Awaited<ReturnType<typeof setupApi>>;
let base: string;
let deviceId: string;
let token: string;
let lastTs = Date.now() - 60_000;
const id = () => crypto.randomUUID();
const tot = (qty: number) => ({ qty, kg: qty * 4, value: qty * 199.5 });

async function send(events: object[], dev = { id: deviceId, token }) {
  const ts = (lastTs = Math.max(lastTs + 1, Date.now()));
  const body = JSON.stringify({ schema: 1, events });
  const res = await fetch(`${base}/v1/device/events`, {
    method: "POST",
    body,
    headers: { "content-type": "application/json", "x-device-id": dev.id, "x-ts": String(ts), "x-signature": signBatch(sha256hex(dev.token), ts, body) },
  });
  expect(res.status).toBe(200);
}

/** Abre a conexão ao vivo e junta os eventos recebidos. */
async function openStream(ticket: string, origin = "http://localhost:3000") {
  const ctrl = new AbortController();
  const res = await fetch(`${base}/v1/ops/stream?ticket=${encodeURIComponent(ticket)}`, { headers: { origin }, signal: ctrl.signal });
  const events: { event: string; data: any; at: number }[] = [];
  if (res.ok && res.body) {
    (async () => {
      const reader = res.body!.getReader();
      const dec = new TextDecoder();
      let buf = "";
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          let i;
          while ((i = buf.indexOf("\n\n")) >= 0) {
            const block = buf.slice(0, i);
            buf = buf.slice(i + 2);
            const ev = /^event: (.+)$/m.exec(block)?.[1];
            const data = /^data: (.+)$/m.exec(block)?.[1];
            if (ev && data) events.push({ event: ev, data: JSON.parse(data), at: Date.now() });
          }
        }
      } catch {
        /* fechada */
      }
    })();
  }
  const waitFor = async (pred: (e: (typeof events)[number]) => boolean, ms = 3000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      const hit = events.find(pred);
      if (hit) return hit;
      await new Promise((r) => setTimeout(r, 10));
    }
    throw new Error("evento não chegou");
  };
  return { res, events, waitFor, close: () => ctrl.abort() };
}

const ticket = async (adminToken = t.adminToken) => (await t.api("POST", "/v1/admin/ops/stream-ticket", undefined, adminToken)).json;

beforeAll(async () => {
  t = await setupApi();
  base = await t.app.listen({ port: 0, host: "127.0.0.1" });
  const code = (await t.api("POST", "/v1/admin/enrollments", { name: "Lote" })).json.code;
  const r = await t.api("POST", "/v1/device/enroll", { code, info: info("LIVE1") }, "");
  deviceId = r.json.deviceId;
  token = r.json.token;
  expect((await t.api("PATCH", `/v1/admin/devices/${deviceId}`, { opsReader: true })).status).toBe(200);
});
beforeEach(async () => {
  await t.db.query("DELETE FROM ops_events");
  await t.db.query("DELETE FROM ops_operations");
  await t.db.query("DELETE FROM ops_device_state");
});
afterAll(async () => t?.close());

describe("tela ao vivo", () => {
  it("card com faltantes, tempo médio por volume e previsão de término", async () => {
    const t0 = Date.now() - 120_000;
    await send([
      { id: id(), at: t0, type: "session", user: "ayrton", domain: "ALT", branch: "OTI" },
      { id: id(), at: t0 + 1000, type: "op_start", fn: "coleta", plate: "ABC1D23", units: ["ALT", "OTI"], total: tot(10) },
      { id: id(), at: t0 + 10_000, type: "progress", fn: "coleta", plate: "ABC1D23", read: tot(1) },
      { id: id(), at: t0 + 16_000, type: "progress", fn: "coleta", plate: "ABC1D23", read: tot(2) },
      { id: id(), at: t0 + 30_000, type: "progress", fn: "coleta", plate: "ABC1D23", read: tot(4) },
    ]);
    const { cards } = (await t.api("GET", "/v1/admin/ops/cards")).json;
    const c = cards.find((x: { deviceId: string }) => x.deviceId === deviceId);
    expect(c).toMatchObject({ user: "ayrton", screen: "bipagem" });
    expect(c.operation).toMatchObject({ fn: "coleta", fnLabel: "Descarga de Coleta", plate: "ABC1D23", scans: 4 });
    expect(c.operation.missing.qty).toBe(6);
    expect(c.operation.missing.value).toBeCloseTo(6 * 199.5);
    // intervalos: 6 s (1 vol) + 14 s (2 vol) = 20 s / 3 = 6,7 s por volume
    expect(c.operation.avgSecPerVolume).toBeCloseTo(6.7, 1);
    // 6 faltantes × 6,67 s = 40 s depois da última bipagem
    expect(new Date(c.operation.etaAt).getTime() - (t0 + 30_000)).toBeCloseTo(40_000, -2);
  });

  it("ingresso: só com sessão, uso único; a tela recebe o estado e cada mudança em menos de 1 s", async () => {
    expect((await t.app.inject({ method: "POST", url: "/v1/admin/ops/stream-ticket" })).statusCode).toBe(401);
    expect((await openStream("ingresso-falso")).res.status).toBe(401);

    const tk = await ticket();
    expect(tk.url).toMatch(/\/v1\/ops\/stream$/);
    const s = await openStream(tk.ticket);
    expect(s.res.status).toBe(200);
    expect(s.res.headers.get("content-type")).toMatch(/text\/event-stream/);
    expect(s.res.headers.get("access-control-allow-origin")).toBe("http://localhost:3000");
    await s.waitFor((e) => e.event === "snapshot");
    // o mesmo ingresso não abre outra conexão
    expect((await openStream(tk.ticket)).res.status).toBe(401);

    const sentAt = Date.now();
    await send([{ id: id(), at: Date.now(), type: "op_start", fn: "romaneio", plate: "XYZ9K88", total: tot(3) }]);
    const card = await s.waitFor((e) => e.event === "card" && e.data.operation?.plate === "XYZ9K88");
    expect(card.at - sentAt).toBeLessThan(1000);

    // várias bipagens rápidas viram poucos avisos (junta em 150 ms), sempre com o número mais novo
    for (let i = 1; i <= 3; i++) await send([{ id: id(), at: Date.now(), type: "progress", fn: "romaneio", plate: "XYZ9K88", read: tot(i) }]);
    const last = await s.waitFor((e) => e.event === "card" && e.data.operation?.read.qty === 3);
    expect(last.at - sentAt).toBeLessThan(1500);
    s.close();
  });

  it("sessão encerrada: o ingresso emitido antes não abre a conexão", async () => {
    const login = await t.api("POST", "/v1/admin/login", { username: "admin", password: "senha-de-teste-123" }, "");
    const tk = await ticket(login.json.token);
    await t.api("POST", "/v1/admin/logout", undefined, login.json.token);
    expect((await openStream(tk.ticket)).res.status).toBe(401);
  });

  it("outro site não recebe permissão de leitura (CORS)", async () => {
    const s = await openStream((await ticket()).ticket, "https://golpe.io");
    expect(s.res.headers.get("access-control-allow-origin")).toBeNull();
    s.close();
  });

  it("aparelho removido some da tela", async () => {
    const code = (await t.api("POST", "/v1/admin/enrollments", { name: "Lote 2" })).json.code;
    const other = (await t.api("POST", "/v1/device/enroll", { code, info: info("LIVE2") }, "")).json;
    await t.api("PATCH", `/v1/admin/devices/${other.deviceId}`, { opsReader: true });
    await send([{ id: id(), at: Date.now(), type: "heartbeat", screen: "menu", user: "joao" }], { id: other.deviceId, token: other.token });
    const s = await openStream((await ticket()).ticket);
    await s.waitFor((e) => e.event === "snapshot");
    await t.api("DELETE", `/v1/admin/devices/${other.deviceId}`);
    const ev = await s.waitFor((e) => e.event === "removed");
    expect(ev.data.deviceId).toBe(other.deviceId);
    s.close();
  });

  it("detalhe: bipagens com intervalo, cargas de hoje e tempo do colaborador na função", async () => {
    const t0 = Date.now() - 60_000;
    await send([
      { id: id(), at: t0, type: "session", user: "maria", domain: "ALT", branch: "OTI" },
      { id: id(), at: t0 + 1000, type: "op_start", fn: "manifesto", plate: "MAN0001", total: tot(5) },
      { id: id(), at: t0 + 5000, type: "progress", fn: "manifesto", plate: "MAN0001", read: tot(1) },
      { id: id(), at: t0 + 12_000, type: "progress", fn: "manifesto", plate: "MAN0001", read: tot(3) },
      { id: id(), at: t0 + 20_000, type: "op_end", fn: "manifesto", plate: "MAN0001", reason: "concluded" },
      { id: id(), at: t0 + 25_000, type: "op_start", fn: "manifesto", plate: "MAN0002", total: tot(2) },
    ]);
    const d = (await t.api("GET", `/v1/admin/ops/devices/${deviceId}`)).json;
    expect(d.operation).toMatchObject({ plate: "MAN0002", user: "maria", endedAt: null });
    expect(d.today.map((o: { plate: string }) => o.plate)).toEqual(["MAN0002", "MAN0001"]);
    expect(d.today[1]).toMatchObject({ endReason: "concluded", durationSec: 19, readQty: 3, scans: 3 });
    expect(d.functionTimeTodaySec).toBeGreaterThanOrEqual(19 + 34);

    const past = (await t.api("GET", `/v1/admin/ops/devices/${deviceId}?op=${d.today[1].id}`)).json;
    expect(past.operation.plate).toBe("MAN0001");
    // mais nova primeiro: +2 volumes 7 s depois; o 1º volume não tem intervalo anterior
    expect(past.scans).toEqual([
      expect.objectContaining({ qty: 3, delta: 2, intervalSec: 7 }),
      expect.objectContaining({ qty: 1, delta: 1, intervalSec: null }),
    ]);
    expect((await t.api("GET", `/v1/admin/ops/devices/${crypto.randomUUID()}`)).status).toBe(404);
  });
});
