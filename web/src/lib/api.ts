import "server-only";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";

/** JSON livre (configuração e informações do aparelho): o formato é validado pelo app e pela API, não aqui. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Json = any;

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
  // usuário da plataforma (sem empresa) numa tela de empresa: vai para Empresas, a tela dele
  if (res.status === 403 && json?.error === "no_tenant") redirect("/platform");
  // empresa suspensa pela plataforma
  if (res.status === 403 && json?.error === "tenant_suspended") redirect("/login?suspensa=1");
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
      methods: ("passkey" | "totp" | "email" | "recovery")[];
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
  /** Usuário logado no SSW (lido pelo app com a leitura do SSW ligada). */
  loggedUser: string | null;
  /** Leitura do SSW (obrigatória: sempre ligada). */
  opsReader: boolean;
  /** Coletor piloto: recebe antes as versões publicadas para os pilotos. */
  pilot: boolean;
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
  info: Json;
  infoUpdatedAt: string | null;
  apps: { packageName: string; label?: string; versionName?: string | null; versionCode?: number; system?: boolean }[];
  appsUpdatedAt: string | null;
  config: Json;
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
  /** Leitura do SSW (obrigatória: sempre ligada). */
  opsReader: boolean;
  /** Coletor piloto: recebe antes as versões publicadas para os pilotos. */
  pilot: boolean;
  /** Usuário logado no SSW agora (última leitura). */
  sswUser: string | null;
}

export type CommandType = "reboot" | "lock" | "message" | "screenshot" | "reload" | "install_app" | "uninstall_app";

export interface Command {
  id: string;
  type: CommandType;
  payload: Json;
  status: "pending" | "sent" | "ok" | "failed" | "expired" | "canceled";
  message: string | null;
  output: Json;
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
  config: Record<string, Json>;
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
  /** Nome de exibição ("Ayrton Yamashita"); null = mostra o nome de usuário. */
  displayName: string | null;
  email: string | null;
  role: Role;
  /** Usuário da plataforma (PStarX): cria as empresas e publica o app do kiosk. Não tem empresa. */
  platform: boolean;
  /** Plataforma dentro de uma empresa ("entrar como", suporte). */
  acting: boolean;
  tenant: { id: string; name: string; slug: string } | null;
}

