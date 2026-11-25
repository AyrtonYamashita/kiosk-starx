import crypto from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sha256hex, signBatch } from "../src/ops.js";
import { notifyOps, scanErrorMessage } from "../src/opsPush.js";
import { closeStaleOps } from "../src/opsRetention.js";
import { Push, validEndpoint, type PushTarget } from "../src/push.js";
import { info, setupApi } from "./helpers.js";

const P256DH = "B" + "A".repeat(86); // 65 bytes em base64url
const AUTH = "C".repeat(22); // 16 bytes
const sub = (endpoint: string) => ({ endpoint, keys: { p256dh: P256DH, auth: AUTH } });
const FCM = (n: number) => `https://fcm.googleapis.com/fcm/send/aparelho-${n}`;

describe("endereços de push aceitos", () => {
  it("só os serviços de push dos navegadores, em https", () => {
    expect(validEndpoint("https://fcm.googleapis.com/fcm/send/abc")).toBe(true);
    expect(validEndpoint("https://web.push.apple.com/QGk")).toBe(true);
    expect(validEndpoint("https://updates.push.services.mozilla.com/wpush/v2/x")).toBe(true);
    expect(validEndpoint("https://wns2-bl2p.notify.windows.com/w/?token=x")).toBe(true);
    expect(validEndpoint("http://fcm.googleapis.com/fcm/send/abc")).toBe(false);
    expect(validEndpoint("https://127.0.0.1/fcm")).toBe(false);
    expect(validEndpoint("https://fcm.googleapis.com.evil.com/x")).toBe(false);
    expect(validEndpoint("https://fcm.googleapis.com:8443/x")).toBe(false);
    expect(validEndpoint("https://user@fcm.googleapis.com/x")).toBe(false);
    expect(validEndpoint("nada")).toBe(false);
  });
});

describe("notificações desligadas (sem chaves VAPID)", () => {
  let t: Awaited<ReturnType<typeof setupApi>>;
  beforeAll(async () => {
    t = await setupApi();
  });
  afterAll(async () => t.close());

  it("o painel vê desligado e a inscrição é recusada", async () => {
    const g = await t.api("GET", "/v1/admin/push");
    expect(g.json).toMatchObject({ enabled: false, publicKey: null, subscriptions: [] });
    expect((await t.api("POST", "/v1/admin/push/subscribe", sub(FCM(1)))).status).toBe(503);
  });
});

describe("notificações no celular", () => {
  let t: Awaited<ReturnType<typeof setupApi>>;
  const sent: { target: PushTarget; payload: Record<string, unknown> }[] = [];
  let reply = 201;
  beforeAll(async () => {
    t = await setupApi({
      config: { vapidPublicKey: "chave-publica-de-teste", vapidPrivateKey: "chave-privada-de-teste" },
      pushSender: async (target, payload) => {
        sent.push({ target, payload: JSON.parse(payload) });
        return reply;
      },
    });
  });
  afterAll(async () => t.close());

  it("exige sessão", async () => {
    expect((await t.api("GET", "/v1/admin/push", undefined, "x")).status).toBe(401);
  });

  it("inscreve, lista e envia o teste ao aparelho", async () => {
    expect((await t.api("POST", "/v1/admin/push/subscribe", sub("https://10.0.0.5/push"))).status).toBe(400);
    expect((await t.api("POST", "/v1/admin/push/subscribe", { endpoint: FCM(1), keys: { p256dh: "x", auth: AUTH } })).status).toBe(400);
    expect((await t.api("POST", "/v1/admin/push/subscribe", sub(FCM(1)))).status).toBe(200);
    expect((await t.api("POST", "/v1/admin/push/subscribe", sub(FCM(1)))).status).toBe(200); // de novo: não duplica
    const g = await t.api("GET", "/v1/admin/push");
    expect(g.json.enabled).toBe(true);
    expect(g.json.publicKey).toBe("chave-publica-de-teste");
    expect(g.json.events).toEqual(["start", "done", "stopped"]);
    expect(g.json.subscriptions.map((s: { endpoint: string }) => s.endpoint)).toEqual([FCM(1)]);

    const r = await t.api("POST", "/v1/admin/push/test");
    expect(r.json).toMatchObject({ ok: true, sent: 1, total: 1 });
    expect(sent.at(-1)).toMatchObject({ target: { endpoint: FCM(1), p256dh: P256DH, auth: AUTH }, payload: { url: "/operations", tag: "teste" } });
  });

  it("cada usuário escolhe os eventos; só recebe os escolhidos", async () => {
    const push = new Push(t.db, t.config, async (target, payload) => {
      sent.push({ target, payload: JSON.parse(payload) });
      return 201;
    });
    expect((await t.api("PUT", "/v1/admin/push/events", { events: ["xyz"] })).status).toBe(400);
    expect((await t.api("PUT", "/v1/admin/push/events", { events: ["stopped", "done"] })).json.events).toEqual(["done", "stopped"]);
    expect((await t.api("GET", "/v1/admin/push")).json.events).toEqual(["done", "stopped"]);

    const before = sent.length;
    const tenantId = (await t.db.query("SELECT tenant_id FROM admins WHERE username = 'admin'")).rows[0].tenant_id;
    await push.notify(tenantId, "start", { title: "joana iniciou Descarga", body: "ABC1D23", url: "/operations/x" });
    expect(sent.length).toBe(before);
    await push.notify(tenantId, "stopped", { title: "joana interrompeu Descarga", body: "ABC1D23", url: "/operations/x" });
    expect(sent.length).toBe(before + 1);
    expect(sent.at(-1)!.payload).toMatchObject({ title: "joana interrompeu Descarga", url: "/operations/x" });

    // usuário desativado não recebe nada
    await t.db.query("UPDATE admins SET disabled_at = now() WHERE username = 'admin'");
    await push.notify(tenantId, "stopped", { title: "x", body: "y", url: "/" });
    expect(sent.length).toBe(before + 1);
    await t.db.query("UPDATE admins SET disabled_at = NULL WHERE username = 'admin'");
    await t.api("PUT", "/v1/admin/push/events", { events: ["start", "done", "stopped"] });
  });

  it("inscrição cancelada no navegador (410) é apagada; falhas repetidas também", async () => {
    await t.api("POST", "/v1/admin/push/subscribe", sub(FCM(2)));
    reply = 410;
    await t.api("POST", "/v1/admin/push/test");
    expect((await t.api("GET", "/v1/admin/push")).json.subscriptions).toEqual([]);

    reply = 500;
    await t.api("POST", "/v1/admin/push/subscribe", sub(FCM(3)));
    await t.db.query("UPDATE push_subscriptions SET failures = 9");
    await t.api("POST", "/v1/admin/push/test");
    expect((await t.api("GET", "/v1/admin/push")).json.subscriptions).toEqual([]);
    reply = 201;
  });

  it("sair desliga só aquele aparelho", async () => {
    await t.api("POST", "/v1/admin/push/subscribe", sub(FCM(4)));
    await t.api("POST", "/v1/admin/push/subscribe", sub(FCM(5)));
    expect((await t.api("POST", "/v1/admin/push/unsubscribe", { endpoint: FCM(4) })).json.removed).toBe(1);
    expect((await t.api("GET", "/v1/admin/push")).json.subscriptions.map((s: { endpoint: string }) => s.endpoint)).toEqual([FCM(5)]);
  });
});

