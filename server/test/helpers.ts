import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { expect } from "vitest";
import { buildApp } from "../src/app.js";
import type { Config } from "../src/config.js";
import { createPool, migrate, type Db } from "../src/db.js";
import { ensureAdmin } from "../src/routes/admin.js";
import type { MailMessage } from "../src/mfa.js";
import type { PushSender } from "../src/push.js";

const DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgres://kiosk:kiosk@127.0.0.1:5434/kiosk";

export const info = (serial: string) => ({
  hardware: { manufacturer: "chainway", model: "C6000", serialNumber: serial, androidVersion: "10", imeis: ["8665"] },
  battery: { level: 43, charging: true },
  network: { type: "wifi", wifi: { ssid: "LOJA", rssi: -58 }, ipAddresses: ["192.168.0.10"] },
  app: { versionName: "0.2.0", isDeviceOwner: true, kioskActive: true, configRevision: 3 },
});

/** API com banco real num schema descartável. */
/** E-mails "enviados" nos testes (nada sai de verdade). */
export type SentMail = MailMessage;

export async function setupApi(opts: { config?: Partial<Config>; pushSender?: PushSender } = {}) {
  const sent: SentMail[] = [];
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
    panelSecret: "segredo-do-painel-de-teste",
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
    vapidSubject: "https://kiosk.test",
  };
  const db: Db = createPool(DATABASE_URL, schema);
  await migrate(db, schema);
  await ensureAdmin(db, config, { info: () => undefined });
  Object.assign(config, opts.config ?? {});
  const app: FastifyInstance = await buildApp(
    config,
    db,
    undefined,
    async (m) => {
      sent.push(m);
    },
    undefined,
    opts.pushSender,
  );
  const ctx = {
    db,
    app,
    config,
    apkDir,
    schema,
    adminToken: "",
    sent,
    async api(method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE", url: string, body?: unknown, token?: string) {
      const t = token ?? ctx.adminToken;
      const res = await app.inject({ method, url, payload: body as object, headers: t ? { authorization: `Bearer ${t}` } : {} });
      return { status: res.statusCode, json: res.body ? res.json() : null };
    },
    async close() {
      await app.close();
      await db.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      await db.end();
      fs.rmSync(apkDir, { recursive: true, force: true });
    },
  };
  await db.query("UPDATE admins SET email = 'admin@pstarx.com' WHERE username = 'admin'");
  const login = await ctx.api("POST", "/v1/admin/login", { username: "admin", password: "senha-de-teste-123" }, "");
  expect(login.status).toBe(200);
  ctx.adminToken = login.json.token;
  if (login.json.mfaRequired) {
    // 2FA ligado: conclui com o código "enviado" por e-mail
    await new Promise((r) => setTimeout(r, 20));
    const code = codeFrom(sent[sent.length - 1]);
    const v = await ctx.api("POST", "/v1/auth/mfa/verify", { method: "email", code }, login.json.token);
    expect(v.status).toBe(200);
    ctx.adminToken = v.json.token;
  }
  return ctx;
}

type Ctx = Awaited<ReturnType<typeof setupApi>>;

/** Entra com um usuário (sem 2FA nos testes que usam isto) e devolve o token. */
async function loginAs(t: Ctx, username: string, password: string): Promise<string> {
  const r = await t.api("POST", "/v1/admin/login", { username, password }, "");
  expect(r.status).toBe(200);
  return r.json.token;
}

/** Usuário da plataforma (sem empresa), com a mesma senha do admin dos testes. */
export async function platformLogin(t: Ctx, username = "plataforma"): Promise<string> {
  const hash = (await t.db.query("SELECT password_hash FROM admins WHERE username = 'admin' AND tenant_id IS NOT NULL LIMIT 1")).rows[0].password_hash;
  await t.db.query("INSERT INTO admins (username, email, password_hash, platform) VALUES ($1, $2, $3, true) ON CONFLICT DO NOTHING", [username, `${username}@pstarx.com`, hash]);
  return loginAs(t, username, "senha-de-teste-123");
}

/** Outra empresa com um admin próprio (mesmo nome "admin" da primeira, e-mail diferente). Devolve a empresa e o token. */
export async function addTenant(t: Ctx, slug: string): Promise<{ tenantId: string; token: string }> {
  const tenantId = (await t.db.query("INSERT INTO tenants (name, slug) VALUES ($1, $2) RETURNING id", [`Empresa ${slug}`, slug])).rows[0].id;
  const hash = (await t.db.query("SELECT password_hash FROM admins WHERE username = 'admin' AND tenant_id IS NOT NULL LIMIT 1")).rows[0].password_hash;
  await t.db.query("INSERT INTO admins (tenant_id, username, email, password_hash) VALUES ($1, 'admin', $2, $3)", [tenantId, `admin@${slug}.com`, hash]);
  return { tenantId, token: await loginAs(t, `admin@${slug}.com`, "senha-de-teste-123") };
}

/** Código de 8 caracteres de um e-mail de acesso ("ABCD-2345"). */
export function codeFrom(mail: SentMail | undefined): string {
  const m = mail?.text.match(/([A-Z0-9]{4}-[A-Z0-9]{4})/);
  if (!m) throw new Error("e-mail sem código");
  return m[1];
}
