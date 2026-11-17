import crypto from "node:crypto";
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
  /** Sessão do painel: validade máxima (h) e expiração por inatividade (h). */
  sessionTtlHours: number;
  sessionIdleHours: number;
  /**
   * Segredo compartilhado com o servidor do painel (Vercel): com ele, a API confia no IP e no navegador reais que o
   * painel repassa (X-Client-IP / X-Client-UA). Sem ele, o IP visto é o da Vercel.
   */
  panelSecret?: string;
  /** 2FA obrigatório (código por e-mail no mínimo). Desligado: login só com senha, como antes. */
  authRequire2fa: boolean;
  /** Segredo para o HMAC dos códigos (e-mail e recuperação) e dos navegadores confiáveis. */
  authSecret: string;
  /** Resend (só no servidor). Sem chave: os e-mails não saem (aviso no log). */
  resendApiKey?: string;
  mailFrom: string;
  otpTtlMin: number;
  trustDays: number;
  /** Atrás do Caddy: usa X-Forwarded-For para o IP do aparelho. */
  trustProxy: boolean;
  logLevel: string;
}

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`variável de ambiente ${name} não definida`);
  return v;
}

function authSecret(): string {
  const s = process.env.AUTH_SECRET;
  if (s && s.length >= 32) return s;
  if ((process.env.AUTH_REQUIRE_2FA ?? "false") === "true") throw new Error("AUTH_SECRET (32+ caracteres) é obrigatório com AUTH_REQUIRE_2FA=true");
  // desenvolvimento: segredo por processo (códigos não sobrevivem a um reinício)
  return crypto.randomBytes(32).toString("base64url");
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
    sessionTtlHours: Number(process.env.SESSION_TTL_HOURS ?? 48),
    sessionIdleHours: Number(process.env.SESSION_IDLE_HOURS ?? 8),
    panelSecret: process.env.PANEL_SECRET || undefined,
    authRequire2fa: (process.env.AUTH_REQUIRE_2FA ?? "false") === "true",
    authSecret: authSecret(),
    resendApiKey: process.env.RESEND_API_KEY || undefined,
    mailFrom: process.env.MAIL_FROM ?? "StarX Kiosk <no-reply@pstarx.com>",
    otpTtlMin: Number(process.env.OTP_TTL_MIN ?? 10),
    trustDays: Number(process.env.TRUST_DAYS ?? 30),
    trustProxy: (process.env.TRUST_PROXY ?? "true") === "true",
    logLevel: process.env.LOG_LEVEL ?? "info",
  };
}
