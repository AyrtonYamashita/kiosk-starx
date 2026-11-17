import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { codeFrom, setupApi } from "./helpers.js";

let t: Awaited<ReturnType<typeof setupApi>>;
let ipN = 1;
const PW = "senha-de-teste-123";

async function login(body: Record<string, unknown> = {}) {
  const res = await t.app.inject({
    method: "POST",
    url: "/v1/admin/login",
    payload: { username: "admin", password: PW, ...body },
    headers: { "x-panel-secret": "segredo-do-painel-de-teste", "x-client-ip": `192.0.2.${ipN++}`, "x-client-ua": "Mozilla/5.0 (Windows NT 10.0) Chrome/130" },
  });
  return { status: res.statusCode, json: res.json(), headers: res.headers };
}
const verify = (token: string, code: string, extra: Record<string, unknown> = {}) => t.api("POST", "/v1/auth/mfa/verify", { method: "email", code, ...extra }, token);
const lastCode = async () => {
  await new Promise((r) => setTimeout(r, 20));
  return codeFrom(t.sent[t.sent.length - 1]);
};

beforeAll(async () => {
  t = await setupApi({ config: { authRequire2fa: true } });
});
beforeEach(async () => {
  await t.db.query("DELETE FROM auth_lockouts");
  await t.db.query("DELETE FROM email_otps");
});
afterAll(async () => t?.close());

