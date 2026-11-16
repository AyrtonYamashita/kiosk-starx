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
  /** Repositório de apps (APKs enviados pelo painel). */
  appsDir: string;
  /** Origens do painel que podem enviar APKs direto para a API (CORS): https://kiosk.exemplo.com */
  panelOrigins: string[];
  /** Atualiza o app do kiosk nos aparelhos quando um APK mais novo é publicado (release.json). */
  autoUpdateApp: boolean;
  /** Tamanho máximo de um APK enviado ao repositório (MB). A Cloudflare (plano grátis) aceita até 100 MB. */
  maxApkMb: number;
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
    appsDir: path.resolve(process.env.APPS_DIR ?? "data/apps"),
    panelOrigins: (process.env.PANEL_ORIGINS ?? "http://localhost:3000")
      .split(",")
      .map((o) => o.trim().replace(/\/+$/, ""))
      .filter(Boolean),
    autoUpdateApp: (process.env.AUTO_UPDATE_APP ?? "true") === "true",
    maxApkMb: Number(process.env.MAX_APK_MB ?? 95),
    adminUsername: process.env.ADMIN_USERNAME,
    adminPassword: process.env.ADMIN_PASSWORD,
    checkinIntervalSec: Number(process.env.CHECKIN_INTERVAL_SEC ?? 60),
    sessionDays: Number(process.env.SESSION_DAYS ?? 7),
    trustProxy: (process.env.TRUST_PROXY ?? "true") === "true",
    logLevel: process.env.LOG_LEVEL ?? "info",
  };
}
