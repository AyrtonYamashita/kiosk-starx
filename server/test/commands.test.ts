import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { makeTestApk } from "./apk-fixture.js";
import { info, setupApi } from "./helpers.js";

let t: Awaited<ReturnType<typeof setupApi>>;
let deviceId: string;
let deviceToken: string;
let otherId: string;

beforeAll(async () => {
  t = await setupApi();
  const code = (await t.api("POST", "/v1/admin/enrollments", { name: "Lote" })).json.code;
  const r = await t.api("POST", "/v1/device/enroll", { code, info: info("CMD1") }, "");
  deviceId = r.json.deviceId;
  deviceToken = r.json.token;
  otherId = (await t.api("POST", "/v1/device/enroll", { code, info: info("CMD2") }, "")).json.deviceId;
});
afterAll(async () => t?.close());

const checkin = (body: object = {}) => t.api("POST", "/v1/device/checkin", { info: info("CMD1"), ...body }, deviceToken);
const history = async () => (await t.api("GET", `/v1/admin/devices/${deviceId}/commands`)).json;

async function upload(apk: Buffer, opts: { token?: string; label?: string; origin?: string } = {}) {
  const token = opts.token ?? (await t.api("POST", "/v1/admin/apps/upload-token")).json.token;
  const res = await t.app.inject({
    method: "POST",
    url: `/v1/upload/apk${opts.label ? `?label=${encodeURIComponent(opts.label)}` : ""}`,
    payload: apk,
    headers: { "content-type": "application/octet-stream", "x-upload-token": token, ...(opts.origin ? { origin: opts.origin } : {}) },
  });
  return { status: res.statusCode, json: res.json(), headers: res.headers, token };
}