describe("2FA por e-mail", () => {
  it("senha certa → etapa 2 (sessão provisória não acessa o painel) e o código vai por e-mail", async () => {
    const r = await login();
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ mfaRequired: true, methods: ["email"], emailHint: "ad•••@pstarx.com", codeSent: true });
    expect((await t.api("GET", "/v1/admin/me", undefined, r.json.token)).status).toBe(401);
    const mail = t.sent[t.sent.length - 1];
    expect(mail.to).toBe("admin@pstarx.com");
    const code = await lastCode();
    // 8 caracteres do alfabeto sem ambíguos
    expect(code.replace("-", "")).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$/);
    expect(mail.text).toMatch(/Chrome no Windows/);
    // só o HMAC no banco
    const stored = (await t.db.query("SELECT code_hash FROM email_otps ORDER BY created_at DESC LIMIT 1")).rows[0].code_hash;
    expect(stored).not.toContain(code.replace("-", ""));
    expect(stored).toHaveLength(64);
  });

  it("código certo (minúsculo, sem hífen) → sessão normal; o mesmo código não vale de novo", async () => {
    const r = await login();
    const code = await lastCode();
    const ok = await verify(r.json.token, code.replace("-", "").toLowerCase());
    expect(ok.status).toBe(200);
    expect((await t.api("GET", "/v1/admin/me", undefined, ok.json.token)).status).toBe(200);
    // replay: a sessão provisória já não existe
    expect((await verify(r.json.token, code)).status).toBe(401);
  });

  it("código errado conta tentativas; 5 erros derrubam a etapa e bloqueiam a conta", async () => {
    const r = await login();
    for (let i = 4; i >= 1; i--) {
      const bad = await verify(r.json.token, "AAAA-AAAA");
      expect(bad.status).toBe(400);
      expect(bad.json.attemptsLeft).toBe(i);
    }
    const last = await verify(r.json.token, "AAAA-AAAA");
    expect(last.status).toBe(401);
    expect(last.json.error).toBe("too_many_attempts");
    // a conta ficou bloqueada (5 falhas), inclusive para quem digitar o e-mail no login
    const again = await t.app.inject({ method: "POST", url: "/v1/admin/login", payload: { username: "admin@pstarx.com", password: PW } });
    expect(again.statusCode).toBe(429);
    expect(Number(again.headers["retry-after"])).toBeGreaterThan(0);
  });

  it("código expirado não vale", async () => {
    const r = await login();
    const code = await lastCode();
    await t.db.query("UPDATE email_otps SET expires_at = now() - interval '1 second'");
    const res = await verify(r.json.token, code);
    expect(res.status).toBe(400);
    expect(res.json.error).toBe("code_expired");
  });

  it("reenvio: espera 60 s entre envios e no máximo 3 a cada 15 min; o código novo invalida o anterior", async () => {
    const r = await login();
    const first = await lastCode();
    const now = await t.api("POST", "/v1/auth/mfa/email/send", undefined, r.json.token);
    expect(now.status).toBe(429);
    expect(Number(now.json.retryAfterSec)).toBeGreaterThan(50);
    // "passa" 1 min
    await t.db.query("UPDATE email_otps SET created_at = created_at - interval '61 seconds'");
    expect((await t.api("POST", "/v1/auth/mfa/email/send", undefined, r.json.token)).status).toBe(200);
    const second = await lastCode();
    expect(second).not.toBe(first);
    expect((await verify(r.json.token, first)).status).toBe(400); // o anterior não vale mais
    await t.db.query("UPDATE email_otps SET created_at = created_at - interval '61 seconds'");
    expect((await t.api("POST", "/v1/auth/mfa/email/send", undefined, r.json.token)).status).toBe(200);
    await t.db.query("UPDATE email_otps SET created_at = created_at - interval '61 seconds'");
    const fourth = await t.api("POST", "/v1/auth/mfa/email/send", undefined, r.json.token);
    expect(fourth.status).toBe(429); // 3 envios na janela de 15 min
  });

  it("confiar neste navegador: o próximo login pula o código; trocar a senha cancela a confiança", async () => {
    const r = await login();
    const ok = await verify(r.json.token, await lastCode(), { trustDevice: true });
    expect(ok.json.trustToken).toBeTruthy();
    const days = (new Date(ok.json.trustExpiresAt).getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(29);

    const sentBefore = t.sent.length;
    const trusted = await login({ trustToken: ok.json.trustToken });
    expect(trusted.json.mfaRequired).toBeUndefined();
    expect((await t.api("GET", "/v1/admin/me", undefined, trusted.json.token)).status).toBe(200);
    expect(t.sent.length).toBe(sentBefore); // nenhum e-mail
    // a senha continua sendo exigida
    expect((await login({ password: "errada-xxxxxxx", trustToken: ok.json.trustToken })).status).toBe(401);

    await t.api("POST", "/v1/admin/password", { current: PW, next: PW }, trusted.json.token);
    const after = await login({ trustToken: ok.json.trustToken });
    expect(after.json.mfaRequired).toBe(true);
  });

  it("navegador confiável aparece na Conta e pode ser removido", async () => {
    const r = await login();
    const ok = await verify(r.json.token, await lastCode(), { trustDevice: true });
    const mfa = (await t.api("GET", "/v1/admin/mfa", undefined, ok.json.token)).json;
    expect(mfa.required).toBe(true);
    expect(mfa.trustedDevices.length).toBeGreaterThanOrEqual(1);
    const dev = mfa.trustedDevices[0];
    expect((await t.api("DELETE", `/v1/admin/mfa/trusted-devices/${dev.id}`, undefined, ok.json.token)).status).toBe(200);
    expect((await login({ trustToken: ok.json.trustToken })).json.mfaRequired).toBe(true);
  });

  it("códigos de recuperação: 10, uso único; o admin zera o 2FA", async () => {
    const r = await login();
    const full = (await verify(r.json.token, await lastCode())).json.token;
    const gen = await t.api("POST", "/v1/admin/mfa/recovery-codes", undefined, full);
    expect(gen.json.codes).toHaveLength(10);
    expect(gen.json.codes[0]).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);

    const r2 = await login();
    expect(r2.json.methods).toEqual(["email", "recovery"]);
    const rec = await t.api("POST", "/v1/auth/mfa/verify", { method: "recovery", code: gen.json.codes[3] }, r2.json.token);
    expect(rec.status).toBe(200);
    const r3 = await login();
    expect((await t.api("POST", "/v1/auth/mfa/verify", { method: "recovery", code: gen.json.codes[3] }, r3.json.token)).status).toBe(400);
    expect((await t.api("GET", "/v1/admin/mfa", undefined, rec.json.token)).json.recoveryCodesLeft).toBe(9);

    const meId = (await t.api("GET", "/v1/admin/me", undefined, rec.json.token)).json.id;
    expect((await t.api("POST", `/v1/admin/users/${meId}/reset-mfa`, undefined, rec.json.token)).status).toBe(200);
    expect((await t.api("GET", "/v1/admin/mfa", undefined, rec.json.token)).json.recoveryCodesLeft).toBe(0);
  });

  it("auditoria tem o desafio, a falha e o sucesso, sem o código", async () => {
    const r = await login();
    const code = await lastCode();
    await verify(r.json.token, "BBBB-BBBB");
    const ok = await verify(r.json.token, code);
    const ev = (await t.api("GET", "/v1/admin/security/events?limit=500", undefined, ok.json.token)).json.events;
    const kinds = new Set(ev.map((e: { event: string }) => e.event));
    for (const k of ["login_password_ok", "mfa_challenge", "mfa_failure", "mfa_success", "recovery_codes_generated", "mfa_reset"]) expect(kinds.has(k)).toBe(true);
    expect(JSON.stringify(ev)).not.toContain(code);
    expect(JSON.stringify(ev)).not.toContain(code.replace("-", ""));
  });
});