describe("notificações das cargas (enviadas pela API)", () => {
  let t: Awaited<ReturnType<typeof setupApi>>;
  let deviceId: string;
  let token: string;
  let lastTs = Date.now() - 60_000;
  const got: Record<string, unknown>[] = [];
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
    expect(res.json()).not.toHaveProperty("started"); // o coletor não recebe ids de carga
    await new Promise((r) => setTimeout(r, 150)); // envio em segundo plano
  }

  beforeAll(async () => {
    t = await setupApi({
      config: { vapidPublicKey: "pub", vapidPrivateKey: "priv" },
      pushSender: async (_t, payload) => {
        got.push(JSON.parse(payload));
        return 201;
      },
    });
    const code = (await t.api("POST", "/v1/admin/enrollments", { name: "Doca 3" })).json.code;
    const r = await t.api("POST", "/v1/device/enroll", { code, info: info("PSH1") }, "");
    deviceId = r.json.deviceId;
    token = r.json.token;
    await t.api("PATCH", `/v1/admin/devices/${deviceId}`, { opsReader: true });
    await t.api("POST", "/v1/admin/push/subscribe", sub(FCM(1)));
  });
  afterAll(async () => t.close());

  it("início, conclusão e interrupção, com o nome do colaborador; a mesma carga usa a mesma tag", async () => {
    const T = Date.now() - 60_000;
    await send([
      { id: id(), at: T, type: "session", user: "joana.lima", domain: "ALT", branch: "OTI" },
      { id: id(), at: T + 1000, type: "op_start", fn: "coleta", plate: "PSH1A11", total: tot(3) },
    ]);
    expect(got).toHaveLength(1);
    expect(got[0]).toMatchObject({ title: "joana.lima iniciou Descarga de Coleta", body: "PSH1A11 · 3 volumes · C6000 PSH1" });
    expect(got[0].url).toBe(`/operations/${deviceId}`);

    // a bipagem não notifica
    await send([{ id: id(), at: T + 2000, type: "progress", fn: "coleta", plate: "PSH1A11", read: tot(3) }]);
    expect(got).toHaveLength(1);

    await send([{ id: id(), at: T + 3000, type: "op_end", fn: "coleta", plate: "PSH1A11", reason: "concluded" }]);
    expect(got).toHaveLength(2);
    expect(got[1]).toMatchObject({ title: "joana.lima concluiu Descarga de Coleta", body: "PSH1A11 · 3/3 volumes · C6000 PSH1", tag: got[0].tag });
    expect(String(got[1].url).startsWith(`/operations/${deviceId}?op=`)).toBe(true);

    // aberta e interrompida no mesmo lote: só o fim, com o que faltou
    await send([
      { id: id(), at: T + 4000, type: "op_start", fn: "manifesto", plate: "PSH2B22", total: tot(5) },
      { id: id(), at: T + 5000, type: "progress", fn: "manifesto", plate: "PSH2B22", read: tot(2) },
      { id: id(), at: T + 6000, type: "op_end", fn: "manifesto", plate: "PSH2B22", reason: "interrupted" },
    ]);
    expect(got).toHaveLength(3);
    expect(got[2]).toMatchObject({ title: "joana.lima interrompeu Descarga de Manifesto", body: "PSH2B22 · 2/5 volumes · faltaram 3 · C6000 PSH1" });
  });

  it("respeita a escolha: sem \"carga iniciada\", só chegam os fins", async () => {
    await t.api("PUT", "/v1/admin/push/events", { events: ["done", "stopped"] });
    const before = got.length;
    const T = Date.now() - 30_000;
    await send([{ id: id(), at: T, type: "op_start", fn: "romaneio", plate: "PSH3C33", total: tot(1) }]);
    expect(got.length).toBe(before);
    // sair do SSW com a carga aberta
    await send([{ id: id(), at: T + 1000, type: "session", user: null }]);
    expect(got.length).toBe(before + 1);
    expect(got.at(-1)).toMatchObject({ title: "joana.lima saiu de Descarga de Romaneio sem concluir" });
  });

  it("coletor sem sinal: a carga encerrada pela API também notifica", async () => {
    await t.api("PUT", "/v1/admin/push/events", { events: ["start", "done", "stopped"] });
    const T = Date.now() - 20_000;
    await send([
      { id: id(), at: T, type: "session", user: "joana.lima", domain: "ALT", branch: "OTI" },
      { id: id(), at: T + 1000, type: "op_start", fn: "coleta", plate: "PSH4D44", total: tot(2) },
    ]);
    const before = got.length;
    await t.db.query("UPDATE ops_device_state SET last_event_at = now() - interval '3 hours', last_heartbeat_at = now() - interval '3 hours' WHERE device_id = $1", [deviceId]);
    const { operations } = await closeStaleOps(t.db, 120);
    expect(operations).toHaveLength(1);
    const push = new Push(t.db, t.config, async (_t, payload) => {
      got.push(JSON.parse(payload));
      return 201;
    });
    await notifyOps(t.db, push, [], operations);
    expect(got.length).toBe(before + 1);
    expect(got.at(-1)).toMatchObject({ title: "joana.lima: Descarga de Coleta encerrada (coletor sem sinal)", body: "PSH4D44 · 0/2 volumes · faltaram 2 · C6000 PSH1" });
  });

  it("erro de bipagem: só para quem escolheu, com a mensagem do SSW, no máximo um por carga por minuto", async () => {
    const T = Date.now() - 10_000;
    const err = (sid: string, code: string, error: string, at: number) => ({
      id: id(),
      at,
      type: "progress",
      fn: "coleta",
      plate: "PSH5E55",
      read: tot(0),
      extra: { scan: { id: sid, code, kind: "erro", ageMs: 0, error } },
    });
    await send([
      { id: id(), at: T, type: "session", user: "joana.lima", domain: "ALT", branch: "OTI" },
      { id: id(), at: T + 100, type: "op_start", fn: "coleta", plate: "PSH5E55", total: tot(4) },
    ]);
    // quem não escolheu (padrão) não recebe erro de bipagem
    let before = got.length;
    await send([err("x1", "111", "Código não pertence / não localizado na empresa", T + 200)]);
    expect(got.length).toBe(before);

    await t.api("PUT", "/v1/admin/push/events", { events: ["start", "done", "stopped", "scan_error"] });
    expect((await t.api("GET", "/v1/admin/push")).json.events).toContain("scan_error");
    before = got.length;
    await send([err("x2", "222", "CTRC 99 já foi lido", T + 300)]);
    expect(got.length).toBe(before + 1);
    expect(got.at(-1)).toMatchObject({
      title: "joana.lima: erro na Descarga de Coleta (2 na carga)",
      body: "CTRC 99 já foi lido · código 222 · PSH5E55 · C6000 PSH1",
    });
    expect(String(got.at(-1)!.tag).startsWith("err-")).toBe(true);
    // outro erro da mesma carga logo em seguida: não notifica de novo (fica no contador)
    await send([err("x3", "333", "CTRC 98 já foi lido", T + 400)]);
    expect(got.length).toBe(before + 1);
  });
});

describe("texto do aviso de erro de bipagem", () => {
  it("sem carga e sem mensagem ainda faz sentido", () => {
    const m = scanErrorMessage({
      id: "1",
      tenant_id: "t",
      device_id: "d",
      device_name: "C1",
      code: "123",
      error: null,
      op_id: null,
      fn: null,
      plate: null,
      real_plate: null,
      ssw_user: null,
      scan_errors: null,
    });
    expect(m).toEqual({ title: "Alguém: erro na bipagem", body: "código recusado · código 123 · sem placa · C1", url: "/operations/d", tag: "err-d" });
  });
});
