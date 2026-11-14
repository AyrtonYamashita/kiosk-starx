import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

export const SESSION_COOKIE = "kiosk_session";

function apiUrl(): string {
  const url = process.env.API_URL;
  if (!url) throw new Error("API_URL não definida (veja web/.env.example)");
  return url.replace(/\/+$/, "");
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

/** Login: não usa o cookie (ainda não existe). */
export async function apiLogin(username: string, password: string): Promise<{ token: string; expiresAt: string } | { error: string }> {
  try {
    const res = await fetch(`${apiUrl()}/v1/admin/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username, password }),
      cache: "no-store",
    });
    const json = await res.json().catch(() => null);
    if (res.status === 429) return { error: "Muitas tentativas. Aguarde um minuto." };
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
  network: { type: string; ssid: string | null; rssi: number | null; ip: string | null } | null;
  kioskActive: boolean | null;
  kioskMode: string | null;
  kioskEnabled: boolean | null;
  configRevision: number | null;
}

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
}

export interface Release {
  packageName: string;
  versionCode: number;
  versionName: string;
  file: string;
  sizeBytes: number;
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
  status: "active" | "expired" | "exhausted" | "revoked";
  serverUrl: string;
}
