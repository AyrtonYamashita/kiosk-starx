import fastifyRateLimit from "@fastify/rate-limit";
import fastifyStatic from "@fastify/static";
import Fastify from "fastify";
import fs from "node:fs";
import type { Config } from "./config.js";
import type { Db } from "./db.js";
import { adminRoutes } from "./routes/admin.js";
import { deviceAppRoutes, uploadRoutes } from "./routes/apps.js";
import { deviceScreenshotRoutes } from "./routes/commands.js";
import { deviceRoutes } from "./routes/device.js";
import { Waker } from "./wake.js";

export async function buildApp(config: Config, db: Db, waker = new Waker()) {
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
  await app.register(deviceAppRoutes, { db, config });
  await app.register(deviceScreenshotRoutes, { db });
  await app.register(uploadRoutes, { db, config });
  await app.register(adminRoutes, { db, config, waker });
  return app;
}
