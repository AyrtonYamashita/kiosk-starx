"use client";

import { startAuthentication, startRegistration } from "@simplewebauthn/browser";
import type { PublicKeyCredentialCreationOptionsJSON, PublicKeyCredentialRequestOptionsJSON } from "@simplewebauthn/browser";

/** Erros da janela do navegador (biometria/PIN) em português. */
export function passkeyError(e: unknown): string {
  const name = (e as { name?: string })?.name;
  if (name === "NotAllowedError" || name === "AbortError") return "Cancelado ou tempo esgotado. Tente de novo.";
  if (name === "InvalidStateError") return "Esta passkey já está cadastrada nesta conta.";
  if (name === "SecurityError") return "Este endereço não pode usar passkeys (confira se está em kiosk.pstarx.com).";
  if (name === "NotSupportedError") return "Este navegador ou aparelho não suporta passkeys.";
  return (e as Error)?.message || "Não foi possível usar a passkey.";
}

export async function getAssertion(options: Record<string, unknown>) {
  return startAuthentication({ optionsJSON: options as unknown as PublicKeyCredentialRequestOptionsJSON });
}

export async function createCredential(options: Record<string, unknown>) {
  return startRegistration({ optionsJSON: options as unknown as PublicKeyCredentialCreationOptionsJSON });
}

/** Nome sugerido para a passkey nova ("Windows", "Android", "iPhone"…). */
export function suggestedName(): string {
  const ua = typeof navigator === "undefined" ? "" : navigator.userAgent;
  if (/Windows/.test(ua)) return "Windows Hello";
  if (/Android/.test(ua)) return "Android";
  if (/iPhone/.test(ua)) return "iPhone";
  if (/iPad/.test(ua)) return "iPad";
  if (/Mac OS/.test(ua)) return "Mac";
  return "Passkey";
}
