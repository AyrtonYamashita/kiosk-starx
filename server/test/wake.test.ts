import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { info, setupApi } from "./helpers.js";

let t: Awaited<ReturnType<typeof setupApi>>;
let deviceId: string;
let deviceToken: string;

beforeAll(async () => {
  t = await setupApi();
  const code = (await t.api("POST", "/v1/admin/enrollments", { name: "Lote" })).json.code;
  const r = await t.api("POST", "/v1/device/enroll", { code, info: info("WAKE1") }, "");
  deviceId = r.json.deviceId;
  deviceToken = r.json.token;
});
afterAll(async () => t?.close());

const wait = (timeoutSec: number) =>
  t.app.inject({ method: "GET", url: `/v1/device/wait?timeoutSec=${timeoutSec}`, headers: { authorization: `Bearer ${deviceToken}` } }).then((r) => ({ status: r.statusCode, json: r.json() }));

describe("aviso imediato (long polling)", () => {
  it("sem nada a fazer: espera o tempo pedido e responde wake=false", async () => {
    const t0 = Date.now();
    const r = await wait(1);
    expect(r.json).toEqual({ wake: false });
    expect(Date.now() - t0).toBeGreaterThanOrEqual(900);
  });

  it("comando criado durante a espera acorda o aparelho na hora", async () => {
    const t0 = Date.now();
    const waiting = wait(30);
    await new Promise((r) => setTimeout(r, 200));
    await t.api("POST", "/v1/admin/commands", { deviceIds: [deviceId], type: "lock" });
    const r = await waiting;
    expect(r.json).toEqual({ wake: true });
    expect(Date.now() - t0).toBeLessThan(5000);
  });

  it("comando ainda não entregue: responde na hora, sem esperar", async () => {
    const t0 = Date.now();
    expect((await wait(30)).json).toEqual({ wake: true });
    expect(Date.now() - t0).toBeLessThan(2000);
    // o check-in entrega o comando; depois disso a espera volta a segurar
    await t.api("POST", "/v1/device/checkin", { info: info("WAKE1") }, deviceToken);
    expect((await wait(1)).json).toEqual({ wake: false });
  });

  it("mudar a configuração (perfil/ajustes/reaplicar) também acorda", async () => {
    const waiting = wait(30);
    await new Promise((r) => setTimeout(r, 200));
    await t.api("POST", `/v1/admin/devices/${deviceId}/config/reapply`);
    expect((await waiting).json).toEqual({ wake: true });

    const p = (await t.api("POST", "/v1/admin/profiles", { name: "P", config: { kiosk: { enabled: true } } })).json;
    await t.api("PUT", `/v1/admin/devices/${deviceId}/config`, { profileId: p.id });
    const waiting2 = wait(30);
    await new Promise((r) => setTimeout(r, 200));
    await t.api("PUT", `/v1/admin/profiles/${p.id}`, { name: "P", config: { kiosk: { enabled: false } } });
    expect((await waiting2).json).toEqual({ wake: true });
  });

  it("sem token: 401", async () => {
    const r = await t.app.inject({ method: "GET", url: "/v1/device/wait" });
    expect(r.statusCode).toBe(401);
  });
});