describe("comandos", () => {
  it("valida tipo e conteúdo", async () => {
    expect((await t.api("POST", "/v1/admin/commands", { deviceIds: [deviceId], type: "format_c" })).status).toBe(400);
    const r = await t.api("POST", "/v1/admin/commands", { deviceIds: [deviceId], type: "message", payload: { text: "" } });
    expect(r.status).toBe(400);
    expect(r.json.message).toMatch(/text/);
    const k = await t.api("POST", "/v1/admin/commands", { deviceIds: [deviceId], type: "uninstall_app", payload: { packageName: "com.pstarx.kiosk" } });
    expect(k.status).toBe(400);
    const missing = await t.api("POST", "/v1/admin/commands", { deviceIds: [deviceId], type: "install_app", payload: { packageName: "com.nao.existe" } });
    expect(missing.status).toBe(400);
  });

  it("entrega no check-in, reenvia até o resultado e registra o resultado", async () => {
    const c = await t.api("POST", "/v1/admin/commands", { deviceIds: [deviceId, otherId], type: "message", payload: { title: "Aviso", text: "Reunião às 15h" } });
    expect(c.json.created).toBe(2);

    let r = await checkin();
    expect(r.json.commands).toHaveLength(1);
    const cmd = r.json.commands[0];
    expect(cmd).toMatchObject({ type: "message", payload: { title: "Aviso", text: "Reunião às 15h" } });
    expect((await history()).commands[0].status).toBe("sent");

    // sem resultado: vem de novo (o aparelho ignora pelo id)
    r = await checkin();
    expect(r.json.commands.map((x: { id: string }) => x.id)).toEqual([cmd.id]);

    r = await checkin({ commandResults: [{ id: cmd.id, ok: true, message: "exibida" }] });
    expect(r.json.ackResults).toEqual([cmd.id]);
    expect(r.json.commands).toEqual([]);
    expect((await history()).commands[0]).toMatchObject({ status: "ok", message: "exibida" });

    // segundo resultado do mesmo comando (lida) atualiza
    await checkin({ commandResults: [{ id: cmd.id, ok: true, message: "lida", output: { ackAt: "2026-11-14T10:00:00Z" } }] });
    expect((await history()).commands[0]).toMatchObject({ status: "ok", message: "lida", output: { ackAt: "2026-11-14T10:00:00Z" } });
  });

  it("resultado de comando de outro aparelho é ignorado", async () => {
    const other = (await t.api("GET", `/v1/admin/devices/${otherId}/commands`)).json.commands[0];
    await checkin({ commandResults: [{ id: other.id, ok: false, message: "invasor" }] });
    expect((await t.api("GET", `/v1/admin/devices/${otherId}/commands`)).json.commands[0].status).toBe("pending");
  });

  it("falha fica registrada", async () => {
    await t.api("POST", "/v1/admin/commands", { deviceIds: [deviceId], type: "reboot" });
    const cmd = (await checkin()).json.commands[0];
    await checkin({ commandResults: [{ id: cmd.id, ok: false, message: "não é Device Owner" }] });
    expect((await history()).commands[0]).toMatchObject({ type: "reboot", status: "failed", message: "não é Device Owner" });
  });

  it("cancelar só antes da entrega", async () => {
    const id = (await t.api("POST", "/v1/admin/commands", { deviceIds: [deviceId], type: "lock" })).json.ids[0];
    expect((await t.api("POST", `/v1/admin/commands/${id}/cancel`)).status).toBe(200);
    expect((await checkin()).json.commands).toEqual([]);
    expect((await t.api("POST", `/v1/admin/commands/${id}/cancel`)).status).toBe(409);
  });

  it("expira sem contato a tempo", async () => {
    const id = (await t.api("POST", "/v1/admin/commands", { deviceIds: [deviceId], type: "screenshot" })).json.ids[0];
    await t.db.query("UPDATE commands SET expires_at = now() - interval '1 minute' WHERE id = $1", [id]);
    expect((await checkin()).json.commands).toEqual([]);
    const c = (await history()).commands.find((x: { id: string }) => x.id === id);
    expect(c).toMatchObject({ status: "expired", message: "o aparelho não fez contato a tempo" });
  });

  it("captura de tela: o aparelho envia, o painel baixa; guarda só as últimas", async () => {
    const id = (await t.api("POST", "/v1/admin/commands", { deviceIds: [deviceId], type: "screenshot" })).json.ids[0];
    const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(500, 7)]);
    const send = () =>
      t.app.inject({
        method: "POST",
        url: `/v1/device/screenshots?commandId=${id}&width=720&height=1280`,
        payload: jpeg,
        headers: { "content-type": "image/jpeg", authorization: `Bearer ${deviceToken}` },
      });
    const noAuth = await t.app.inject({ method: "POST", url: "/v1/device/screenshots", payload: jpeg, headers: { "content-type": "image/jpeg" } });
    expect(noAuth.statusCode).toBe(401);
    const up = await send();
    expect(up.statusCode).toBe(200);
    const shotId = up.json().id;
    const img = await t.app.inject({ method: "GET", url: `/v1/admin/screenshots/${shotId}`, headers: { authorization: `Bearer ${t.adminToken}` } });
    expect(img.headers["content-type"]).toBe("image/jpeg");
    expect(img.rawPayload.equals(jpeg)).toBe(true);
    expect((await t.app.inject({ method: "GET", url: `/v1/admin/screenshots/${shotId}` })).statusCode).toBe(401);

    for (let i = 0; i < 11; i++) await send();
    const h = await history();
    expect(h.screenshots).toHaveLength(10);
    expect(h.screenshots[0]).toMatchObject({ width: 720, height: 1280 });
  });
});

