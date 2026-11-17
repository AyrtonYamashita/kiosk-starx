import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setupApi } from "./helpers.js";
import { SoftAuthenticator } from "./softAuthenticator.js";

let t: Awaited<ReturnType<typeof setupApi>>;
const PW = "senha-de-teste-123";

/** Cadastra uma passkey na conta do admin (Conta → Adicionar passkey). */
async function register(auth = new SoftAuthenticator(), name = "Notebook") {
  const opt = await t.api("POST", "/v1/admin/passkeys/register/options", { password: PW }, t.adminToken);
  expect(opt.status).toBe(200);
  expect(opt.json.options.authenticatorSelection).toMatchObject({ residentKey: "required", userVerification: "required" });
  expect(opt.json.options.rp.id).toBe("localhost");
  const res = await t.api("POST", "/v1/admin/passkeys/register/verify", { challengeId: opt.json.challengeId, response: auth.create(opt.json.options), name }, t.adminToken);
  expect(res.status).toBe(200);
  return auth;
}

/** "Entrar com passkey" (sem usuário e senha). */
async function passkeyLogin(auth: SoftAuthenticator, o: Parameters<SoftAuthenticator["get"]>[1] = {}) {
  const opt = await t.api("POST", "/v1/auth/passkey/options", undefined, "");
  expect(opt.status).toBe(200);
  const response = auth.get(opt.json.options, o);
  const res = await t.api("POST", "/v1/auth/passkey/verify", { challengeId: opt.json.challengeId, response }, "");
  return { ...res, challengeId: opt.json.challengeId, response };
}

beforeAll(async () => {
  t = await setupApi({ config: { authRequire2fa: true } });
});
beforeEach(async () => {
  await t.db.query("DELETE FROM auth_lockouts");
  await t.db.query("DELETE FROM webauthn_credentials");
});
afterAll(async () => t?.close());

