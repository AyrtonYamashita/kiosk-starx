import "server-only";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";

export const SESSION_COOKIE = "kiosk_session";
/** Etapa 2 do login (sessão provisória do 2FA, 10 min) e os dados para a tela do código. */
export const MFA_COOKIE = "kiosk_mfa";
export const MFA_INFO_COOKIE = "kiosk_mfa_info";
/** "Confiar neste navegador" (30 dias): pula o segundo fator. */
export const TRUST_COOKIE = "kiosk_trust";

function apiUrl(): string {
  const url = process.env.API_URL;
  if (!url) throw new Error("API_URL não definida (veja web/.env.example)");
  return url.replace(/\/+$/, "");
}

/**
 * IP e navegador de quem está usando o painel, repassados à API assinados com PANEL_SECRET (sem isso a API veria o
 * IP da Vercel em todo login, e o limite/bloqueio por IP valeria para todos juntos).
 */
async function clientHeaders(): Promise<Record<string, string>> {
  const secret = process.env.PANEL_SECRET;
  if (!secret) return {};
  const h = await headers();
  const ip = (h.get("x-real-ip") ?? h.get("x-forwarded-for")?.split(",")[0] ?? "").trim();
  return {
    "x-panel-secret": secret,
    ...(ip ? { "x-client-ip": ip } : {}),
    "x-client-ua": (h.get("user-agent") ?? "").slice(0, 300),
  };
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public body: { error?: string; message?: string } | null,
  ) {
    super(body?.message ?? body?.error ?? `HTTP ${status}`);
  }
}

/** Chamada à API com o token da sessão (cookie httpOnly do painel). 401 → volta para o login. */
export async function api<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) redirect("/login");
  const res = await fetch(`${apiUrl()}${path}`, {
    method: init.method ?? "GET",
    headers: {
      authorization: `Bearer ${token}`,
      ...(init.body !== undefined ? { "content-type": "application/json" } : {}),
      ...(await clientHeaders()),
    },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    cache: "no-store",
  });
  if (res.status === 401) redirect("/login?expirada=1");
  const text = await res.text();
  const json = text ? JSON.parse(text) : null;
  if (!res.ok) throw new ApiError(res.status, json);
  return json as T;
}

/** Encerra no servidor uma sessão pelo token (rotação: a sessão anterior do navegador não fica viva). */
export async function apiRevokeToken(token: string): Promise<void> {
  await fetch(`${apiUrl()}/v1/admin/logout`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, ...(await clientHeaders()) },
    cache: "no-store",
  }).catch(() => undefined);
}

/** Login: não usa o cookie (ainda não existe). */
export type LoginResult =
  | { token: string; expiresAt: string; mfaRequired?: undefined }
  | {
      mfaRequired: true;
      token: string;
      expiresAt: string;
      methods: ("email" | "recovery")[];
      emailHint: string | null;
      codeSent: boolean;
      retryAfterSec: number;
      trustDays: number;
    }
  | { error: string };

export async function apiLogin(username: string, password: string, trustToken?: string): Promise<LoginResult> {
  try {
    const res = await fetch(`${apiUrl()}/v1/admin/login`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(await clientHeaders()) },
      body: JSON.stringify({ username, password, ...(trustToken ? { trustToken } : {}) }),
      cache: "no-store",
    });
    const json = await res.json().catch(() => null);
    if (res.status === 429) return { error: json?.message ?? "Muitas tentativas. Tente de novo mais tarde." };
    if (!res.ok) return { error: json?.message ?? "Não foi possível entrar." };
    return json;
  } catch {
    return { error: "Servidor indisponível." };
  }
}

// ---------------------------------------------------------------- tipos da API

export interface DeviceSummary {
  id: string;
  name: string;
  serial: string | null;
  manufacturer: string | null;
  model: string | null;
  androidVersion: string | null;
  appVersion: string | null;
  enrolledAt: string;
  lastSeenAt: string | null;
  lastIp: string | null;
  online: boolean;
  battery: { level: number | null; charging: boolean; temperatureC?: number | null } | null;
  network: { type: string; ssid: string | null; rssi: number | null; ip: string | null; mac: string | null } | null;
  /** Tempo ligado no último contato (ms). */
  uptimeMs: number | null;
  infoUpdatedAt: string | null;
  /** Usuário logado no sistema aberto no kiosk (integração futura com o site). */
  loggedUser: string | null;
  kioskActive: boolean | null;
  kioskMode: string | null;
  kioskEnabled: boolean | null;
  configRevision: number | null;
  profileId: string | null;
  profileName: string | null;
  hasOverrides: boolean;
  configStatus: ConfigStatus;
}

export type ConfigStatus = "none" | "applied" | "modified" | "pending" | "error";

