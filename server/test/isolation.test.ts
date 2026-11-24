import crypto from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sha256hex, signBatch } from "../src/ops.js";
import { makeTestApk } from "./apk-fixture.js";
import { addTenant, info, platformLogin, setupApi } from "./helpers.js";

/**
 * Fase 3.2: duas empresas na mesma instalação. A empresa B não vê nem mexe em nada da A (e vice-versa): listas só com
 * o que é dela, ids da outra dão 404, e o coletor, a tela ao vivo e as notificações também ficam separados.
 */
let t: Awaited<ReturnType<typeof setupApi>>;
let base: string;
let B: { tenantId: string; token: string };
const A: {
  token: string;
  tenantId: string;
  deviceId: string;
  deviceToken: string;
  profileId: string;
  codeId: string;
  commandId: string;
  screenshotId: string;
  userId: string;
  versionId: string;
} = {} as never;
let lastTs = Date.now() - 60_000;
const uid = () => crypto.randomUUID();
const tot = (qty: number) => ({ qty, kg: qty * 4, value: qty * 10 });

async function sendEvents(dev: { id: string; token: string }, events: object[]) {
  const ts = (lastTs = Math.max(lastTs + 1, Date.now()));
  const body = JSON.stringify({ schema: 1, events });
  const res = await t.app.inject({
    method: "POST",
    url: "/v1/device/events",
    payload: body,
    headers: { "content-type": "application/json", "x-device-id": dev.id, "x-ts": String(ts), "x-signature": signBatch(sha256hex(dev.token), ts, body) },
  });
  expect(res.statusCode).toBe(200);
}

async function uploadApk(token: string, apk: Buffer) {
  const up = (await t.api("POST", "/v1/admin/apps/upload-token", undefined, token)).json.token;
  const res = await t.app.inject({ method: "POST", url: "/v1/upload/apk", payload: apk, headers: { "content-type": "application/octet-stream", "x-upload-token": up } });
  return { status: res.statusCode, json: res.json() };
}

/** Abre a conexão ao vivo e junta os eventos recebidos. */
async function openStream(adminToken: string) {
  const ticket = (await t.api("POST", "/v1/admin/ops/stream-ticket", undefined, adminToken)).json.ticket;
  const ctrl = new AbortController();
  const res = await fetch(`${base}/v1/ops/stream?ticket=${encodeURIComponent(ticket)}`, { signal: ctrl.signal });
  const events: { event: string; data: any }[] = [];
  void (async () => {
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
          if (ev && data) events.push({ event: ev, data: JSON.parse(data) });
        }
      }
    } catch {
      /* fechada */
    }
  })();
  return { events, close: () => ctrl.abort() };
}

beforeAll(async () => {
  t = await setupApi();
  base = await t.app.listen({ port: 0, host: "127.0.0.1" });
  A.token = t.adminToken;
  A.tenantId = (await t.api("GET", "/v1/admin/me")).json.tenant.id;
  B = await addTenant(t, "transp-b");

  // empresa A: perfil, código, coletor com leitura do SSW, carga, comando, captura, app no repositório e um operador
  A.profileId = (await t.api("POST", "/v1/admin/profiles", { name: "Galpão", config: {} })).json.id;
  const code = (await t.api("POST", "/v1/admin/enrollments", { name: "Galpão", profileId: A.profileId })).json;
  A.codeId = code.id;
  const enr = await t.api("POST", "/v1/device/enroll", { code: code.code, info: info("ISO-A1") }, "");
  A.deviceId = enr.json.deviceId;
  A.deviceToken = enr.json.token;
  expect((await t.api("PATCH", `/v1/admin/devices/${A.deviceId}`, { opsReader: true })).status).toBe(200);
  const t0 = Date.now() - 60_000;
  await sendEvents({ id: A.deviceId, token: A.deviceToken }, [
    { id: uid(), at: t0, type: "session", user: "joana", domain: "ALT", branch: "OTI" },
    { id: uid(), at: t0 + 1000, type: "op_start", fn: "coleta", plate: "AAA1A11", total: tot(10), extra: { scan: { id: "s1", code: "7891000100", kind: "lido", ageMs: 0 } } },
  ]);
  A.commandId = (await t.api("POST", "/v1/admin/commands", { deviceIds: [A.deviceId], type: "lock" })).json.ids[0];
  const shot = await t.app.inject({
    method: "POST",
    url: "/v1/device/screenshots",
    payload: Buffer.alloc(200, 1),
    headers: { "content-type": "image/jpeg", authorization: `Bearer ${A.deviceToken}` },
  });
  A.screenshotId = shot.json().id;
  expect((await uploadApk(A.token, makeTestApk({ packageName: "com.exemplo.app", versionCode: 3, cert: "CHAVE-A" }))).status).toBe(200);
  A.versionId = (await t.api("GET", "/v1/admin/apps")).json.apps[0].versions[0].id;
  A.userId = (await t.api("POST", "/v1/admin/users", { username: "op.ana", email: "ana@a.com", role: "operator", password: "senha-da-ana-123" })).json.id;
});
afterAll(async () => t?.close());