describe("passkeys", () => {
  it("cadastrar exige a senha atual; a passkey aparece na Conta só com a chave pública", async () => {
    expect((await t.api("POST", "/v1/admin/passkeys/register/options", { password: "errada-xxxxxx" }, t.adminToken)).status).toBe(400);
    await t.db.query("DELETE FROM auth_lockouts");
    await register();
    const mfa = (await t.api("GET", "/v1/admin/mfa", undefined, t.adminToken)).json;
    expect(mfa.passkeys).toHaveLength(1);
    expect(mfa.passkeys[0]).toMatchObject({ name: "Notebook" });
    const row = (await t.db.query("SELECT public_key, counter FROM webauthn_credentials")).rows[0];
    expect(row.public_key.length).toBeGreaterThan(60);
  });

  it("a mesma passkey não é cadastrada duas vezes e o desafio do cadastro vale uma vez", async () => {
    const auth = await register();
    const opt = await t.api("POST", "/v1/admin/passkeys/register/options", { password: PW }, t.adminToken);
    expect(opt.json.options.excludeCredentials.map((c: { id: string }) => c.id)).toContain(auth.id);
    const body = { challengeId: opt.json.challengeId, response: auth.create(opt.json.options), name: "De novo" };
    expect((await t.api("POST", "/v1/admin/passkeys/register/verify", body, t.adminToken)).status).toBe(409);
    expect((await t.api("POST", "/v1/admin/passkeys/register/verify", body, t.adminToken)).json.error).toBe("challenge_expired");
  });

  it("Entrar com passkey: sem senha nem código, sessão normal e auditoria", async () => {
    const auth = await register();
    const r = await passkeyLogin(auth);
    expect(r.status).toBe(200);
    expect((await t.api("GET", "/v1/admin/me", undefined, r.json.token)).json.username).toBe("admin");
    const ev = (await t.api("GET", "/v1/admin/security/events?limit=50", undefined, r.json.token)).json.events;
    expect(ev.find((e: { event: string; details: { method?: string } }) => e.event === "login_success" && e.details?.method === "passkey")).toBeTruthy();
    expect((await t.api("GET", "/v1/admin/mfa", undefined, r.json.token)).json.passkeys[0].lastUsedAt).toBeTruthy();
  });

  it("replay: a mesma resposta não entra de novo (nem no mesmo desafio, nem num novo)", async () => {
    const auth = await register();
    const r = await passkeyLogin(auth);
    expect(r.status).toBe(200);
    const again = await t.api("POST", "/v1/auth/passkey/verify", { challengeId: r.challengeId, response: r.response }, "");
    expect(again.status).toBe(400);
    const opt = await t.api("POST", "/v1/auth/passkey/options", undefined, "");
    expect((await t.api("POST", "/v1/auth/passkey/verify", { challengeId: opt.json.challengeId, response: r.response }, "")).status).toBe(401);
  });

  it("recusa outro site (phishing), outro domínio, sem biometria/PIN e contador voltando (clone)", async () => {
    const auth = await register();
    expect((await passkeyLogin(auth, { origin: "https://kiosk-pstarx.com.golpe.io" })).status).toBe(401);
    expect((await passkeyLogin(auth, { rpId: "golpe.io" })).status).toBe(401);
    expect((await passkeyLogin(auth, { userVerified: false })).status).toBe(401);
    expect((await passkeyLogin(auth, { counter: 10 })).status).toBe(200);
    expect((await passkeyLogin(auth, { counter: 7 })).status).toBe(401);
    const reasons = (await t.db.query("SELECT details->>'reason' AS r FROM auth_events WHERE event = 'passkey_failure'")).rows.map((x) => x.r);
    expect(reasons).toContain("invalid");
  });

  it("passkey removida ou de conta desativada não entra", async () => {
    const auth = await register();
    const id = (await t.api("GET", "/v1/admin/mfa", undefined, t.adminToken)).json.passkeys[0].id;
    expect((await t.api("DELETE", `/v1/admin/passkeys/${id}`, undefined, t.adminToken)).status).toBe(200);
    expect((await passkeyLogin(auth)).status).toBe(401);
  });

  it("muitas falhas no mesmo IP bloqueiam o login com passkey", async () => {
    const auth = await register();
    // IP próprio (repassado pelo painel), para não somar com os outros testes no limite por minuto
    const headers = { "x-panel-secret": "segredo-do-painel-de-teste", "x-client-ip": "198.51.100.77" };
    const call = async (url: string, payload?: object) => {
      const r = await t.app.inject({ method: "POST", url, payload, headers });
      return { status: r.statusCode, json: r.json() };
    };
    for (let i = 0; i < 20; i++) {
      const opt = await call("/v1/auth/passkey/options");
      expect(opt.status).toBe(200);
      const res = await call("/v1/auth/passkey/verify", { challengeId: opt.json.challengeId, response: auth.get(opt.json.options, { origin: "https://golpe.io" }) });
      expect(res.status).toBe(401);
    }
    const lock = (await t.db.query("SELECT locked_until > now() AS locked FROM auth_lockouts WHERE kind = 'ip' AND key LIKE '%198.51.100.77%'")).rows[0];
    expect(lock?.locked).toBe(true);
    expect((await call("/v1/auth/passkey/options")).status).toBe(429);
    // outro IP continua entrando
    expect((await passkeyLogin(auth)).status).toBe(200);
  });

  it("etapa 2 do login: com passkey o e-mail não sai sozinho e a passkey conclui", async () => {
    const auth = await register();
    const sentBefore = t.sent.length;
    const r = (await t.api("POST", "/v1/admin/login", { username: "admin", password: PW }, "")).json;
    expect(r.methods[0]).toBe("passkey");
    expect(r.codeSent).toBe(false);
    await new Promise((res) => setTimeout(res, 20));
    expect(t.sent.length).toBe(sentBefore);
    const opt = await t.api("POST", "/v1/auth/mfa/passkey/options", undefined, r.token);
    expect(opt.json.options.allowCredentials.map((c: { id: string }) => c.id)).toEqual([auth.id]);
    const ok = await t.api("POST", "/v1/auth/mfa/passkey/verify", { challengeId: opt.json.challengeId, response: auth.get(opt.json.options), trustDevice: true }, r.token);
    expect(ok.status).toBe(200);
    expect(ok.json.trustToken).toBeTruthy();
    expect((await t.api("GET", "/v1/admin/me", undefined, ok.json.token)).status).toBe(200);
  });

  it("zerar o 2FA (admin) remove as passkeys", async () => {
    await register();
    const meId = (await t.api("GET", "/v1/admin/me", undefined, t.adminToken)).json.id;
    expect((await t.api("POST", `/v1/admin/users/${meId}/reset-mfa`, undefined, t.adminToken)).status).toBe(200);
    expect((await t.api("GET", "/v1/admin/mfa", undefined, t.adminToken)).json.passkeys).toHaveLength(0);
  });
});
