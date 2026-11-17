import crypto from "node:crypto";

/**
 * Aplicativo autenticador (TOTP, RFC 6238 / HOTP RFC 4226): HMAC-SHA1, 6 dígitos, passo de 30 s — o padrão que todos
 * os apps (Google/Microsoft Authenticator, Authy, 1Password...) entendem.
 */
export const TOTP_STEP_SEC = 30;
export const TOTP_DIGITS = 6;
/** Aceita 1 passo para cada lado (relógio do celular até ~30 s fora). */
export const TOTP_WINDOW = 1;

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(s: string): Buffer {
  const clean = s.toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    value = (value << 5) | B32.indexOf(ch);
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** Chave nova: 20 bytes (160 bits, o recomendado para SHA-1), em base32. */
export function newTotpSecret(): string {
  return base32Encode(crypto.randomBytes(20));
}

export function currentStep(nowMs = Date.now()): number {
  return Math.floor(nowMs / 1000 / TOTP_STEP_SEC);
}

export function totpAt(secretB32: string, step: number): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const h = crypto.createHmac("sha1", base32Decode(secretB32)).update(counter).digest();
  const offset = h[h.length - 1] & 0x0f;
  const bin = (h.readUInt32BE(offset) & 0x7fffffff) % 10 ** TOTP_DIGITS;
  return String(bin).padStart(TOTP_DIGITS, "0");
}

/**
 * Confere o código na janela (±1 passo) e devolve o passo que bateu, ou null. Passos até `lastStep` (já usados) não
 * valem: o mesmo código não entra duas vezes.
 */
export function verifyTotp(secretB32: string, code: string, lastStep: number | null, nowMs = Date.now()): number | null {
  const digits = code.replace(/\D/g, "");
  if (digits.length !== TOTP_DIGITS) return null;
  const now = currentStep(nowMs);
  let hit: number | null = null;
  for (let s = now - TOTP_WINDOW; s <= now + TOTP_WINDOW; s++) {
    // compara todos (tempo constante na janela); guarda o passo que bateu
    const ok = crypto.timingSafeEqual(Buffer.from(totpAt(secretB32, s)), Buffer.from(digits));
    if (ok && hit === null) hit = s;
  }
  if (hit === null) return null;
  if (lastStep !== null && hit <= lastStep) return null;
  return hit;
}

/** otpauth://totp/StarX%20Kiosk:usuario?secret=...&issuer=StarX%20Kiosk (o QR Code dos apps). */
export function otpauthUri(secretB32: string, account: string, issuer = "StarX Kiosk"): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const q = new URLSearchParams({ secret: secretB32, issuer, algorithm: "SHA1", digits: String(TOTP_DIGITS), period: String(TOTP_STEP_SEC) });
  return `otpauth://totp/${label}?${q.toString()}`;
}

// ---------------------------------------------------------------- chave guardada criptografada

function key(authSecret: string): Buffer {
  return Buffer.from(crypto.hkdfSync("sha256", authSecret, "starx-kiosk", "totp-secret-v1", 32));
}

/** "v1.<iv>.<tag>.<cifra>" (base64url), AES-256-GCM. */
export function encryptSecret(authSecret: string, plain: string): string {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", key(authSecret), iv);
  const enc = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return ["v1", iv.toString("base64url"), c.getAuthTag().toString("base64url"), enc.toString("base64url")].join(".");
}

export function decryptSecret(authSecret: string, stored: string): string {
  const [v, iv, tag, enc] = stored.split(".");
  if (v !== "v1") throw new Error("formato de chave TOTP desconhecido");
  const d = crypto.createDecipheriv("aes-256-gcm", key(authSecret), Buffer.from(iv, "base64url"));
  d.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([d.update(Buffer.from(enc, "base64url")), d.final()]).toString("utf8");
}
