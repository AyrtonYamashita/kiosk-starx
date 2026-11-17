import crypto from "node:crypto";

/**
 * Códigos do 2FA (e-mail e recuperação): gerador criptográfico, alfabeto sem caracteres ambíguos (sem 0/O, 1/I/L),
 * 8 caracteres, guardados só como HMAC-SHA256 com o segredo do servidor (AUTH_SECRET) — um vazamento do banco não
 * permite testar códigos fora da API.
 */
export const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const CODE_LENGTH = 8;

export function newCode(): string {
  let s = "";
  for (let i = 0; i < CODE_LENGTH; i++) s += CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)];
  return s;
}

/** "abcd-2345" → "ABCD2345" (aceita minúsculas, espaço e hífen). */
export function normalizeCode(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/** "ABCD2345" → "ABCD-2345" (mais fácil de ler e digitar). */
export function formatCode(code: string): string {
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

export function codeHmac(secret: string, code: string): string {
  return crypto.createHmac("sha256", secret).update(normalizeCode(code)).digest("hex");
}

export function hmacEqual(a: string, b: string): boolean {
  const x = Buffer.from(a, "hex");
  const y = Buffer.from(b, "hex");
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

/** "ayrtonyamashita@pstarx.com" → "ay••••••@pstarx.com" */
export function maskEmail(email: string): string {
  const [user, domain] = email.split("@");
  return `${user.slice(0, 2)}${"•".repeat(Math.max(3, Math.min(8, user.length - 2)))}@${domain}`;
}

// ---------------------------------------------------------------- e-mail

export interface MailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
  /** Mesmo envio repetido (nova tentativa) não vira dois e-mails. */
  idempotencyKey: string;
}
export type Mailer = (msg: MailMessage) => Promise<void>;

/**
 * Envio pelo Resend (a chave só existe no servidor). Três tentativas com espera crescente; erro definitivo (4xx que
 * não é 429) não tenta de novo. Lança se não conseguir.
 */
export function resendMailer(apiKey: string, from: string): Mailer {
  return async (msg) => {
    let last = "";
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt) await new Promise((r) => setTimeout(r, attempt * 2000));
      try {
        const res = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json", "idempotency-key": msg.idempotencyKey },
          body: JSON.stringify({ from, to: [msg.to], subject: msg.subject, html: msg.html, text: msg.text }),
          signal: AbortSignal.timeout(15_000),
        });
        if (res.ok) return;
        last = `HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`;
        if (res.status < 500 && res.status !== 429) break;
      } catch (e) {
        last = (e as Error).message;
      }
    }
    throw new Error(`Resend falhou: ${last}`);
  };
}

/** Sem chave configurada (desenvolvimento): só registra no log que um e-mail seria enviado (sem o código). */
export function logMailer(log: { warn: (o: object, m: string) => void }): Mailer {
  // DEV_LOG_OTP=true (só desenvolvimento local, sem Resend): o texto do e-mail vai para o log para testar a tela
  const devText = process.env.DEV_LOG_OTP === "true" && process.env.NODE_ENV !== "production";
  return async (msg) =>
    log.warn({ to: msg.to, subject: msg.subject, ...(devText ? { text: msg.text } : {}) }, "RESEND_API_KEY ausente: e-mail não enviado");
}

export function otpEmail(o: { code: string; ttlMin: number; ip: string; browser: string }) {
  const code = formatCode(o.code);
  const text = [
    `Seu código de acesso ao painel StarX Kiosk: ${code}`,
    "",
    `Ele vale por ${o.ttlMin} minutos e só pode ser usado uma vez.`,
    `Pedido de: ${o.ip} · ${o.browser}`,
    "",
    "Se não foi você, ignore este e-mail e troque sua senha: alguém acertou a senha da sua conta.",
  ].join("\n");
  const html = `<!doctype html><html><body style="margin:0;background:#FAFAFA;font-family:Outfit,Arial,sans-serif;color:#141414">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:32px 16px"><tr><td align="center">
    <table role="presentation" width="420" cellpadding="0" cellspacing="0" style="max-width:420px;background:#FFFFFF;border:1px solid #DDDDDD;border-radius:10px">
      <tr><td style="padding:24px 24px 8px;font-size:18px;font-weight:600">Código de acesso</td></tr>
      <tr><td style="padding:0 24px;font-size:13px;color:#595959">Use este código para concluir a entrada no painel StarX Kiosk.</td></tr>
      <tr><td style="padding:20px 24px">
        <div style="font-family:'IBM Plex Mono',Consolas,monospace;font-size:28px;font-weight:600;letter-spacing:4px;color:#003659;background:#EEF7FF;border:1px solid #98CEFF;border-radius:8px;padding:14px;text-align:center">${code}</div>
      </td></tr>
      <tr><td style="padding:0 24px 8px;font-size:12px;color:#595959">Vale por ${o.ttlMin} minutos e só pode ser usado uma vez.</td></tr>
      <tr><td style="padding:0 24px 20px;font-size:11px;color:#8C8C8C">Pedido de ${escapeHtml(o.ip)} · ${escapeHtml(o.browser)}.<br>Se não foi você, ignore este e-mail e troque sua senha: alguém acertou a senha da sua conta.</td></tr>
    </table>
  </td></tr></table></body></html>`;
  return { subject: `Código de acesso: ${code}`, text, html };
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

/** Navegador e sistema (resumo para o e-mail). */
export function browserLabel(ua: string | undefined): string {
  if (!ua) return "navegador desconhecido";
  const b = /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "Navegador";
  const os = /Windows/.test(ua) ? "Windows" : /Android/.test(ua) ? "Android" : /iPhone|iPad/.test(ua) ? "iOS" : /Mac OS/.test(ua) ? "macOS" : /Linux/.test(ua) ? "Linux" : "";
  return os ? `${b} no ${os}` : b;
}
