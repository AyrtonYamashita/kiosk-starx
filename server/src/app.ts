import fastifyRateLimit from "@fastify/rate-limit";
import fastifyStatic from "@fastify/static";
import Fastify from "fastify";
import crypto from "node:crypto";
import fs from "node:fs";
import type { Config } from "./config.js";
import type { Db } from "./db.js";
import { adminRoutes } from "./routes/admin.js";
import { deviceAppRoutes, uploadRoutes } from "./routes/apps.js";
import { deviceScreenshotRoutes } from "./routes/commands.js";
import { deviceRoutes } from "./routes/device.js";
import { Waker } from "./wake.js";
import { OpsBus } from "./ops.js";
import { scheduleStaleOps } from "./opsRetention.js";
import { opsDeviceRoutes } from "./routes/ops.js";
import { OpsLive } from "./opsLive.js";
import { opsStreamRoutes } from "./routes/opsAdmin.js";
import { logMailer, resendMailer, type Mailer } from "./mfa.js";

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

export async function buildApp(config: Config, db: Db, waker = new Waker(), mailer?: Mailer, bus = new OpsBus()) {
  const app = Fastify({
    logger: { level: config.logLevel, redact: ["req.headers.authorization", "req.headers.cookie"] },
    trustProxy: config.trustProxy,
    bodyLimit: 512 * 1024,
  });

  // Atrás da Cloudflare, o IP real do cliente vem em CF-Connecting-IP (a API só é alcançável pelo Caddy, na rede
  // interna). Vale para os logs, o rate limit e o "IP público" do aparelho.
  app.addHook("onRequest", async (req) => {
    const cf = req.headers["cf-connecting-ip"];
    if (config.trustProxy && typeof cf === "string" && /^[0-9a-fA-F:.]{3,45}$/.test(cf)) {
      Object.defineProperty(req, "ip", { value: cf, configurable: true });
    }
  });

  // Painel (servidor na Vercel) repassa o IP e o navegador de quem está usando, assinados com PANEL_SECRET.
  // Vale para o rate limit, o bloqueio por IP, a auditoria e a lista de sessões.
  app.addHook("onRequest", async (req) => {
    const secret = req.headers["x-panel-secret"];
    if (!config.panelSecret || typeof secret !== "string" || !safeEqual(secret, config.panelSecret)) return;
    const ip = req.headers["x-client-ip"];
    if (typeof ip === "string" && /^[0-9a-fA-F:.]{3,45}$/.test(ip)) Object.defineProperty(req, "ip", { value: ip, configurable: true });
    const ua = req.headers["x-client-ua"];
    if (typeof ua === "string") req.headers["user-agent"] = ua.slice(0, 300);
  });

  await app.register(fastifyRateLimit, { global: false });

  app.get("/health", async () => {
    await db.query("SELECT 1");
    return { ok: true };
  });

  // APK do app para o provisionamento por QR (o Android baixa daqui durante o assistente)
  fs.mkdirSync(config.apkDir, { recursive: true });
  await app.register(fastifyStatic, {
    root: config.apkDir,
    prefix: "/apks/",
    decorateReply: false,
    allowedPath: (p) => p.endsWith(".apk"),
    // sem cache na Cloudflare (que guarda .apk por padrão): toda tentativa de download chega ao servidor e aparece
    // nos registros, e um APK republicado com o mesmo nome nunca é servido velho
    setHeaders: (res) => res.header("cache-control", "no-store"),
  });

  fs.mkdirSync(config.appsDir, { recursive: true });
  await app.register(deviceRoutes, { db, config, waker });
  await app.register(opsDeviceRoutes, { db, bus });
  const live = new OpsLive(db, bus);
  app.addHook("onClose", async () => live.close());
  // carga aberta de coletor sem sinal por 2 h: a API encerra (o app não consegue)
  const stopStale = scheduleStaleOps(db, config.opsSignalLostMin, (ids) => ids.forEach((id) => bus.changed(id)), app.log);
  app.addHook("onClose", async () => stopStale());
  await app.register(opsStreamRoutes, { db, config, live });
  await app.register(deviceAppRoutes, { db, config });
  await app.register(deviceScreenshotRoutes, { db });
  await app.register(uploadRoutes, { db, config });
  const mail = mailer ?? (config.resendApiKey ? resendMailer(config.resendApiKey, config.mailFrom) : logMailer(app.log));
  await app.register(adminRoutes, { db, config, waker, mailer: mail, live });
  return app;
}