describe("repositório de apps", () => {
  const v1 = makeTestApk({ packageName: "com.exemplo.coletor", versionCode: 1, versionName: "1.0", cert: "CERT-A" });
  const v2 = makeTestApk({ packageName: "com.exemplo.coletor", versionCode: 2, versionName: "1.1", cert: "CERT-A" });

  it("envio com token de uso único e CORS só para o painel", async () => {
    const r = await upload(v1, { label: "Coletor", origin: "http://localhost:3000" });
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ packageName: "com.exemplo.coletor", versionCode: 1, versionName: "1.0", sizeBytes: v1.length });
    expect(r.headers["access-control-allow-origin"]).toBe("http://localhost:3000");
    expect(fs.existsSync(path.join(t.apkDir, "apps", `${r.json.sha256}.apk`))).toBe(true);

    // token já usado
    expect((await upload(v2, { token: r.token })).status).toBe(401);
    expect((await upload(v2, { token: "inventado" })).status).toBe(401);
    // origem estranha não recebe CORS
    const evil = await upload(v2, { origin: "https://malicioso.exemplo" });
    expect(evil.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("recusa arquivo que não é APK, assinatura diferente e versão repetida com outro arquivo", async () => {
    expect((await upload(Buffer.from("não sou um zip"))).status).toBe(400);
    const kiosk = await upload(makeTestApk({ packageName: "com.pstarx.kiosk", versionCode: 99 }));
    expect(kiosk.status).toBe(400);
    expect(kiosk.json.error).toBe("kiosk_app");
    const otherCert = await upload(makeTestApk({ packageName: "com.exemplo.coletor", versionCode: 3, cert: "CERT-B" }));
    expect(otherCert.status).toBe(409);
    expect(otherCert.json.error).toBe("signature_mismatch");
    const dup = await upload(makeTestApk({ packageName: "com.exemplo.coletor", versionCode: 1, versionName: "outra", cert: "CERT-A" }));
    expect(dup.status).toBe(409);
    expect(dup.json.error).toBe("duplicate_version");
    // mesmo arquivo de novo: tudo bem
    expect((await upload(v1)).json.alreadyExisted).toBe(true);
  });

  it("lista com versões e uso", async () => {
    const r = await t.api("GET", "/v1/admin/apps");
    expect(r.json.apps).toHaveLength(1);
    expect(r.json.apps[0]).toMatchObject({ packageName: "com.exemplo.coletor", label: "Coletor" });
    expect(r.json.apps[0].versions.map((v: { versionCode: number }) => v.versionCode)).toEqual([2, 1]);
  });

  it("perfil com apps gerenciados: o check-in traz a versão mais nova, e o aparelho baixa com o próprio token", async () => {
    const bad = await t.api("POST", "/v1/admin/profiles", { name: "P-ruim", config: {}, managedApps: ["com.nao.existe"] });
    expect(bad.status).toBe(400);
    const p = await t.api("POST", "/v1/admin/profiles", { name: "Coletores", config: { kiosk: { enabled: true } }, managedApps: ["com.exemplo.coletor"] });
    expect(p.json.managedApps).toEqual(["com.exemplo.coletor"]);
    await t.api("PUT", `/v1/admin/devices/${deviceId}/config`, { profileId: p.json.id });

    const r = await checkin({ appVersionCode: 5 });
    expect(r.json.apps).toHaveLength(1);
    const a = r.json.apps[0];
    expect(a).toMatchObject({ packageName: "com.exemplo.coletor", versionCode: 2, sizeBytes: v2.length });
    expect(a.url).toMatch(/^\/v1\/device\/apps\/[0-9a-f-]+\/apk$/);

    const dl = await t.app.inject({ method: "GET", url: a.url, headers: { authorization: `Bearer ${deviceToken}` } });
    expect(dl.statusCode).toBe(200);
    expect(dl.rawPayload.equals(v2)).toBe(true);
    expect((await t.app.inject({ method: "GET", url: a.url })).statusCode).toBe(401);

    // situação informada pelo aparelho aparece no painel
    await checkin({ managedStatus: { "com.exemplo.coletor": { versionCode: 2, error: null, at: "2026-11-14T10:00:00Z" } } });
    const d = (await t.api("GET", `/v1/admin/devices/${deviceId}`)).json;
    expect(d.managedApps).toEqual(["com.exemplo.coletor"]);
    expect(d.managedStatus["com.exemplo.coletor"].versionCode).toBe(2);

    // não dá para tirar do repositório enquanto um perfil usa
    expect((await t.api("DELETE", "/v1/admin/apps/com.exemplo.coletor")).status).toBe(409);
    // PUT sem managedApps mantém a lista
    await t.api("PUT", `/v1/admin/profiles/${p.json.id}`, { name: "Coletores", config: { kiosk: { enabled: true } } });
    expect((await t.api("GET", `/v1/admin/profiles/${p.json.id}`)).json.managedApps).toEqual(["com.exemplo.coletor"]);
  });

  it("comando de instalação leva a versão escolhida", async () => {
    const c = await t.api("POST", "/v1/admin/commands", { deviceIds: [deviceId], type: "install_app", payload: { packageName: "com.exemplo.coletor", versionCode: 1 } });
    expect(c.status).toBe(200);
    const cmd = (await checkin()).json.commands.find((x: { id: string }) => x.id === c.json.ids[0]);
    expect(cmd.payload.artifact).toMatchObject({ packageName: "com.exemplo.coletor", versionCode: 1, sizeBytes: v1.length });
  });

  it("app do kiosk se atualiza quando há versão publicada mais nova", async () => {
    const apk = Buffer.from("apk do kiosk");
    fs.writeFileSync(path.join(t.apkDir, "starx-kiosk-9.apk"), apk);
    // versão 9 publicada para todos
    await t.db.query(
      "INSERT INTO kiosk_versions (version_code, version_name, file, sha256, size_bytes, signature_checksum) VALUES (9, '0.9.0', 'starx-kiosk-9.apk', $1, $2, 'x')",
      ["ab".repeat(32), apk.length],
    );
    await t.db.query("INSERT INTO release_channels (kind, channel, ref) VALUES ('kiosk', 'all', '9') ON CONFLICT (kind, channel) DO UPDATE SET ref = '9'");
    const old = await checkin({ appVersionCode: 5 });
    expect(old.json.apps.find((a: { packageName: string }) => a.packageName === "com.pstarx.kiosk")).toMatchObject({ versionCode: 9, url: "/apks/starx-kiosk-9.apk" });
    const current = await checkin({ appVersionCode: 9 });
    expect(current.json.apps.find((a: { packageName: string }) => a.packageName === "com.pstarx.kiosk")).toBeUndefined();
  });

  it("remover versão e app (fora dos perfis) apaga o arquivo", async () => {
    const list = (await t.api("GET", "/v1/admin/apps")).json.apps[0];
    const v1sha = list.versions.find((v: { versionCode: number }) => v.versionCode === 1).sha256;
    expect((await t.api("DELETE", "/v1/admin/apps/com.exemplo.coletor/versions/1")).status).toBe(200);
    expect(fs.existsSync(path.join(t.apkDir, "apps", `${v1sha}.apk`))).toBe(false);
    const profiles = (await t.api("GET", "/v1/admin/profiles")).json.profiles;
    for (const p of profiles) await t.api("PUT", `/v1/admin/profiles/${p.id}`, { name: p.name, config: {}, managedApps: [] });
    expect((await t.api("DELETE", "/v1/admin/apps/com.exemplo.coletor")).status).toBe(200);
    expect((await t.api("GET", "/v1/admin/apps")).json.apps).toEqual([]);
  });
});

describe("lista de aparelhos", () => {
  it("traz MAC, rede, tempo ligado e o usuário logado (integração futura)", async () => {
    const i = info("CMD1");
    await checkin({
      info: { ...i, uptimeMs: 3_600_000, network: { ...i.network, wifiMac: "aa:bb:cc:dd:ee:ff" }, session: { user: "joao.silva" } },
    });
    const d = (await t.api("GET", "/v1/admin/devices")).json.devices.find((x: { id: string }) => x.id === deviceId);
    expect(d.network).toMatchObject({ ssid: "LOJA", mac: "aa:bb:cc:dd:ee:ff", ip: "192.168.0.10" });
    expect(d.uptimeMs).toBe(3_600_000);
    expect(d.loggedUser).toBe("joao.silva");
    await checkin();
    const e = (await t.api("GET", "/v1/admin/devices")).json.devices.find((x: { id: string }) => x.id === deviceId);
    expect(e.loggedUser).toBeNull();
  });
});