describe("listas: cada empresa só vê o que é dela", () => {
  it("B não vê nada da A em nenhuma lista", async () => {
    const get = async (url: string) => {
      const r = await t.api("GET", url, undefined, B.token);
      expect({ url, status: r.status }).toEqual({ url, status: 200 });
      return r.json;
    };
    expect((await get("/v1/admin/devices")).devices).toEqual([]);
    expect((await get("/v1/admin/profiles")).profiles).toEqual([]);
    expect((await get("/v1/admin/enrollments")).enrollments).toEqual([]);
    expect((await get("/v1/admin/apps")).apps).toEqual([]);
    expect((await get("/v1/admin/apps-catalog")).apps).toEqual([]);
    expect((await get("/v1/admin/ops/cards")).cards).toEqual([]);
    expect((await get("/v1/admin/ops/operations")).operations).toEqual([]);
    expect((await get("/v1/admin/ops/operations")).users).toEqual([]);
    expect((await get("/v1/admin/ops/scans?code=7891000100")).results).toEqual([]);
    expect((await get("/v1/admin/ops/settings")).devices.total).toBe(0);
    expect((await get("/v1/admin/privacy/subjects")).subjects).toEqual([]);
    expect((await get("/v1/admin/users")).users.map((u: { username: string }) => u.username)).toEqual(["admin"]);
    expect((await get("/v1/admin/sessions?all=1")).sessions.every((s: { username: string }) => s.username === "admin")).toBe(true);
    const events = (await get("/v1/admin/security/events?limit=500")).events;
    expect(events.some((e: { username: string | null }) => e.username === "op.ana")).toBe(false);
    expect(events.some((e: { event: string; details: { userId?: string } | null }) => e.event === "user_created" && e.details?.userId === A.userId)).toBe(false);
    expect((await get("/v1/admin/kiosk-release")).devices).toEqual([]);

    // a A continua vendo o dela
    expect((await t.api("GET", "/v1/admin/devices")).json.devices.map((d: { id: string }) => d.id)).toEqual([A.deviceId]);
    expect((await t.api("GET", "/v1/admin/ops/cards")).json.cards).toHaveLength(1);
  });
});

