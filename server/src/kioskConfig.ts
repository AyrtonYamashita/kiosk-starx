import crypto from "node:crypto";
import { z } from "zod";

/**
 * Configuração do kiosk (mesmo formato do app: android/.../config/KioskConfig.kt e docs/configuracao.md).
 * No servidor tudo é opcional (campo ausente = padrão no aparelho), mas nomes e tipos são conferidos: um erro de
 * digitação no editor JSON vira erro aqui, e não um campo ignorado em silêncio no aparelho.
 */
const pkg = z.string().regex(/^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z0-9_]+)+$/, "nome de pacote inválido");
const color = z.string().regex(/^#([0-9A-Fa-f]{6}|[0-9A-Fa-f]{8})$/, "cor #RRGGBB");
const url = z.string().refine((u) => u === "" || /^https?:\/\//i.test(u), "precisa começar com http:// ou https://");

export const PinHash = z
  .object({ algo: z.literal("pbkdf2-sha256"), iterations: z.number().int(), salt: z.string(), hash: z.string(), numeric: z.boolean() })
  .strict();
export type PinHash = z.infer<typeof PinHash>;

/** Marcador que o painel usa para "manter o PIN já definido" (o hash nunca vai para o navegador). */
export const PIN_KEEP = "<definido>";

export const KioskConfigInput = z
  .object({
    schema: z.number().int().optional(),
    kiosk: z
      .object({
        enabled: z.boolean(),
        mode: z.enum(["app", "apps", "web"]),
        app: pkg.nullable(),
        apps: z.array(pkg).max(200),
        relaunchDelaySec: z.number().int().min(0).max(300),
        web: z
          .object({
            url,
            reloadOnErrorSec: z.number().int().min(0).max(3600),
            inactivityReturnSec: z.number().int().min(0).max(86_400),
            allowZoom: z.boolean(),
          })
          .partial()
          .strict(),
      })
      .partial()
      .strict(),
    display: z
      .object({
        keepScreenOn: z.boolean(),
        brightness: z.number().int().min(0).max(100).nullable(),
        orientation: z.enum(["auto", "portrait", "landscape"]),
        showStatusBar: z.boolean(),
      })
      .partial()
      .strict(),
    appearance: z
      .object({ title: z.string().max(80), backgroundColor: color, textColor: color, columns: z.number().int().min(2).max(8) })
      .partial()
      .strict(),
    security: z
      .object({
        /** PIN em texto: só na entrada; vira pinHash antes de gravar. */
        pin: z.string().min(4, "o PIN precisa ter pelo menos 4 caracteres").max(32).regex(/^\S+$/, "o PIN não pode ter espaços"),
        pinHash: z.union([PinHash, z.literal(PIN_KEEP), z.null()]),
        exitCorner: z.enum(["top_left", "top_right", "bottom_left", "bottom_right"]),
        exitTaps: z.number().int().min(3).max(10),
        allowNotifications: z.boolean(),
        allowPowerMenu: z.boolean(),
        disableLockScreen: z.boolean(),
        blockFactoryReset: z.boolean(),
        blockSafeBoot: z.boolean(),
        blockUsbFileTransfer: z.boolean(),
        blockDebugging: z.boolean(),
        systemSettingsShortcuts: z.boolean(),
      })
      .partial()
      .strict(),
  })
  .partial()
  .strict();
export type KioskConfigInput = z.infer<typeof KioskConfigInput>;
export type StoredConfig = Record<string, unknown>;

const PIN_ITERATIONS = 100_000;

/** Mesmo hash do app (Pin.kt): PBKDF2-HMAC-SHA256, 32 bytes, salt de 16 bytes. */
export function hashPin(pin: string): PinHash {
  const salt = crypto.randomBytes(16);
  const hash = crypto.pbkdf2Sync(Buffer.from(pin, "utf8"), salt, PIN_ITERATIONS, 32, "sha256");
  return { algo: "pbkdf2-sha256", iterations: PIN_ITERATIONS, salt: salt.toString("base64"), hash: hash.toString("base64"), numeric: /^\d+$/.test(pin) };
}

export function verifyPin(pin: string, h: PinHash): boolean {
  const out = crypto.pbkdf2Sync(Buffer.from(pin, "utf8"), Buffer.from(h.salt, "base64"), h.iterations, 32, "sha256");
  return crypto.timingSafeEqual(out, Buffer.from(h.hash, "base64"));
}

export type Validated = { ok: true; config: StoredConfig } | { ok: false; errors: string[] };

/**
 * Valida a entrada do painel e prepara para gravar:
 *  - `security.pin` → `security.pinHash` (o texto não é gravado);
 *  - `security.pinHash: "<definido>"` → mantém o hash de `previous` (ou some, se não havia).
 */
export function prepareConfig(input: unknown, previous: StoredConfig | null): Validated {
  const parsed = KioskConfigInput.safeParse(input ?? {});
  if (!parsed.success) {
    return { ok: false, errors: parsed.error.issues.map((i) => `${i.path.join(".") || "(raiz)"}: ${i.message}`) };
  }
  const config = structuredClone(parsed.data) as Record<string, any>;
  delete config.schema;
  const sec = config.security as Record<string, unknown> | undefined;
  if (sec) {
    if (typeof sec.pin === "string") {
      sec.pinHash = hashPin(sec.pin);
      delete sec.pin;
    } else if (sec.pinHash === PIN_KEEP) {
      const prev = (previous?.security as Record<string, unknown> | undefined)?.pinHash;
      if (prev && typeof prev === "object") sec.pinHash = prev;
      else delete sec.pinHash;
    }
  }
  return { ok: true, config };
}

/** Para o navegador: o hash do PIN vira o marcador "<definido>". */
export function redactConfig<T>(config: T): T {
  if (!config || typeof config !== "object") return config;
  const copy = structuredClone(config) as Record<string, any>;
  if (copy.security?.pinHash && typeof copy.security.pinHash === "object") copy.security.pinHash = PIN_KEEP;
  return copy as T;
}

/** Mesma regra do app (KioskConfig.merge): objetos mesclados; listas e demais valores substituem; null apaga. */
export function mergeConfig(base: unknown, patch: unknown): StoredConfig {
  const out: Record<string, unknown> = structuredClone((base ?? {}) as Record<string, unknown>);
  if (!patch || typeof patch !== "object") return out;
  for (const [k, v] of Object.entries(patch as Record<string, unknown>)) {
    const b = out[k];
    if (v && typeof v === "object" && !Array.isArray(v) && b && typeof b === "object" && !Array.isArray(b)) out[k] = mergeConfig(b, v);
    else out[k] = v;
  }
  return out;
}

/** JSON com chaves ordenadas: o mesmo conteúdo dá sempre o mesmo hash. */
export function stableStringify(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(",")}]`;
  if (v && typeof v === "object") {
    return `{${Object.keys(v as object)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableStringify((v as Record<string, unknown>)[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(v);
}

/**
 * Configuração desejada de um aparelho: perfil + ajustes do aparelho. Sem perfil e sem ajustes = nada a aplicar
 * (o aparelho fica com a configuração local).
 */
export function desiredConfig(profileConfig: StoredConfig | null, overrides: StoredConfig | null, nonce: number) {
  if (!profileConfig && !overrides) return null;
  const config = mergeConfig(profileConfig ?? {}, overrides ?? {});
  config.schema = 1;
  const hash = crypto.createHash("sha256").update(`${stableStringify(config)}#${nonce}`).digest("hex").slice(0, 32);
  return { config, hash };
}
