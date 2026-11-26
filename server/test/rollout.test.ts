import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyDue } from "../src/rollout.js";
import { makeTestApk } from "./apk-fixture.js";
import { info, platformLogin, setupApi } from "./helpers.js";

let t: Awaited<ReturnType<typeof setupApi>>;
let plat: string;
const dev: Record<"pilot" | "normal", { deviceId: string; token: string }> = {} as never;

beforeAll(async () => {
  t = await setupApi();
  plat = await platformLogin(t);
  for (const k of ["pilot", "normal"] as const) {
    const code = (await t.api("POST", "/v1/admin/enrollments", { name: k })).json.code;
    dev[k] = (await t.api("POST", "/v1/device/enroll", { code, info: info(`ROL-${k}`) }, "")).json;
  }
  expect((await t.api("PATCH", `/v1/admin/devices/${dev.pilot.deviceId}`, { pilot: true })).status).toBe(200);
});
afterAll(async () => t?.close());

const NOTES = { notes: ["Alerta de outra placa", "Confirmação de 3 s"], reversible: false, reversibleNote: "muda o formato da fila" };

async function upload(versionCode: number, releaseNotes?: unknown) {
  const token = (await t.api("POST", "/v1/admin/apps/upload-token", undefined, plat)).json.token;
  const apk = makeTestApk({ packageName: "com.pstarx.kiosk", versionCode, versionName: `0.${versionCode}.0`, cert: "CHAVE", releaseNotes });
  const res = await t.app.inject({ method: "POST", url: "/v1/upload/kiosk-apk", payload: apk, headers: { "content-type": "application/octet-stream", "x-upload-token": token } });
  return res.statusCode;
}
const publish = (body: object, token = plat) => t.api("POST", "/v1/admin/releases/publish", body, token);
const view = async () => (await t.api("GET", "/v1/admin/releases", undefined, plat)).json;
const checkin = async (d: { token: string }, appVersionCode = 1) =>
  (await t.api("POST", "/v1/device/checkin", { appVersionCode }, d.token)).json as {
    apps: { packageName: string; versionCode: number }[];
    reader: { sha256: string } | null;
  };
const kioskOf = async (d: { token: string }) => (await checkin(d)).apps.find((a) => a.packageName === "com.pstarx.kiosk")?.versionCode ?? null;

describe("app do kiosk: pilotos e todos", () => {
  it("enviada não chega a ninguém; notas e 'pode voltar' vêm do APK", async () => {
    expect(await upload(10, NOTES)).toBe(200);
    expect(await kioskOf(dev.pilot)).toBeNull();
    expect(await kioskOf(dev.normal)).toBeNull();
    const v = (await view()).kiosk;
    expect(v.all).toBeNull();
    expect(v.versions[0]).toMatchObject({ versionCode: 10, notes: NOTES.notes, reversible: false, reversibleNote: NOTES.reversibleNote, uploadedBy: "plataforma" });
  });

  it("para todos: todos recebem e o release.json (QR) acompanha", async () => {
    expect((await publish({ kind: "kiosk", channel: "all", ref: "10" }, t.adminToken)).status).toBe(403); // só a plataforma
    expect((await publish({ kind: "kiosk", channel: "all", ref: "10" })).status).toBe(200);
    expect(await kioskOf(dev.pilot)).toBe(10);
    expect(await kioskOf(dev.normal)).toBe(10);
    expect(JSON.parse(fs.readFileSync(path.join(t.apkDir, "release.json"), "utf8")).versionCode).toBe(10);
  });

  it("para os pilotos: só o piloto recebe; depois para todos, o canal dos pilotos some", async () => {
    expect(await upload(11)).toBe(200);
    // os pilotos só recebem versão mais nova que a de todos
    expect((await publish({ kind: "kiosk", channel: "pilot", ref: "10" })).json.error).toBe("not_newer");
    expect((await publish({ kind: "kiosk", channel: "pilot", ref: "11" })).status).toBe(200);
    expect(await kioskOf(dev.pilot)).toBe(11);
    expect(await kioskOf(dev.normal)).toBe(10);
    expect((await view()).kiosk).toMatchObject({ all: 10, pilot: 11 });
    // versão publicada não pode ser descartada
    expect((await t.api("DELETE", "/v1/admin/releases/kiosk/11", undefined, plat)).json.error).toBe("in_use");
    expect((await publish({ kind: "kiosk", channel: "all", ref: "11" })).status).toBe(200);
    expect(await kioskOf(dev.normal)).toBe(11);
    expect((await view()).kiosk).toMatchObject({ all: 11, pilot: null });
    // todos não volta para uma versão mais velha (o Android não rebaixa)
    expect((await publish({ kind: "kiosk", channel: "all", ref: "10" })).json.error).toBe("not_newer");
  });

  it("desmarcar o piloto: volta para a versão de todos", async () => {
    expect(await upload(12)).toBe(200);
    expect((await publish({ kind: "kiosk", channel: "pilot", ref: "12" })).status).toBe(200);
    expect(await kioskOf(dev.pilot)).toBe(12);
    await t.api("PATCH", `/v1/admin/devices/${dev.pilot.deviceId}`, { pilot: false });
    expect(await kioskOf(dev.pilot)).toBe(11);
    await t.api("PATCH", `/v1/admin/devices/${dev.pilot.deviceId}`, { pilot: true });
    // abandonar o teste: os pilotos voltam à de todos
    expect((await t.api("DELETE", "/v1/admin/releases/pilot/kiosk", undefined, plat)).status).toBe(200);
    expect(await kioskOf(dev.pilot)).toBe(11);
    // e a 12, sem uso, pode ser descartada
    expect((await t.api("DELETE", "/v1/admin/releases/kiosk/12", undefined, plat)).status).toBe(200);
    expect((await view()).kiosk.versions.map((v: { versionCode: number }) => v.versionCode)).toEqual([11, 10]);
  });
});

