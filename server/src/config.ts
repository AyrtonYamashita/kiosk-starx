import path from "node:path";

export interface Config {
  port: number;
  databaseUrl: string;
  /** Schema do Postgres (os testes usam um schema descartável). */
  dbSchema: string;
  /** URL pública da API (vai no QR e no app): https://kiosk-api.exemplo.com.br */
  publicUrl: string;
  /** Pasta com os APKs publicados e o release.json. */
  apkDir: string;
  adminUsername?: string;
  adminPassword?: string;
  checkinIntervalSec: number;
  sessionDays: number;
  /** Atrás do Caddy: usa X-Forwarded-For para o IP do aparelho. */
  trustProxy: boolean;
  logLevel: string;
}

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`variável de ambiente ${name} não definida`);
  return v;
}

export function loadConfig(): Config {
  return {
    port: Number(process.env.PORT ?? 3100),
    databaseUrl: required("DATABASE_URL"),
    dbSchema: process.env.DB_SCHEMA ?? "public",
    publicUrl: required("PUBLIC_URL").replace(/\/+$/, ""),
    apkDir: path.resolve(process.env.APK_DIR ?? "data/apks"),
    adminUsername: process.env.ADMIN_USERNAME,
    adminPassword: process.env.ADMIN_PASSWORD,
    checkinIntervalSec: Number(process.env.CHECKIN_INTERVAL_SEC ?? 60),
    sessionDays: Number(process.env.SESSION_DAYS ?? 7),
    trustProxy: (process.env.TRUST_PROXY ?? "true") === "true",
    logLevel: process.env.LOG_LEVEL ?? "info",
  };
}
