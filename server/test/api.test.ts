import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import type { Config } from "../src/config.js";
import { createPool, migrate, type Db } from "../src/db.js";
import { ensureAdmin } from "../src/routes/admin.js";

const DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgres://kiosk:kiosk@127.0.0.1:5434/kiosk";
const schema = `test_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
const apkDir = fs.mkdtempSync(path.join(os.tmpdir(), "kiosk-apks-"));

const config: Config = {
  port: 0,
  databaseUrl: DATABASE_URL,
  dbSchema: schema,
  publicUrl: "https://kiosk-api.exemplo.com",
  apkDir,
  appsDir: path.join(apkDir, "apps"),
  panelOrigins: ["http://localhost:3000"],
  autoUpdateApp: true,
  maxApkMb: 5,
  adminUsername: "admin",
  adminPassword: "senha-de-teste-123",
  checkinIntervalSec: 60,
  authRequire2fa: false,
  authSecret: "segredo-de-teste-com-mais-de-32-caracteres-123",
  mailFrom: "StarX Kiosk <no-reply@pstarx.com>",
  otpTtlMin: 10,
  trustDays: 30,
    webauthnRpId: "localhost",
    webauthnOrigins: ["http://localhost:3000"],
  sessionTtlHours: 48,
  sessionIdleHours: 8,
  opsRetentionDays: 90,
  opsHeartbeatRetentionDays: 7,
    opsScanRetentionDays: 365,
    opsSignalLostMin: 120,
    retention: {
      operationIdentifiedDays: 365,
      screenshotDays: 7,
      commandDays: 180,
      authEventDays: 365,
      authUnknownDays: 30,
      adminDisabledDays: 365,
    },
  trustProxy: false,
  logLevel: "silent",
  timeZone: "America/Cuiaba",
};

let db: Db;
let app: FastifyInstance;
let adminToken: string;

const info = (serial: string) => ({
  hardware: { manufacturer: "chainway", model: "C6000", serialNumber: serial, androidVersion: "10", imeis: ["8665"] },
  battery: { level: 43, charging: true },
  network: { type: "wifi", wifi: { ssid: "LOJA", rssi: -58 }, ipAddresses: ["192.168.0.10"] },
  app: { versionName: "0.2.0", isDeviceOwner: true, kioskActive: true, configRevision: 3 },
});

async function api(method: "GET" | "POST" | "PATCH" | "DELETE", url: string, body?: unknown, token = adminToken) {
  const res = await app.inject({ method, url, payload: body as object, headers: token ? { authorization: `Bearer ${token}` } : {} });
  return { status: res.statusCode, json: res.body ? res.json() : null };
}

beforeAll(async () => {
  db = createPool(DATABASE_URL, schema);
  await migrate(db, schema);
  await ensureAdmin(db, config, { info: () => undefined });
  app = await buildApp(config, db);
  const login = await api("POST", "/v1/admin/login", { username: "admin", password: "senha-de-teste-123" }, "");
  expect(login.status).toBe(200);
  adminToken = login.json.token;
});

afterAll(async () => {
  await app?.close();
  await db?.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  await db?.end();
  fs.rmSync(apkDir, { recursive: true, force: true });
});

describe("sessão do painel", () => {
  it("recusa senha errada e rotas sem token", async () => {
    expect((await api("POST", "/v1/admin/login", { username: "admin", password: "errada" }, "")).status).toBe(401);
    expect((await api("POST", "/v1/admin/login", { username: "ninguem", password: "x" }, "")).status).toBe(401);
    expect((await api("GET", "/v1/admin/devices", undefined, "")).status).toBe(401);
    expect((await api("GET", "/v1/admin/devices", undefined, "token-falso")).status).toBe(401);
  });

  it("me e migrações idempotentes", async () => {
    expect((await api("GET", "/v1/admin/me")).json.username).toBe("admin");
    expect(await migrate(db, schema)).toEqual([]);
  });

  it("troca de senha derruba as outras sessões", async () => {
    const other = (await api("POST", "/v1/admin/login", { username: "admin", password: "senha-de-teste-123" }, "")).json.token;
    expect((await api("POST", "/v1/admin/password", { current: "errada", next: "nova-senha-123" })).status).toBe(400);
    expect((await api("POST", "/v1/admin/password", { current: "senha-de-teste-123", next: "curta" })).status).toBe(400);
    expect((await api("POST", "/v1/admin/password", { current: "senha-de-teste-123", next: "nova-senha-123" })).status).toBe(200);
    expect((await api("GET", "/v1/admin/me", undefined, other)).status).toBe(401);
    expect((await api("GET", "/v1/admin/me")).status).toBe(200);
  });
});

describe("cadastro e check-in", () => {
  let code: string;
  let codeId: string;
  let deviceToken: string;
  let deviceId: string;

  it("cria código de cadastro com limite de usos", async () => {
    const r = await api("POST", "/v1/admin/enrollments", { name: "Loja 1", maxUses: 2, expiresInDays: 30, initialConfig: { kiosk: { enabled: true } } });
    expect(r.status).toBe(200);
    expect(r.json.code).toMatch(/^[A-Z2-9]{10}$/);
    expect(r.json.status).toBe("active");
    code = r.json.code;
    codeId = r.json.id;
  });

  it("recusa código inválido", async () => {
    const r = await api("POST", "/v1/device/enroll", { code: "NAOEXISTE1", info: info("S1") }, "");
    expect(r.status).toBe(403);
  });

  it("cadastra o aparelho (código em minúsculas também vale)", async () => {
    const r = await api("POST", "/v1/device/enroll", { code: code.toLowerCase(), appVersion: "0.2.0", info: info("H6000A1") }, "");
    expect(r.status).toBe(200);
    expect(r.json.name).toBe("C6000 00A1");
    expect(r.json.checkinIntervalSec).toBe(60);
    deviceToken = r.json.token;
    deviceId = r.json.deviceId;
  });

  it("check-in sem token é recusado", async () => {
    expect((await api("POST", "/v1/device/checkin", { info: info("H6000A1") }, "")).status).toBe(401);
    expect((await api("POST", "/v1/device/checkin", { info: info("H6000A1") }, "outro")).status).toBe(401);
  });

  it("check-in completo grava inventário, apps e configuração (sem o hash do PIN)", async () => {
    const r = await api(
      "POST",
      "/v1/device/checkin",
      {
        appVersion: "0.2.0",
        info: info("H6000A1"),
        apps: [{ packageName: "com.android.chrome", label: "Chrome" }],
        appsHash: "abc",
        config: { kiosk: { enabled: true, mode: "apps" }, security: { pinHash: { algo: "x", hash: "segredo" } } },
        configRevision: 7,
        configSource: "local",
      },
      deviceToken,
    );
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ appsHash: "abc", configRevision: 7, name: "C6000 00A1" });

    const d = (await api("GET", `/v1/admin/devices/${deviceId}`)).json;
    expect(d.online).toBe(true);
    expect(d.serial).toBe("H6000A1");
    expect(d.apps).toHaveLength(1);
    expect(d.config.security.pinHash).toBe("<definido>");
    expect(JSON.stringify(d)).not.toContain("segredo");
    expect(d.configSource).toBe("local");
  });

  it("check-in leve não apaga apps nem configuração", async () => {
    const r = await api("POST", "/v1/device/checkin", { info: info("H6000A1") }, deviceToken);
    expect(r.json).toMatchObject({ appsHash: "abc", configRevision: 7 });
    const list = (await api("GET", "/v1/admin/devices")).json;
    expect(list.devices).toHaveLength(1);
    expect(list.devices[0]).toMatchObject({ online: true, kioskMode: "apps", kioskEnabled: true, configRevision: 7, battery: { level: 43 } });
    expect(list.devices[0].network).toMatchObject({ type: "wifi", ssid: "LOJA", ip: "192.168.0.10" });
  });

  it("renomeia, e nome vazio volta ao nome padrão do cadastro", async () => {
    expect((await api("PATCH", `/v1/admin/devices/${deviceId}`, { name: "" })).status).toBe(200);
    expect((await api("GET", `/v1/admin/devices/${deviceId}`)).json.name).toBe("C6000 00A1");
    expect((await api("PATCH", `/v1/admin/devices/${deviceId}`, { name: "Doca 3" })).status).toBe(200);
    expect((await api("GET", `/v1/admin/devices/${deviceId}`)).json.name).toBe("Doca 3");
  });

  it("recadastro do mesmo serial reaproveita o registro e invalida o token antigo", async () => {
    const r = await api("POST", "/v1/device/enroll", { code, info: info("H6000A1") }, "");
    expect(r.status).toBe(200);
    expect(r.json.deviceId).toBe(deviceId);
    expect(r.json.name).toBe("Doca 3");
    expect((await api("POST", "/v1/device/checkin", {}, deviceToken)).status).toBe(401);
    deviceToken = r.json.token;
    // o servidor esqueceu apps/configuração: o app reenvia
    expect((await api("POST", "/v1/device/checkin", {}, deviceToken)).json).toMatchObject({ appsHash: null, configRevision: null });
  });

  it("cadastro sem serial (logo após o QR) é unificado ao registro antigo quando o serial aparece", async () => {
    const c = (await api("POST", "/v1/admin/enrollments", { name: "Sem serial" })).json;
    const noSerial = { ...info("x"), hardware: { model: "C6000", serialNumber: null } };
    const r = await api("POST", "/v1/device/enroll", { code: c.code, info: noSerial }, "");
    expect(r.status).toBe(200);
    expect(r.json.deviceId).not.toBe(deviceId);
    expect((await api("GET", "/v1/admin/devices")).json.devices).toHaveLength(2);
    // primeiro check-in com serial: herda o nome "Doca 3" e o registro antigo some
    const ck = await api("POST", "/v1/device/checkin", { info: info("H6000A1") }, r.json.token);
    expect(ck.json.name).toBe("Doca 3");
    const list = (await api("GET", "/v1/admin/devices")).json.devices;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: r.json.deviceId, name: "Doca 3", serial: "H6000A1" });
    const e = (await api("GET", "/v1/admin/enrollments")).json.enrollments.find((x: { id: string }) => x.id === c.id);
    expect(e.uses).toBe(0);
    // o token antigo não vale mais; os testes seguintes usam o novo registro
    expect((await api("POST", "/v1/device/checkin", {}, deviceToken)).status).toBe(401);
    deviceId = r.json.deviceId;
    deviceToken = r.json.token;
  });

  it("código esgotado (2 usos) recusa novos cadastros", async () => {
    expect((await api("POST", "/v1/device/enroll", { code, info: info("OUTRO") }, "")).status).toBe(403);
    const e = (await api("GET", "/v1/admin/enrollments")).json.enrollments.find((x: { id: string }) => x.id === codeId);
    // devices: 0 porque o aparelho foi recadastrado com outro código no teste anterior
    expect(e).toMatchObject({ uses: 2, status: "exhausted", devices: 0 });
  });

  it("código revogado recusa", async () => {
    const c = (await api("POST", "/v1/admin/enrollments", { name: "Revogar" })).json;
    expect((await api("DELETE", `/v1/admin/enrollments/${c.id}`)).status).toBe(200);
    expect((await api("POST", "/v1/device/enroll", { code: c.code, info: info("X9") }, "")).status).toBe(403);
  });

  it("remover do painel invalida o token do aparelho", async () => {
    expect((await api("DELETE", `/v1/admin/devices/${deviceId}`)).status).toBe(200);
    expect((await api("POST", "/v1/device/checkin", {}, deviceToken)).status).toBe(401);
    expect((await api("GET", "/v1/admin/devices")).json.devices).toHaveLength(0);
  });
});

describe("QR de provisionamento", () => {
  it("sem APK publicado: 409", async () => {
    const c = (await api("POST", "/v1/admin/enrollments", { name: "QR" })).json;
    expect((await api("POST", `/v1/admin/enrollments/${c.id}/qr`, {})).status).toBe(409);
  });

  it("com APK publicado: payload com download, checksum, extras e Wi-Fi", async () => {
    fs.writeFileSync(path.join(apkDir, "starx-kiosk-2.apk"), "apk");
    fs.writeFileSync(
      path.join(apkDir, "release.json"),
      JSON.stringify({ packageName: "com.pstarx.kiosk", versionCode: 2, versionName: "0.2.0", file: "starx-kiosk-2.apk", sizeBytes: 3, sha256: "x", signatureChecksum: "CHK", builtAt: "2026-11-14T00:00:00Z" }),
    );
    const c = (await api("POST", "/v1/admin/enrollments", { name: "QR2", initialConfig: { kiosk: { enabled: true, mode: "web" } } })).json;
    const r = await api("POST", `/v1/admin/enrollments/${c.id}/qr`, { wifi: { ssid: "LOJA", password: "segredo123" } });
    expect(r.status).toBe(200);
    const p = r.json.payload;
    expect(p["android.app.extra.PROVISIONING_DEVICE_ADMIN_COMPONENT_NAME"]).toBe("com.pstarx.kiosk/.admin.AdminReceiver");
    expect(p["android.app.extra.PROVISIONING_DEVICE_ADMIN_PACKAGE_DOWNLOAD_LOCATION"]).toBe("https://kiosk-api.exemplo.com/apks/starx-kiosk-2.apk");
    expect(p["android.app.extra.PROVISIONING_DEVICE_ADMIN_SIGNATURE_CHECKSUM"]).toBe("CHK");
    expect(p["android.app.extra.PROVISIONING_WIFI_SSID"]).toBe("LOJA");
    expect(p["android.app.extra.PROVISIONING_WIFI_SECURITY_TYPE"]).toBe("WPA");
    const extras = p["android.app.extra.PROVISIONING_ADMIN_EXTRAS_BUNDLE"];
    expect(extras).toMatchObject({ server_url: "https://kiosk-api.exemplo.com", enrollment_code: c.code });
    expect(JSON.parse(extras.config)).toEqual({ kiosk: { enabled: true, mode: "web" } });

    const apk = await app.inject({ method: "GET", url: "/apks/starx-kiosk-2.apk" });
    expect(apk.statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: "/apks/release.json" })).statusCode).toBe(404);
  });
});
