import fs from "node:fs";
import path from "node:path";
import { z } from "zod";

/** APK do app publicado (escrito pelo build: android/ → publishApk). */
export const Release = z.object({
  packageName: z.string(),
  versionCode: z.number().int(),
  versionName: z.string(),
  file: z.string().regex(/^[A-Za-z0-9._-]+\.apk$/),
  sizeBytes: z.number().int(),
  sha256: z.string(),
  /** SHA-256 do certificado de assinatura, base64url: vai no QR (PROVISIONING_DEVICE_ADMIN_SIGNATURE_CHECKSUM). */
  signatureChecksum: z.string(),
  builtAt: z.string(),
});
export type Release = z.infer<typeof Release>;

export function readRelease(apkDir: string): Release | null {
  const file = path.join(apkDir, "release.json");
  if (!fs.existsSync(file)) return null;
  const parsed = Release.safeParse(JSON.parse(fs.readFileSync(file, "utf8")));
  if (!parsed.success) return null;
  if (!fs.existsSync(path.join(apkDir, parsed.data.file))) return null;
  return parsed.data;
}

export interface QrOptions {
  publicUrl: string;
  code: string;
  initialConfig: unknown | null;
  wifi?: { ssid: string; password?: string; security?: "WPA" | "WEP" | "NONE"; hidden?: boolean };
}

/**
 * Conteúdo do QR de provisionamento (Android 7+: 6 toques na tela de boas-vindas → leitor de QR).
 * Os extras do admin chegam ao app no fim do provisionamento: endereço do painel, código e configuração inicial.
 */
export function provisioningPayload(release: Release, o: QrOptions): Record<string, unknown> {
  const extras: Record<string, string> = { server_url: o.publicUrl, enrollment_code: o.code };
  if (o.initialConfig) extras.config = JSON.stringify(o.initialConfig);
  const payload: Record<string, unknown> = {
    "android.app.extra.PROVISIONING_DEVICE_ADMIN_COMPONENT_NAME": `${release.packageName}/.admin.AdminReceiver`,
    "android.app.extra.PROVISIONING_DEVICE_ADMIN_PACKAGE_DOWNLOAD_LOCATION": `${o.publicUrl}/apks/${release.file}`,
    "android.app.extra.PROVISIONING_DEVICE_ADMIN_SIGNATURE_CHECKSUM": release.signatureChecksum,
    "android.app.extra.PROVISIONING_LEAVE_ALL_SYSTEM_APPS_ENABLED": true,
    "android.app.extra.PROVISIONING_SKIP_ENCRYPTION": true,
    "android.app.extra.PROVISIONING_ADMIN_EXTRAS_BUNDLE": extras,
  };
  if (o.wifi?.ssid) {
    payload["android.app.extra.PROVISIONING_WIFI_SSID"] = o.wifi.ssid;
    payload["android.app.extra.PROVISIONING_WIFI_SECURITY_TYPE"] = o.wifi.security ?? (o.wifi.password ? "WPA" : "NONE");
    if (o.wifi.password) payload["android.app.extra.PROVISIONING_WIFI_PASSWORD"] = o.wifi.password;
    if (o.wifi.hidden) payload["android.app.extra.PROVISIONING_WIFI_HIDDEN"] = true;
  }
  return payload;
}