describe("leitor do SSW: pilotos e todos", () => {
  it("o leitor deste deploy é o de todos; um leitor novo só chega a quem for publicado", async () => {
    const first = (await checkin(dev.normal)).reader!.sha256;
    expect((await view()).reader).toMatchObject({ all: first, pilot: null, deployed: first });
    // um deploy trouxe outro leitor
    const body = '(function(){ var VERSION = "2099-01-01.1"; })();';
    const sha = "f".repeat(64);
    await t.db.query("INSERT INTO reader_versions (sha256, version, body) VALUES ($1, '2099-01-01.1', $2)", [sha, body]);
    expect((await checkin(dev.pilot)).reader!.sha256).toBe(first);
    expect((await publish({ kind: "reader", channel: "pilot", ref: sha })).status).toBe(200);
    expect((await checkin(dev.pilot)).reader!.sha256).toBe(sha);
    expect((await checkin(dev.normal)).reader!.sha256).toBe(first);
    // o piloto baixa o leitor dele
    const r = await t.app.inject({ method: "GET", url: "/v1/device/reader", headers: { authorization: `Bearer ${dev.pilot.token}` } });
    expect(r.body).toBe(body);
    expect((await view()).reader.versions[0]).toMatchObject({ sha256: sha, version: "2099-01-01.1" });
  });
});

describe("agendamento", () => {
  it("aplica na hora marcada; dá para cancelar antes; hora passada é recusada", async () => {
    expect(await upload(13)).toBe(200);
    const soon = new Date(Date.now() + 60 * 60_000).toISOString();
    expect((await publish({ kind: "kiosk", channel: "all", ref: "13", at: new Date(Date.now() - 1000).toISOString() })).json.error).toBe("past");
    const s = await publish({ kind: "kiosk", channel: "all", ref: "13", at: soon });
    expect(s.status).toBe(200);
    expect(await kioskOf(dev.normal)).toBe(11);
    expect((await view()).schedules[0]).toMatchObject({ kind: "kiosk", channel: "all", ref: "13", doneAt: null });
    // ainda não é a hora
    expect(await applyDue(t.db, t.apkDir)).toBe(0);
    // chegou a hora
    expect(await applyDue(t.db, t.apkDir, new Date(Date.now() + 2 * 60 * 60_000))).toBe(1);
    expect(await kioskOf(dev.normal)).toBe(13);
    expect((await view()).schedules[0]).toMatchObject({ result: "publicado", doneAt: expect.any(String) });

    // cancelar
    expect(await upload(14)).toBe(200);
    const c = await publish({ kind: "kiosk", channel: "pilot", ref: "14", at: soon });
    expect((await t.api("DELETE", `/v1/admin/releases/schedules/${c.json.scheduled}`, undefined, plat)).status).toBe(200);
    expect((await t.api("DELETE", `/v1/admin/releases/schedules/${c.json.scheduled}`, undefined, plat)).status).toBe(404);
    expect(await applyDue(t.db, t.apkDir, new Date(Date.now() + 2 * 60 * 60_000))).toBe(0);
    expect(await kioskOf(dev.pilot)).toBe(13);
  });
});