/** Empresa no painel da plataforma. */
export interface PlatformTenant {
  id: string;
  name: string;
  slug: string;
  status: "active" | "suspended";
  createdAt: string;
  devices: number;
  online: number;
  users: number;
  lastSeenAt: string | null;
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
  displayName: string | null;
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

/** Notificações no celular (GET /v1/admin/push): chave pública VAPID, eventos escolhidos e aparelhos inscritos. */
export interface PushInfo {
  enabled: boolean;
  publicKey: string | null;
  events: ("start" | "done" | "stopped" | "scan_error")[];
  subscriptions: { endpoint: string; userAgent: string | null; createdAt: string; lastSentAt: string | null }[];
}

export interface MfaInfo {
  required: boolean;
  email: string | null;
  totp: { enabled: boolean; since: string | null };
  passkeys: { id: string; name: string; synced: boolean; createdAt: string; lastUsedAt: string | null }[];
  recoveryCodesLeft: number;
  trustDays: number;
  trustedDevices: { id: string; ip: string | null; userAgent: string | null; createdAt: string; lastUsedAt: string; expiresAt: string }[];
}

/** Chamada sem sessão (login com passkey): só os cabeçalhos do cliente. */
export async function apiAnon<T>(path: string, body?: unknown): Promise<{ status: number; json: T & { message?: string; error?: string } }> {
  const res = await fetch(`${apiUrl()}${path}`, {
    method: "POST",
    headers: { ...(body !== undefined ? { "content-type": "application/json" } : {}), ...(await clientHeaders()) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

// ---------------------------------------------------------------- acompanhamento de operações (fase 2)

export type OpsTotals = { qty: number; kg: number; value: number };
export interface OpsCard {
  deviceId: string;
  deviceName: string;
  user: string | null;
  domain: string | null;
  branch: string | null;
  screen: string | null;
  lastSeenAt: string | null;
  operation: null | {
    id: string;
    fn: string;
    fnLabel: string;
    plate: string;
    realPlate: string | null;
    units: string[];
    startedAt: string;
    total: OpsTotals;
    read: OpsTotals;
    missing: OpsTotals;
    scans: number;
    lastScanAt: string | null;
    avgSecPerVolume: number | null;
    etaAt: string | null;
    /** bipagens recusadas pelo SSW nesta carga e a mais recente */
    scanErrors: number;
    lastError: { at: string; code: string; message: string | null } | null;
  };
  /** Sem carga aberta: a última encerrada nas últimas 2 h, com o motivo (ex.: tela apagada). */
  lastEnded: null | { id: string; fnLabel: string; plate: string; endedAt: string; endReason: string | null; endDetail: string | null };
}
export type OpsCodeKind = "lido" | "outra" | "nao_contou" | "erro";

export interface OpsCode {
  at: string;
  code: string;
  kind: OpsCodeKind;
  /** mensagem que o SSW mostrou ao recusar o código (tipo "erro") */
  error?: string | null;
  /** captura da tela com o alerta de erro grave (app 0.5.6+) */
  shotId?: string | null;
  readQty: number | null;
}

/** Resultado da consulta por código de barras. */
export interface OpsCodeHit extends OpsCode {
  device: { id: string; name: string };
  operation: null | {
    id: string;
    fn: string;
    fnLabel: string;
    plate: string;
    user: string | null;
    branch: string | null;
    startedAt: string;
    endedAt: string | null;
    endReason: string | null;
  };
}

export interface OpsDetail {
  device: { id: string; name: string };
  card: OpsCard | null;
  operation: null | {
    id: string;
    fn: string;
    fnLabel: string;
    plate: string;
    realPlate: string | null;
    units: string[];
    user: string | null;
    domain: string | null;
    branch: string | null;
    startedAt: string;
    endedAt: string | null;
    endReason: string | null;
    /** motivo avisado pelo coletor antes de ficar sem sinal: tela_apagada | desligado */
    endDetail?: string | null;
    scans: number;
    scanErrors: number;
    firstScanAt: string | null;
    lastScanAt: string | null;
    total: OpsTotals;
    read: OpsTotals;
    missing: OpsTotals;
    avgSecPerVolume: number | null;
    etaAt: string | null;
  };
  scans: { at: string; qty: number; delta: number; intervalSec: number | null }[];
  /** Códigos de barras lidos na tela (app 0.5.2), do mais novo para o mais antigo. */
  codes?: OpsCode[];
  today: {
    id: string;
    fn: string;
    fnLabel: string;
    plate: string;
    user: string | null;
    startedAt: string;
    endedAt: string | null;
    endReason: string | null;
    durationSec: number;
    totalQty: number;
    readQty: number;
    totalValue: number;
    scans: number;
  }[];
  functionTimeTodaySec: number | null;
  serverTime: number;
}

/** Histórico de cargas (/v1/admin/ops/operations). */
export interface OpsHistory {
  operations: {
    id: string;
    device: { id: string; name: string };
    fn: string;
    fnLabel: string;
    plate: string;
    realPlate: string | null;
    user: string | null;
    branch: string | null;
    units: string[];
    startedAt: string;
    endedAt: string | null;
    endReason: string | null;
    endDetail?: string | null;
    durationSec: number;
    totalQty: number;
    readQty: number;
    totalValue: number;
    readValue: number;
    scans: number;
    scanErrors: number;
    avgSecPerVolume: number | null;
  }[];
  next: string | null;
  users: string[];
  functions: { value: string; label: string }[];
}

/** Erros de bipagem (/v1/admin/ops/scan-errors): código recusado pelo SSW, com a mensagem como apareceu na tela. */
export interface OpsScanErrors {
  errors: {
    at: string;
    code: string;
    message: string | null;
    /** tipo de erro: a mensagem normalizada (números viram #) */
    type: string | null;
    /** captura da tela com o alerta de erro grave (app 0.5.6+) */
    shotId: string | null;
    readQty: number | null;
    device: { id: string; name: string };
    operation: null | { id: string; fn: string; fnLabel: string; plate: string; realPlate: string | null; user: string | null; branch: string | null };
  }[];
  next: string | null;
  /** tipos de erro no período (com os outros filtros), do mais frequente para o menos */
  types: { type: string | null; message: string | null; count: number; lastAt: string }[];
  users: string[];
  devices: { id: string; name: string }[];
}
// ---------------------------------------------------------------- versões: pilotos, todos e agendamentos

export type ReleaseKind = "kiosk" | "reader";
export type ReleaseChannel = "pilot" | "all";

/** /v1/admin/releases: app do kiosk e leitor do SSW, o que pilotos e todos recebem, agendamentos e coletores. */
export interface Releases {
  kiosk: {
    all: number | null;
    pilot: number | null;
    versions: {
      versionCode: number;
      versionName: string;
      sizeBytes: number;
      sha256: string;
      /** o que a versão muda (escrito no build, dentro do APK) */
      notes: string[];
      /** dá para voltar à versão anterior sem perder nada? (null: não informado no APK) */
      reversible: boolean | null;
      reversibleNote: string | null;
      uploadedBy: string | null;
      uploadedAt: string;
      /** coletores (da empresa) nesta versão agora */
      devices: number;
    }[];
  };
  reader: {
    all: string | null;
    pilot: string | null;
    /** o leitor que veio no deploy atual da API */
    deployed: string | null;
    versions: { sha256: string; version: string | null; firstSeenAt: string }[];
  };
  schedules: {
    id: string;
    kind: ReleaseKind;
    channel: ReleaseChannel;
    ref: string;
    runAt: string;
    createdBy: string | null;
    doneAt: string | null;
    result: string | null;
  }[];
  devices: { id: string; name: string; tenant: string | null; pilot: boolean; appVersion: string | null; appVersionCode: number | null; lastSeenAt: string | null }[];
}