describe("ids da outra empresa: 404 (nada muda)", () => {
  it("leitura, alteração e exclusão", async () => {
    const call = async (method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE", url: string, body?: unknown) =>
      (await t.api(method, url, body, B.token)).status;
    const d = A.deviceId;
    expect(await call("GET", `/v1/admin/devices/${d}`)).toBe(404);
    expect(await call("PATCH", `/v1/admin/devices/${d}`, { name: "roubado" })).toBe(404);
    expect(await call("PUT", `/v1/admin/devices/${d}/config`, { profileId: null })).toBe(404);
    expect(await call("POST", `/v1/admin/devices/${d}/config/reapply`)).toBe(404);
    expect(await call("GET", `/v1/admin/devices/${d}/commands`)).toBe(404);
    expect(await call("GET", `/v1/admin/ops/devices/${d}`)).toBe(404);
    expect(await call("GET", `/v1/admin/screenshots/${A.screenshotId}`)).toBe(404);
    expect(await call("POST", `/v1/admin/commands/${A.commandId}/cancel`)).not.toBe(200);
    expect(await call("GET", `/v1/admin/profiles/${A.profileId}`)).toBe(404);
    expect(await call("PUT", `/v1/admin/profiles/${A.profileId}`, { name: "x", config: {} })).toBe(404);
    expect(await call("DELETE", `/v1/admin/profiles/${A.profileId}`)).toBe(404);
    expect(await call("DELETE", `/v1/admin/enrollments/${A.codeId}`)).toBe(404);
    expect(await call("POST", `/v1/admin/enrollments/${A.codeId}/qr`, {})).toBe(404);
    expect(await call("PATCH", "/v1/admin/apps/com.exemplo.app", { label: "x" })).toBe(404);
    expect(await call("DELETE", "/v1/admin/apps/com.exemplo.app")).toBe(404);
    expect(await call("DELETE", "/v1/admin/apps/com.exemplo.app/versions/3")).toBe(404);
    expect(await call("PATCH", `/v1/admin/users/${A.userId}`, { disabled: true })).toBe(404);
    expect(await call("POST", `/v1/admin/users/${A.userId}/reset-mfa`)).toBe(404);
    expect(await call("GET", "/v1/admin/privacy/subjects/joana/export")).toBe(404);
    expect(await call("POST", "/v1/admin/privacy/subjects/joana/anonymize")).toBe(404);
    expect(await call("DELETE", `/v1/admin/devices/${d}`)).toBe(404);

    // comandos e perfil em lote com coletor da A: nada acontece
    expect(await call("POST", "/v1/admin/commands", { deviceIds: [d], type: "reboot" })).toBe(404);
    const bulk = await t.api("POST", "/v1/admin/devices/bulk/profile", { deviceIds: [d], profileId: null }, B.token);
    expect(bulk.json.updated).toBe(0);
    // perfil da A num código de cadastro da B
    expect(await call("POST", "/v1/admin/enrollments", { name: "x", profileId: A.profileId })).toBe(400);

    // tudo da A continua igual
    const dev = (await t.api("GET", `/v1/admin/devices/${d}`)).json;
    expect(dev).toMatchObject({ name: expect.not.stringMatching("roubado"), profileId: A.profileId });
    expect((await t.api("GET", "/v1/admin/apps")).json.apps).toHaveLength(1);
    expect((await t.api("GET", "/v1/admin/privacy/subjects")).json.subjects.map((s: { user: string }) => s.user)).toEqual(["joana"]);
    const ana = (await t.api("GET", "/v1/admin/users")).json.users.find((u: { id: string }) => u.id === A.userId);
    expect(ana.disabled).toBe(false);
    expect((await t.api("GET", `/v1/admin/devices/${d}/commands`)).json.commands[0].status).not.toBe("canceled");
  });

  it("sessões e bloqueios da outra empresa", async () => {
    const aSession = (await t.api("GET", "/v1/admin/sessions")).json.sessions[0].id;
    expect((await t.api("DELETE", `/v1/admin/sessions/${aSession}`, undefined, B.token)).status).toBe(404);
    // bloqueio da conta de um usuário da A: a B não vê nem desbloqueia
    await t.db.query("INSERT INTO auth_lockouts (kind, key, locked_until) VALUES ('account', 'op.ana', now() + interval '1 hour')");
    expect((await t.api("GET", "/v1/admin/security/lockouts", undefined, B.token)).json.lockouts).toEqual([]);
    expect((await t.api("POST", "/v1/admin/security/unlock", { kind: "account", key: "op.ana" }, B.token)).status).toBe(404);
    expect((await t.api("GET", "/v1/admin/security/lockouts")).json.lockouts.map((l: { key: string }) => l.key)).toContain("op.ana");
    await t.db.query("DELETE FROM auth_lockouts");
  });
});

describe("repositório de apps por empresa", () => {
  it("o mesmo pacote nas duas; o coletor só baixa da empresa dele; apagar numa não apaga o arquivo da outra", async () => {
    const apk = makeTestApk({ packageName: "com.exemplo.app", versionCode: 3, cert: "CHAVE-A" });
    // B envia o mesmo APK (mesmo arquivo): vira um app da B
    expect((await uploadApk(B.token, apk)).status).toBe(200);
    const vB = (await t.api("GET", "/v1/admin/apps", undefined, B.token)).json.apps[0].versions[0];
    expect(vB.id).not.toBe(A.versionId);

    // coletor da A não baixa a versão da B
    const dl = (id: string) => t.app.inject({ method: "GET", url: `/v1/device/apps/${id}/apk`, headers: { authorization: `Bearer ${A.deviceToken}` } });
    expect((await dl(vB.id)).statusCode).toBe(404);
    expect((await dl(A.versionId)).statusCode).toBe(200);

    // B apaga o app dela: o arquivo (o mesmo) continua para a A
    expect((await t.api("DELETE", "/v1/admin/apps/com.exemplo.app", undefined, B.token)).status).toBe(200);
    expect((await dl(A.versionId)).statusCode).toBe(200);
  });
});

describe("coletor", () => {
  it("cadastrado com o código de outra empresa: registro novo lá; aqui fica transferido e o token antigo para de valer", async () => {
    const codeB = (await t.api("POST", "/v1/admin/enrollments", { name: "B" }, B.token)).json.code;
    const enr = await t.api("POST", "/v1/device/enroll", { code: codeB, info: info("ISO-A1") }, "");
    expect(enr.status).toBe(200);
    expect(enr.json.deviceId).not.toBe(A.deviceId);
    // na B: um coletor novo, sem nada da A
    const listB = (await t.api("GET", "/v1/admin/devices", undefined, B.token)).json.devices;
    expect(listB.map((d: { id: string }) => d.id)).toEqual([enr.json.deviceId]);
    expect(listB[0].profileId).toBeNull();
    // na A: o registro (e o histórico) continua, marcado como transferido; o token antigo não vale mais
    const devA = (await t.api("GET", `/v1/admin/devices/${A.deviceId}`)).json;
    expect(devA.transferredAt).not.toBeNull();
    expect((await t.api("POST", "/v1/device/checkin", { info: info("ISO-A1") }, A.deviceToken)).status).toBe(401);
    expect((await t.api("GET", "/v1/admin/ops/operations")).json.operations).toHaveLength(1);

    // volta para a A com um código da A: reaproveita o registro de lá, sem a marca
    const codeA = (await t.api("POST", "/v1/admin/enrollments", { name: "A de novo" })).json.code;
    const back = await t.api("POST", "/v1/device/enroll", { code: codeA, info: info("ISO-A1") }, "");
    expect(back.json.deviceId).toBe(A.deviceId);
    A.deviceToken = back.json.token;
    expect((await t.api("GET", `/v1/admin/devices/${A.deviceId}`)).json.transferredAt).toBeNull();
    expect((await t.api("GET", `/v1/admin/devices/${enr.json.deviceId}`, undefined, B.token)).json.transferredAt).not.toBeNull();
  });

  it("leitura do SSW: a chave geral é de cada empresa", async () => {
    expect((await t.api("PUT", "/v1/admin/ops/settings", { readerAll: true }, B.token)).status).toBe(200);
    expect((await t.api("GET", "/v1/admin/ops/settings", undefined, B.token)).json.readerAll).toBe(true);
    expect((await t.api("GET", "/v1/admin/ops/settings")).json.readerAll).toBe(false);
  });
});

describe("tela ao vivo", () => {
  it("cada tela só recebe os cards da empresa dela", async () => {
    const sa = await openStream(A.token);
    const sb = await openStream(B.token);
    await new Promise((r) => setTimeout(r, 300));
    const snapB = sb.events.find((e) => e.event === "snapshot");
    expect(snapB?.data.cards).toEqual([]);
    expect(sa.events.find((e) => e.event === "snapshot")?.data.cards).toHaveLength(1);

    await sendEvents({ id: A.deviceId, token: A.deviceToken }, [{ id: uid(), at: Date.now(), type: "heartbeat", screen: "menu", user: "joana" }]);
    const end = Date.now() + 2000;
    while (Date.now() < end && !sa.events.some((e) => e.event === "card")) await new Promise((r) => setTimeout(r, 20));
    expect(sa.events.some((e) => e.event === "card" && e.data.deviceId === A.deviceId)).toBe(true);
    expect(sb.events.some((e) => e.event === "card")).toBe(false);
    sa.close();
    sb.close();
  });
});

describe("login e plataforma", () => {
  it("o mesmo nome de usuário em duas empresas: entra na conta cuja senha confere", async () => {
    const c = await addTenant(t, "transp-c");
    await t.db.query("UPDATE admins SET password_hash = (SELECT password_hash FROM admins WHERE username = 'op.ana') WHERE tenant_id = $1", [c.tenantId]);
    // "admin" com a senha da A → A; com a senha do admin da C → C
    const a = await t.api("POST", "/v1/admin/login", { username: "admin", password: "senha-de-teste-123" }, "");
    expect((await t.api("GET", "/v1/admin/me", undefined, a.json.token)).json.tenant.id).toBe(A.tenantId);
    const cl = await t.api("POST", "/v1/admin/login", { username: "admin", password: "senha-da-ana-123" }, "");
    expect(cl.status).toBe(200);
    expect((await t.api("GET", "/v1/admin/me", undefined, cl.json.token)).json.tenant.id).toBe(c.tenantId);
    expect((await t.api("POST", "/v1/admin/login", { username: "admin", password: "nenhuma-das-duas" }, "")).status).toBe(401);
  });

  it("usuário da plataforma: conta funciona, dados de empresa não", async () => {
    const p = await platformLogin(t);
    expect((await t.api("GET", "/v1/admin/me", undefined, p)).json).toMatchObject({ platform: true, tenant: null });
    for (const url of ["/v1/admin/devices", "/v1/admin/profiles", "/v1/admin/ops/cards", "/v1/admin/users", "/v1/admin/privacy/subjects"]) {
      expect({ url, status: (await t.api("GET", url, undefined, p)).status }).toEqual({ url, status: 403 });
    }
    expect((await t.api("GET", "/v1/admin/sessions", undefined, p)).status).toBe(200);
    expect((await t.api("GET", "/v1/admin/push", undefined, p)).status).toBe(200);
    // app do kiosk: a plataforma vê os coletores de todas as empresas
    const k = (await t.api("GET", "/v1/admin/kiosk-release", undefined, p)).json;
    expect(k.devices.reduce((n: number, d: { devices: number }) => n + d.devices, 0)).toBeGreaterThanOrEqual(2);
  });
});
