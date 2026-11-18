"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import QRCode from "qrcode";
import { api, ApiError, apiAnon, apiLogin, apiMfa, apiRevokeToken, MFA_COOKIE, MFA_INFO_COOKIE, SESSION_COOKIE, TRUST_COOKIE, type CommandType, type Enrollment } from "./api";

export type FormState = { error?: string; ok?: string } | undefined;

function message(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  // redirect() lança um erro especial: precisa subir
  throw e;
}

// ---------------------------------------------------------------- sessão

const cookieBase = { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax" as const, path: "/" };

export async function login(_: FormState, form: FormData): Promise<FormState> {
  const jar = await cookies();
  const result = await apiLogin(String(form.get("username") ?? ""), String(form.get("password") ?? ""), jar.get(TRUST_COOKIE)?.value);
  if ("error" in result) return { error: result.error };
  if (result.mfaRequired) {
    // etapa 2: sessão provisória no cookie (10 min) e a tela do código
    jar.set(MFA_COOKIE, result.token, { ...cookieBase, expires: new Date(result.expiresAt) });
    jar.set(
      MFA_INFO_COOKIE,
      JSON.stringify({ methods: result.methods, emailHint: result.emailHint, codeSent: result.codeSent, retryAfterSec: result.retryAfterSec, trustDays: result.trustDays, at: Date.now() }),
      { ...cookieBase, expires: new Date(result.expiresAt) },
    );
    redirect("/login/verify");
  }
  // rotação: a sessão que o navegador tinha antes é encerrada no servidor
  const previous = (await cookies()).get(SESSION_COOKIE)?.value;
  if (previous) await apiRevokeToken(previous);
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
  const body = {
    name: String(form.get("name") ?? ""),
    description: String(form.get("description") ?? ""),
    config: config.value ?? {},
    // o formulário sempre manda a lista (marcador presente), mesmo vazia
    ...(form.has("managedAppsPresent") ? { managedApps: form.getAll("managedApp").map(String) } : {}),
  };
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

// ---------------------------------------------------------------- comandos e apps (fase 4)

const COMMAND_LABEL: Record<CommandType, string> = {
  reboot: "Reiniciar",
  lock: "Bloquear tela",
  message: "Mensagem",
  screenshot: "Captura de tela",
  reload: "Recarregar kiosk",
  install_app: "Instalar app",
  uninstall_app: "Remover app",
};

/** Um comando para um ou vários aparelhos (campos deviceId repetidos). */
export async function sendCommand(_: FormState, form: FormData): Promise<FormState> {
  const deviceIds = form.getAll("deviceId").map(String);
  if (deviceIds.length === 0) return { error: "Selecione pelo menos um aparelho." };
  const type = String(form.get("type") ?? "") as CommandType;
  let payload: Record<string, unknown> = {};
  if (type === "message") {
    const text = String(form.get("text") ?? "").trim();
    if (!text) return { error: "Escreva a mensagem." };
    const title = String(form.get("title") ?? "").trim();
    payload = { text, ...(title ? { title } : {}) };
  } else if (type === "install_app") {
    const [packageName, versionCode] = String(form.get("app") ?? "").split("@");
    if (!packageName) return { error: "Escolha o app." };
    payload = { packageName, versionCode: versionCode ? Number(versionCode) : null };
  } else if (type === "uninstall_app") {
    const packageName = String(form.get("packageName") ?? "");
    if (!packageName) return { error: "Escolha o app." };
    payload = { packageName };
  } else if (!(type in COMMAND_LABEL)) {
    return { error: "Escolha o comando." };
  }
  try {
    const r = await api<{ created: number }>("/v1/admin/commands", { method: "POST", body: { deviceIds, type, payload } });
    for (const id of deviceIds) revalidatePath(`/devices/${id}`);
    return { ok: `${COMMAND_LABEL[type]}: enviado para ${r.created} aparelho(s). Chega no próximo contato (até 30 s).` };
  } catch (e) {
    return { error: message(e) };
  }
}

export async function cancelCommand(form: FormData) {
  try {
    await api(`/v1/admin/commands/${String(form.get("id"))}/cancel`, { method: "POST" });
  } catch (e) {
    if (!(e instanceof ApiError)) throw e;
  }
  revalidatePath(`/devices/${String(form.get("deviceId"))}`);
}

/** Token de uso único para o navegador mandar o APK direto para a API (a Vercel não aceita arquivos grandes). */
export async function uploadToken(): Promise<{ token: string; uploadUrl: string; kioskUploadUrl: string; maxApkMb: number } | { error: string }> {
  try {
    return await api<{ token: string; uploadUrl: string; kioskUploadUrl: string; maxApkMb: number }>("/v1/admin/apps/upload-token", { method: "POST" });
  } catch (e) {
    return { error: message(e) };
  }
}

export async function refreshApps() {
  revalidatePath("/apps");
}

export async function renameApp(_: FormState, form: FormData): Promise<FormState> {
  try {
    await api(`/v1/admin/apps/${encodeURIComponent(String(form.get("packageName")))}`, { method: "PATCH", body: { label: String(form.get("label") ?? "") } });
    revalidatePath("/apps");
    return { ok: "Nome salvo." };
  } catch (e) {
    return { error: message(e) };
  }
}

export async function deleteApp(_: FormState, form: FormData): Promise<FormState> {
  try {
    await api(`/v1/admin/apps/${encodeURIComponent(String(form.get("packageName")))}`, { method: "DELETE" });
  } catch (e) {
    return { error: message(e) };
  }
  revalidatePath("/apps");
  return { ok: "Removido do repositório." };
}

export async function deleteAppVersion(_: FormState, form: FormData): Promise<FormState> {
  try {
    await api(`/v1/admin/apps/${encodeURIComponent(String(form.get("packageName")))}/versions/${Number(form.get("versionCode"))}`, { method: "DELETE" });
  } catch (e) {
    return { error: message(e) };
  }
  revalidatePath("/apps");
  return { ok: "Versão removida." };
}

// ---------------------------------------------------------------- app do kiosk

export async function publishKiosk(_: FormState): Promise<FormState> {
  try {
    const r = await api<{ release: { versionName: string; versionCode: number } }>("/v1/admin/kiosk-release/publish", { method: "POST" });
    revalidatePath("/apps");
    return { ok: `Publicada a ${r.release.versionName} (${r.release.versionCode}). Os aparelhos com 0.4.0 ou mais nova se atualizam no próximo contato.` };
  } catch (e) {
    return { error: message(e) };
  }
}

export async function discardKiosk(_: FormState): Promise<FormState> {
  try {
    await api("/v1/admin/kiosk-release/pending", { method: "DELETE" });
    revalidatePath("/apps");
    return { ok: "Versão pendente descartada." };
  } catch (e) {
    return { error: message(e) };
  }
}

// ---------------------------------------------------------------- sessões, usuários e segurança (fase 1.1)

export async function revokeSession(form: FormData) {
  await api(`/v1/admin/sessions/${String(form.get("id"))}`, { method: "DELETE" });
  revalidatePath("/account");
  revalidatePath("/users");
}

export async function createUser(_: FormState, form: FormData): Promise<FormState> {
  const password = String(form.get("password") ?? "");
  if (password !== String(form.get("confirm") ?? "")) return { error: "As senhas não conferem." };
  try {
    await api("/v1/admin/users", {
      method: "POST",
      body: {
        username: String(form.get("username") ?? ""),
        email: String(form.get("email") ?? ""),
        role: String(form.get("role") ?? "operator"),
        password,
      },
    });
  } catch (e) {
    return { error: message(e) };
  }
  revalidatePath("/users");
  return { ok: "Usuário criado. Passe a senha inicial por um canal seguro." };
}

export async function updateUser(_: FormState, form: FormData): Promise<FormState> {
  const id = String(form.get("id"));
  const body: Record<string, unknown> = {};
  const email = String(form.get("email") ?? "").trim();
  if (email) body.email = email;
  const role = String(form.get("role") ?? "");
  if (role) body.role = role;
  const disabled = String(form.get("disabled") ?? "");
  if (disabled) body.disabled = disabled === "1";
  const password = String(form.get("password") ?? "");
  if (password) body.password = password;
  try {
    await api(`/v1/admin/users/${id}`, { method: "PATCH", body });
  } catch (e) {
    return { error: message(e) };
  }
  revalidatePath("/users");
  return { ok: "Salvo." };
}

export async function unlock(form: FormData) {
  await api("/v1/admin/security/unlock", { method: "POST", body: { kind: String(form.get("kind")), key: String(form.get("key")) } });
  revalidatePath("/users");
}

// ---------------------------------------------------------------- 2FA (fase 1.3a)

export type MfaState = { error?: string; ok?: string; attemptsLeft?: number; retryAfterSec?: number } | undefined;

/** Etapa 2: confere o código (e-mail ou recuperação). Deu certo: sessão normal, e o navegador fica confiável se pedido. */
export async function verifyMfa(_: MfaState, form: FormData): Promise<MfaState> {
  const jar = await cookies();
  const token = jar.get(MFA_COOKIE)?.value;
  if (!token) redirect("/login?etapa=expirou");
  const trustDevice = form.get("trust") === "on";
  const r = await apiMfa<{ token: string; expiresAt: string; trustToken: string | null; trustExpiresAt: string | null }>(token, "/v1/auth/mfa/verify", {
    method: String(form.get("method") ?? "email"),
    code: String(form.get("code") ?? ""),
    trustDevice,
  });
  if (r.status === 401) {
    jar.delete(MFA_COOKIE);
    jar.delete(MFA_INFO_COOKIE);
    redirect(`/login?etapa=${r.json.error === "too_many_attempts" ? "tentativas" : "expirou"}`);
  }
  if (r.status !== 200) return { error: r.json.message ?? "Código incorreto.", attemptsLeft: r.json.attemptsLeft, retryAfterSec: r.json.retryAfterSec };
  // rotação: a sessão anterior do navegador (se houver) sai no servidor
  const previous = jar.get(SESSION_COOKIE)?.value;
  if (previous) await apiRevokeToken(previous);
  jar.set(SESSION_COOKIE, r.json.token, { ...cookieBase, expires: new Date(r.json.expiresAt) });
  if (r.json.trustToken && r.json.trustExpiresAt) jar.set(TRUST_COOKIE, r.json.trustToken, { ...cookieBase, expires: new Date(r.json.trustExpiresAt) });
  jar.delete(MFA_COOKIE);
  jar.delete(MFA_INFO_COOKIE);
  redirect("/");
}

export async function resendMfaCode(_: MfaState): Promise<MfaState> {
  const token = (await cookies()).get(MFA_COOKIE)?.value;
  if (!token) redirect("/login?etapa=expirou");
  const r = await apiMfa<{ emailHint: string }>(token, "/v1/auth/mfa/email/send");
  if (r.status === 401) redirect("/login?etapa=expirou");
  if (r.status === 429) return { error: r.json.message, retryAfterSec: r.json.retryAfterSec };
  if (r.status !== 200) return { error: r.json.message ?? "Não foi possível enviar." };
  return { ok: `Código novo enviado para ${r.json.emailHint}.`, retryAfterSec: 60 };
}

export async function cancelMfa() {
  const jar = await cookies();
  jar.delete(MFA_COOKIE);
  jar.delete(MFA_INFO_COOKIE);
  redirect("/login");
}

export type RecoveryState = { codes?: string[]; error?: string } | undefined;

export async function generateRecoveryCodes(_: RecoveryState): Promise<RecoveryState> {
  try {
    const r = await api<{ codes: string[] }>("/v1/admin/mfa/recovery-codes", { method: "POST" });
    revalidatePath("/account");
    return { codes: r.codes };
  } catch (e) {
    return { error: message(e) };
  }
}

export async function revokeTrustedDevice(form: FormData) {
  await api(`/v1/admin/mfa/trusted-devices/${String(form.get("id"))}`, { method: "DELETE" });
  revalidatePath("/account");
}

export async function resetUserMfa(_: FormState, form: FormData): Promise<FormState> {
  try {
    await api(`/v1/admin/users/${String(form.get("id"))}/reset-mfa`, { method: "POST" });
  } catch (e) {
    return { error: message(e) };
  }
  revalidatePath("/users");
  return { ok: "2FA zerado: códigos de recuperação e navegadores confiáveis apagados; sessões encerradas." };
}

// ---------------------------------------------------------------- app autenticador (fase 1.3b)

export type TotpSetupState = { secret?: string; svg?: string; error?: string } | undefined;

/** Passo 1: senha atual → chave nova e QR Code (o SVG é gerado aqui, a partir do otpauth:// da API). */
export async function setupTotp(_: TotpSetupState, form: FormData): Promise<TotpSetupState> {
  try {
    const r = await api<{ secret: string; uri: string }>("/v1/admin/mfa/totp/setup", {
      method: "POST",
      body: { password: String(form.get("password") ?? "") },
    });
    const svg = await QRCode.toString(r.uri, { type: "svg", errorCorrectionLevel: "M", margin: 2 });
    return { secret: r.secret, svg };
  } catch (e) {
    return { error: message(e) };
  }
}

/** Passo 2: o primeiro código do app confirma a ativação. */
export async function confirmTotp(_: FormState, form: FormData): Promise<FormState> {
  try {
    await api("/v1/admin/mfa/totp/confirm", { method: "POST", body: { code: String(form.get("code") ?? "") } });
  } catch (e) {
    return { error: message(e) };
  }
  revalidatePath("/account");
  return { ok: "App autenticador ativado. No próximo login o código será pedido pelo app." };
}

export async function disableTotp(_: FormState, form: FormData): Promise<FormState> {
  try {
    await api("/v1/admin/mfa/totp/disable", { method: "POST", body: { password: String(form.get("password") ?? "") } });
  } catch (e) {
    return { error: message(e) };
  }
  revalidatePath("/account");
  return { ok: "App autenticador desativado. O código volta a ser enviado por e-mail." };
}

// ---------------------------------------------------------------- passkeys (fase 1.3c)
// Chamadas a partir do navegador (componentes cliente): o navegador faz a cerimônia WebAuthn no meio.

type PasskeyOptions = { challengeId: string; options: Record<string, unknown> };
export type PasskeyStep = { ok?: boolean; error?: string; challengeId?: string; options?: Record<string, unknown> };

/** Sessão normal no cookie (rotação: a anterior do navegador sai) e fim da etapa 2, se houver. */
async function startSession(r: { token: string; expiresAt: string; trustToken?: string | null; trustExpiresAt?: string | null }) {
  const jar = await cookies();
  const previous = jar.get(SESSION_COOKIE)?.value;
  if (previous) await apiRevokeToken(previous);
  jar.set(SESSION_COOKIE, r.token, { ...cookieBase, expires: new Date(r.expiresAt) });
  if (r.trustToken && r.trustExpiresAt) jar.set(TRUST_COOKIE, r.trustToken, { ...cookieBase, expires: new Date(r.trustExpiresAt) });
  jar.delete(MFA_COOKIE);
  jar.delete(MFA_INFO_COOKIE);
}

/** "Entrar com passkey" (sem usuário e senha): 1. desafio. */
export async function passkeyLoginOptions(): Promise<PasskeyStep> {
  const r = await apiAnon<PasskeyOptions>("/v1/auth/passkey/options");
  if (r.status !== 200) return { error: r.json.message ?? "Não foi possível começar." };
  return { challengeId: r.json.challengeId, options: r.json.options };
}

/** 2. resposta do navegador → sessão. */
export async function passkeyLoginFinish(challengeId: string, response: unknown): Promise<PasskeyStep> {
  const r = await apiAnon<{ token: string; expiresAt: string }>("/v1/auth/passkey/verify", { challengeId, response });
  if (r.status !== 200) return { error: r.json.message ?? "Não foi possível entrar com esta passkey." };
  await startSession(r.json);
  return { ok: true };
}

/** Etapa 2 do login (depois da senha) com passkey. */
export async function mfaPasskeyOptions(): Promise<PasskeyStep> {
  const token = (await cookies()).get(MFA_COOKIE)?.value;
  if (!token) return { error: "A confirmação expirou. Entre de novo." };
  const r = await apiMfa<PasskeyOptions>(token, "/v1/auth/mfa/passkey/options");
  if (r.status !== 200) return { error: r.json.message ?? "Não foi possível começar." };
  return { challengeId: r.json.challengeId, options: r.json.options };
}

export async function mfaPasskeyFinish(challengeId: string, response: unknown, trustDevice: boolean): Promise<PasskeyStep> {
  const token = (await cookies()).get(MFA_COOKIE)?.value;
  if (!token) return { error: "A confirmação expirou. Entre de novo." };
  const r = await apiMfa<{ token: string; expiresAt: string; trustToken: string | null; trustExpiresAt: string | null }>(token, "/v1/auth/mfa/passkey/verify", {
    challengeId,
    response,
    trustDevice,
  });
  if (r.status !== 200) return { error: r.json.message ?? "Passkey não confirmada." };
  await startSession(r.json);
  return { ok: true };
}

/** Conta → Adicionar passkey: 1. senha atual → desafio. */
export async function registerPasskeyOptions(password: string): Promise<PasskeyStep> {
  try {
    const r = await api<PasskeyOptions>("/v1/admin/passkeys/register/options", { method: "POST", body: { password } });
    return { challengeId: r.challengeId, options: r.options };
  } catch (e) {
    return { error: message(e) };
  }
}

/** 2. resposta do navegador → passkey cadastrada. */
export async function registerPasskeyFinish(challengeId: string, response: unknown, name: string): Promise<PasskeyStep> {
  try {
    await api("/v1/admin/passkeys/register/verify", { method: "POST", body: { challengeId, response, name } });
  } catch (e) {
    return { error: message(e) };
  }
  revalidatePath("/account");
  return { ok: true };
}

export async function removePasskey(form: FormData) {
  await api(`/v1/admin/passkeys/${String(form.get("id"))}`, { method: "DELETE" });
  revalidatePath("/account");
}

// ---------------------------------------------------------------- acompanhamento de operações (fase 2.3)

/** Ingresso de uso único (60 s) para a tela abrir a conexão ao vivo direto na API. */
export async function opsStreamTicket(): Promise<{ ticket?: string; url?: string; error?: string }> {
  try {
    const r = await api<{ ticket: string; url: string }>("/v1/admin/ops/stream-ticket", { method: "POST" });
    return { ticket: r.ticket, url: r.url };
  } catch (e) {
    return { error: message(e) };
  }
}
