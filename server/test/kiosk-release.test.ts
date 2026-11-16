import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { makeTestApk } from "./apk-fixture.js";
import { info, setupApi } from "./helpers.js";

let t: Awaited<ReturnType<typeof setupApi>>;
let deviceToken: string;

beforeAll(async () => {
  t = await setupApi();
  const code = (await t.api("POST", "/v1/admin/enrollments", { name: "Lote" })).json.code;
  deviceToken = (await t.api("POST", "/v1/device/enroll", { code, info: info("REL1") }, "")).json.token;
});
afterAll(async () => t?.close());

const kiosk = (versionCode: number, cert = "CHAVE-RELEASE") => makeTestApk({ packageName: "com.pstarx.kiosk", versionCode, versionName: `0.${versionCode}.0`, cert });

async function upload(apk: Buffer) {
  const token = (await t.api("POST", "/v1/admin/apps/upload-token")).json.token;
  const res = await t.app.inject({
    method: "POST",
    url: "/v1/upload/kiosk-apk",
    payload: apk,
    headers: { "content-type": "application/octet-stream", "x-upload-token": token, origin: "http://localhost:3000" },
  });
  return { status: res.statusCode, json: res.json(), headers: res.headers };
}

const status = async () => (await t.api("GET", "/v1/admin/kiosk-release")).json;
const kioskUpdate = async (appVersionCode: number) =>
  (await t.api("POST", "/v1/device/checkin", { info: info("REL1"), appVersionCode }, deviceToken)).json.apps.find(
    (a: { packageName: string }) => a.packageName === "com.pstarx.kiosk",
  );

describe("publicação do app do kiosk pelo painel", () => {
  it("primeira versão: fica pendente e não chega aos aparelhos antes de publicar", async () => {
    const r = await upload(kiosk(5));
    expect(r.status).toBe(200);
    expect(r.headers["access-control-allow-origin"]).toBe("http://localhost:3000");
    expect(r.json.pending).toMatchObject({ versionCode: 5, file: "starx-kiosk-5.apk" });
    const s = await status();
    expect(s.release).toBeNull();
    expect(s.pending.versionCode).toBe(5);
    expect(s.pendingUploadedBy).toBe("admin");
    expect(await kioskUpdate(4)).toBeUndefined();
  });

  it("publicar vira o release.json: aparelhos mais velhos recebem; QR também usa", async () => {
    const r = await t.api("POST", "/v1/admin/kiosk-release/publish");
    expect(r.status).toBe(200);
    expect(r.json.release.versionCode).toBe(5);
    expect(fs.existsSync(path.join(t.apkDir, "pending.json"))).toBe(false);
    expect((await status()).pending).toBeNull();
    expect(await kioskUpdate(4)).toMatchObject({ versionCode: 5, url: "/apks/starx-kiosk-5.apk" });
    expect(await kioskUpdate(5)).toBeUndefined();
    expect((await t.api("POST", "/v1/admin/kiosk-release/publish")).status).toBe(404);
  });

  it("recusa outra assinatura, versão não mais nova e outro pacote", async () => {
    const other = await upload(kiosk(6, "OUTRA-CHAVE"));
    expect(other.status).toBe(409);
    expect(other.json.error).toBe("signature_mismatch");
    const same = await upload(kiosk(5));
    expect(same.status).toBe(409);
    expect(same.json.error).toBe("not_newer");
    const app = await upload(makeTestApk({ packageName: "com.exemplo.app", versionCode: 9, cert: "CHAVE-RELEASE" }));
    expect(app.status).toBe(400);
    expect(app.json.error).toBe("not_kiosk");
  });

  it("descartar a pendente apaga o arquivo e mantém a publicada", async () => {
    expect((await upload(kiosk(6))).status).toBe(200);
    expect(fs.existsSync(path.join(t.apkDir, "starx-kiosk-6.apk"))).toBe(true);
    expect((await t.api("DELETE", "/v1/admin/kiosk-release/pending")).status).toBe(200);
    expect(fs.existsSync(path.join(t.apkDir, "starx-kiosk-6.apk"))).toBe(false);
    const s = await status();
    expect(s.pending).toBeNull();
    expect(s.release.versionCode).toBe(5);
    expect(s.devices.some((d: { versionCode: number }) => d.versionCode === 5)).toBe(true);
  });

  it("o repositório de apps manda o kiosk para cá", async () => {
    const token = (await t.api("POST", "/v1/admin/apps/upload-token")).json.token;
    const res = await t.app.inject({ method: "POST", url: "/v1/upload/apk", payload: kiosk(7), headers: { "content-type": "application/octet-stream", "x-upload-token": token } });
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toMatch(/App do kiosk/);
  });
});
