import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { base32Decode, base32Encode, currentStep, decryptSecret, encryptSecret, totpAt, verifyTotp } from "../src/totp.js";
import { codeFrom, setupApi } from "./helpers.js";

describe("TOTP (RFC 6238)", () => {
  // vetor oficial do RFC 6238 (SHA-1, chave "12345678901234567890"), 6 dígitos = os 6 finais de 8
  const RFC = base32Encode(Buffer.from("12345678901234567890"));
  it("bate com o vetor do RFC", () => {
    expect(RFC).toBe("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ");
    expect(base32Decode(RFC).toString()).toBe("12345678901234567890");
    expect(totpAt(RFC, Math.floor(59 / 30))).toBe("287082");
    expect(totpAt(RFC, Math.floor(1111111109 / 30))).toBe("081804");
    expect(totpAt(RFC, Math.floor(2000000000 / 30))).toBe("279037");
  });
  it("aceita ±30 s e recusa fora da janela e passos já usados", () => {
    const now = 1_800_000_000_000;
    const s = currentStep(now);
    expect(verifyTotp(RFC, totpAt(RFC, s - 1), null, now)).toBe(s - 1);
    expect(verifyTotp(RFC, totpAt(RFC, s + 1), null, now)).toBe(s + 1);
    expect(verifyTotp(RFC, totpAt(RFC, s - 2), null, now)).toBeNull();
    expect(verifyTotp(RFC, totpAt(RFC, s), s, now)).toBeNull(); // replay
    expect(verifyTotp(RFC, "12345", null, now)).toBeNull();
  });
  it("a chave guardada é criptografada e só abre com o mesmo segredo", () => {
    const enc = encryptSecret("a".repeat(40), RFC);
    expect(enc).not.toContain(RFC);
    expect(decryptSecret("a".repeat(40), enc)).toBe(RFC);
    expect(() => decryptSecret("b".repeat(40), enc)).toThrow();
  });
});

let t: Awaited<ReturnType<typeof setupApi>>;
const PW = "senha-de-teste-123";
const login = async () => (await t.api("POST", "/v1/admin/login", { username: "admin", password: PW }, "")).json;
const verify = (token: string, method: string, code: string) => t.api("POST", "/v1/auth/mfa/verify", { method, code }, token);

/** Ativa o app na conta do admin e devolve a chave. */
async function enable(): Promise<string> {
  const setup = await t.api("POST", "/v1/admin/mfa/totp/setup", { password: PW }, t.adminToken);
  expect(setup.status).toBe(200);
  expect(setup.json.uri).toMatch(/^otpauth:\/\/totp\/StarX%20Kiosk%3Aadmin%40pstarx\.com\?secret=[A-Z2-7]+&issuer=StarX\+Kiosk/);
  const ok = await t.api("POST", "/v1/admin/mfa/totp/confirm", { code: totpAt(setup.json.secret, currentStep()) }, t.adminToken);
  expect(ok.status).toBe(200);
  return setup.json.secret;
}

describe("app autenticador no login", () => {
  beforeAll(async () => {
    t = await setupApi({ config: { authRequire2fa: true } });
  });
  beforeEach(async () => {
    await t.db.query("DELETE FROM auth_lockouts");
    await t.db.query("DELETE FROM email_otps");
    await t.db.query("DELETE FROM admin_totp");
  });
  afterAll(async () => t?.close());

  it("ativar exige a senha atual e um código do app; sem confirmar não vale", async () => {
    expect((await t.api("POST", "/v1/admin/mfa/totp/setup", { password: "errada-xxxxxx" }, t.adminToken)).status).toBe(400);
    const setup = await t.api("POST", "/v1/admin/mfa/totp/setup", { password: PW }, t.adminToken);
    // no banco a chave não aparece em claro
    const row = (await t.db.query("SELECT secret_enc, confirmed_at FROM admin_totp")).rows[0];
    expect(row.secret_enc).not.toContain(setup.json.secret);
    expect(row.confirmed_at).toBeNull();
    expect((await login()).methods).not.toContain("totp"); // não confirmado
    expect((await t.api("POST", "/v1/admin/mfa/totp/confirm", { code: "000000" }, t.adminToken)).status).toBe(400);
    expect((await t.api("GET", "/v1/admin/mfa", undefined, t.adminToken)).json.totp.enabled).toBe(false);
  });

  it("ativo: o login pede o app e o e-mail não sai sozinho; o código entra uma vez só", async () => {
    const secret = await enable();
    expect((await t.api("GET", "/v1/admin/mfa", undefined, t.adminToken)).json.totp.enabled).toBe(true);
    const before = t.sent.length;
    const r = await login();
    expect(r).toMatchObject({ mfaRequired: true, methods: ["totp", "email"], codeSent: false });
    await new Promise((res) => setTimeout(res, 20));
    expect(t.sent.length).toBe(before);
    // próximo passo (relógio do celular adiantado): ainda vale
    const code = totpAt(secret, currentStep() + 1);
    const ok = await verify(r.token, "totp", code);
    expect(ok.status).toBe(200);
    expect((await t.api("GET", "/v1/admin/me", undefined, ok.json.token)).status).toBe(200);
    // replay do mesmo código numa etapa nova
    const r2 = await login();
    expect((await verify(r2.token, "totp", code)).status).toBe(400);
    // nem o código anterior
    expect((await verify(r2.token, "totp", totpAt(secret, currentStep()))).status).toBe(400);
  });

  it("sem o celular: pede o código por e-mail na própria etapa", async () => {
    await enable();
    const r = await login();
    expect((await t.api("POST", "/v1/auth/mfa/email/send", undefined, r.token)).status).toBe(200);
    await new Promise((res) => setTimeout(res, 20));
    const ok = await verify(r.token, "email", codeFrom(t.sent[t.sent.length - 1]));
    expect(ok.status).toBe(200);
  });

  it("5 códigos errados derrubam a etapa e bloqueiam a conta", async () => {
    await enable();
    const r = await login();
    for (let i = 0; i < 4; i++) expect((await verify(r.token, "totp", "000000")).status).toBe(400);
    expect((await verify(r.token, "totp", "000000")).status).toBe(401);
    expect((await t.api("POST", "/v1/admin/login", { username: "admin", password: PW }, "")).status).toBe(429);
  });

  it("desativar exige a senha; zerar o 2FA também remove o app; auditoria registra", async () => {
    await enable();
    expect((await t.api("POST", "/v1/admin/mfa/totp/disable", { password: "errada-xxxxxx" }, t.adminToken)).status).toBe(400);
    await t.db.query("DELETE FROM auth_lockouts");
    expect((await t.api("POST", "/v1/admin/mfa/totp/disable", { password: PW }, t.adminToken)).status).toBe(200);
    expect((await login()).methods).not.toContain("totp");

    await enable();
    const meId = (await t.api("GET", "/v1/admin/me", undefined, t.adminToken)).json.id;
    expect((await t.api("POST", `/v1/admin/users/${meId}/reset-mfa`, undefined, t.adminToken)).status).toBe(200);
    expect((await t.api("GET", "/v1/admin/mfa", undefined, t.adminToken)).json.totp.enabled).toBe(false);

    const ev = (await t.api("GET", "/v1/admin/security/events?limit=500", undefined, t.adminToken)).json.events.map((e: { event: string }) => e.event);
    for (const k of ["totp_enabled", "totp_disabled", "password_check_failed"]) expect(ev).toContain(k);
  });
});