export interface DeviceDetail {
  id: string;
  name: string;
  serial: string | null;
  manufacturer: string | null;
  model: string | null;
  androidVersion: string | null;
  appVersion: string | null;
  enrolledAt: string;
  enrollmentName: string | null;
  lastSeenAt: string | null;
  lastIp: string | null;
  online: boolean;
  info: any;
  infoUpdatedAt: string | null;
  apps: { packageName: string; label?: string; versionName?: string | null; versionCode?: number; system?: boolean }[];
  appsUpdatedAt: string | null;
  config: any;
  configRevision: number | null;
  configSource: string | null;
  configUpdatedAt: string | null;
  profileId: string | null;
  profileName: string | null;
  overrides: Record<string, unknown> | null;
  configStatus: ConfigStatus;
  applyError: string | null;
  applyWarnings: string[];
  appliedAt: string | null;
  appVersionCode: number | null;
  managedApps: string[];
  managedStatus: Record<string, { versionCode: number | null; error: string | null; at?: string }>;
  lastScreenshotAt: string | null;
}

export type CommandType = "reboot" | "lock" | "message" | "screenshot" | "reload" | "install_app" | "uninstall_app";

export interface Command {
  id: string;
  type: CommandType;
  payload: any;
  status: "pending" | "sent" | "ok" | "failed" | "expired" | "canceled";
  message: string | null;
  output: any;
  createdBy: string | null;
  createdAt: string;
  sentAt: string | null;
  doneAt: string | null;
  expiresAt: string;
}

export interface Screenshot {
  id: string;
  width: number | null;
  height: number | null;
  createdAt: string;
}

export interface RepoApp {
  packageName: string;
  label: string;
  signingCertSha256: string;
  createdAt: string;
  versions: {
    id: string;
    versionCode: number;
    versionName: string | null;
    minSdk: number | null;
    sizeBytes: number;
    sha256: string;
    uploadedBy: string | null;
    uploadedAt: string;
    devices: number;
  }[];
  installedDevices: number;
  upToDateDevices: number;
  profiles: { id: string; name: string }[];
}

export interface Profile {
  id: string;
  name: string;
  description: string;
  config: Record<string, any>;
  managedApps: string[];
  devices: number;
  createdAt: string;
  updatedAt: string;
  deviceList?: { id: string; name: string; serial: string | null }[];
}

export interface CatalogApp {
  package: string;
  label: string | null;
  devices: number;
  system: boolean | null;
}

export interface Release {
  packageName: string;
  versionCode: number;
  versionName: string;
  file: string;
  sizeBytes: number;
  sha256: string;
  builtAt: string;
}

export interface Enrollment {
  id: string;
  code: string;
  name: string;
  maxUses: number | null;
  uses: number;
  devices: number;
  expiresAt: string | null;
  revokedAt: string | null;
  createdAt: string;
  initialConfig: unknown | null;
  profileId: string | null;
  profileName: string | null;
  status: "active" | "expired" | "exhausted" | "revoked";
  serverUrl: string;
}

export interface KioskRelease {
  release: Release | null;
  pending: Release | null;
  pendingUploadedBy: string | null;
  autoUpdate: boolean;
  maxApkMb: number;
  devices: { versionName: string | null; versionCode: number | null; devices: number }[];
}

// ---------------------------------------------------------------- conta, usuários e segurança

export type Role = "admin" | "operator";

export interface Me {
  id: string;
  username: string;
  email: string | null;
  role: Role;
}

export interface SessionInfo {
  id: string;
  username: string;
  createdAt: string;
  lastUsedAt: string;
  expiresAt: string;
  ip: string | null;
  userAgent: string | null;
  current: boolean;
}

export interface UserInfo {
  id: string;
  username: string;
  email: string | null;
  role: Role;
  disabled: boolean;
  createdAt: string;
  passwordChangedAt: string | null;
  lastLoginAt: string | null;
  activeSessions: number;
  lockedUntil: string | null;
}

export interface Lockout {
  kind: "ip" | "account";
  key: string;
  level: number;
  lockedUntil: string;
}

export interface AuthEvent {
  id: number;
  event: string;
  username: string | null;
  identifier: string | null;
  ip: string | null;
  userAgent: string | null;
  details: Record<string, unknown> | null;
  createdAt: string;
}

/** Chamada da etapa 2 do login, com a sessão provisória (não o cookie da sessão normal). */
export async function apiMfa<T>(token: string, path: string, body?: unknown): Promise<{ status: number; json: T & { message?: string; error?: string; retryAfterSec?: number; attemptsLeft?: number } }> {
  const res = await fetch(`${apiUrl()}${path}`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, ...(body !== undefined ? { "content-type": "application/json" } : {}), ...(await clientHeaders()) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

export interface MfaInfo {
  required: boolean;
  email: string | null;
  recoveryCodesLeft: number;
  trustDays: number;
  trustedDevices: { id: string; ip: string | null; userAgent: string | null; createdAt: string; lastUsedAt: string; expiresAt: string }[];
}
