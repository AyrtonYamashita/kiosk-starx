"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import QRCode from "qrcode";
import { api, ApiError, apiLogin, SESSION_COOKIE, type Enrollment } from "./api";

export type FormState = { error?: string; ok?: string } | undefined;

function message(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  // redirect() lança um erro especial: precisa subir
  throw e;
}

// ---------------------------------------------------------------- sessão

export async function login(_: FormState, form: FormData): Promise<FormState> {
  const result = await apiLogin(String(form.get("username") ?? ""), String(form.get("password") ?? ""));
  if ("error" in result) return { error: result.error };
  (await cookies()).set(SESSION_COOKIE, result.token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: new Date(result.expiresAt),
  });
  redirect("/");
}

export async function logout() {
  try {
    await api("/v1/admin/logout", { method: "POST" });
  } catch {
    // sessão já inválida: só apaga o cookie
  }
  (await cookies()).delete(SESSION_COOKIE);
  redirect("/login");
}

export async function changePassword(_: FormState, form: FormData): Promise<FormState> {
  const next = String(form.get("next") ?? "");
  if (next !== String(form.get("confirm") ?? "")) return { error: "As senhas novas não conferem." };
  try {
    await api("/v1/admin/password", { method: "POST", body: { current: String(form.get("current") ?? ""), next } });
    return { ok: "Senha alterada. As outras sessões foram encerradas." };
  } catch (e) {
    return { error: message(e) };
  }
}

// ---------------------------------------------------------------- aparelhos

export async function renameDevice(_: FormState, form: FormData): Promise<FormState> {
  const id = String(form.get("id"));
  try {
    await api(`/v1/admin/devices/${id}`, { method: "PATCH", body: { name: String(form.get("name") ?? "") } });
    revalidatePath(`/devices/${id}`);
    return { ok: "Nome salvo." };
  } catch (e) {
    return { error: message(e) };
  }
}

export async function deleteDevice(form: FormData) {
  await api(`/v1/admin/devices/${String(form.get("id"))}`, { method: "DELETE" });
  revalidatePath("/");
  redirect("/");
}

// ---------------------------------------------------------------- cadastro

export async function createEnrollment(_: FormState, form: FormData): Promise<FormState> {
  const maxUses = String(form.get("maxUses") ?? "").trim();
  const expires = String(form.get("expiresInDays") ?? "").trim();
  const configText = String(form.get("initialConfig") ?? "").trim();
  let initialConfig: unknown = null;
  if (configText) {
    try {
      initialConfig = JSON.parse(configText);
    } catch {
      return { error: "A configuração inicial não é um JSON válido." };
    }
    if (typeof initialConfig !== "object" || Array.isArray(initialConfig)) return { error: "A configuração inicial precisa ser um objeto JSON." };
  }
  let created: Enrollment;
  try {
    created = await api<Enrollment>("/v1/admin/enrollments", {
      method: "POST",
      body: {
        name: String(form.get("name") ?? ""),
        maxUses: maxUses ? Number(maxUses) : null,
        expiresInDays: expires ? Number(expires) : null,
        initialConfig,
        profileId: String(form.get("profileId") ?? "") || null,
      },
    });
  } catch (e) {
    return { error: message(e) };
  }
  revalidatePath("/enroll");
  redirect(`/enroll/${created.id}`);
}

export async function revokeEnrollment(form: FormData) {
  const id = String(form.get("id"));
  await api(`/v1/admin/enrollments/${id}`, { method: "DELETE" });
  revalidatePath("/enroll");
  revalidatePath(`/enroll/${id}`);
}

export type QrState = { error?: string; svg?: string; payload?: string } | undefined;

/** Gera o QR de provisionamento. O Wi-Fi (opcional) entra só no QR, não fica gravado. */
export async function generateQr(_: QrState, form: FormData): Promise<QrState> {
  const ssid = String(form.get("ssid") ?? "").trim();
  const password = String(form.get("password") ?? "");
  try {
    const r = await api<{ payload: Record<string, unknown> }>(`/v1/admin/enrollments/${String(form.get("id"))}/qr`, {
      method: "POST",
      body: { wifi: ssid ? { ssid, password: password || undefined, hidden: form.get("hidden") === "on" } : null },
    });
    const payload = JSON.stringify(r.payload);
    const svg = await QRCode.toString(payload, { type: "svg", errorCorrectionLevel: "M", margin: 2 });
    return { svg, payload };
  } catch (e) {
    return { error: message(e) };
  }
}

// ---------------------------------------------------------------- perfis e configuração (fase 3)

function parseConfigField(form: FormData, field: string): { ok: true; value: unknown } | { ok: false; error: string } {
  const raw = String(form.get(field) ?? "").trim();
  if (!raw) return { ok: true, value: null };
  try {
    return { ok: true, value: JSON.parse(raw) };
  } catch {
    return { ok: false, error: "JSON inválido." };
  }
}

export async function saveProfile(_: FormState, form: FormData): Promise<FormState> {
  const id = String(form.get("id") ?? "");
  const config = parseConfigField(form, "config");
  if (!config.ok) return { error: config.error };
  const body = { name: String(form.get("name") ?? ""), description: String(form.get("description") ?? ""), config: config.value ?? {} };
  let saved: { id: string };
  try {
    saved = id
      ? await api<{ id: string }>(`/v1/admin/profiles/${id}`, { method: "PUT", body })
      : await api<{ id: string }>("/v1/admin/profiles", { method: "POST", body });
  } catch (e) {
    return { error: message(e) };
  }
  revalidatePath("/profiles");
  revalidatePath(`/profiles/${saved.id}`);
  if (!id) redirect(`/profiles/${saved.id}?salvo=1`);
  return { ok: "Perfil salvo. Os aparelhos com este perfil recebem a configuração no próximo contato (até 30 s)." };
}

export async function deleteProfile(form: FormData) {
  await api(`/v1/admin/profiles/${String(form.get("id"))}`, { method: "DELETE" });
  revalidatePath("/profiles");
  redirect("/profiles");
}

export async function setDeviceConfig(_: FormState, form: FormData): Promise<FormState> {
  const id = String(form.get("id"));
  const overrides = parseConfigField(form, "overrides");
  if (!overrides.ok) return { error: `Ajustes: ${overrides.error}` };
  const profileId = String(form.get("profileId") ?? "") || null;
  try {
    await api(`/v1/admin/devices/${id}/config`, { method: "PUT", body: { profileId, overrides: overrides.value } });
  } catch (e) {
    return { error: message(e) };
  }
  revalidatePath(`/devices/${id}`);
  revalidatePath("/");
  return { ok: "Salvo. O aparelho recebe no próximo contato (até 30 s)." };
}

export async function reapplyConfig(form: FormData) {
  const id = String(form.get("id"));
  await api(`/v1/admin/devices/${id}/config/reapply`, { method: "POST" });
  revalidatePath(`/devices/${id}`);
  revalidatePath("/");
}

export async function bulkAssignProfile(_: FormState, form: FormData): Promise<FormState> {
  const deviceIds = form.getAll("deviceId").map(String);
  if (deviceIds.length === 0) return { error: "Selecione pelo menos um aparelho." };
  const profileId = String(form.get("profileId") ?? "");
  try {
    const r = await api<{ updated: number }>("/v1/admin/devices/bulk/profile", {
      method: "POST",
      body: { deviceIds, profileId: profileId === "__none__" ? null : profileId },
    });
    revalidatePath("/");
    return { ok: `${r.updated} aparelho(s) atualizado(s).` };
  } catch (e) {
    return { error: message(e) };
  }
}
