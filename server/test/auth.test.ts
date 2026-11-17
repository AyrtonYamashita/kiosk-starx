import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setupApi } from "./helpers.js";

let t: Awaited<ReturnType<typeof setupApi>>;
const SECRET = "segredo-do-painel-de-teste";
let ipSeq = 10;
/** Cada teste usa um IP próprio (repassado pelo "painel"), para o limite por IP de um não afetar o outro. */
const nextIp = () => `203.0.113.${ipSeq++}`;

async function login(username: string, password: string, ip: string, viaPanel = true) {
  const res = await t.app.inject({
    method: "POST",
    url: "/v1/admin/login",
    payload: { username, password },
    headers: viaPanel ? { "x-panel-secret": SECRET, "x-client-ip": ip, "x-client-ua": "Teste/1.0" } : {},
  });
  return { status: res.statusCode, json: res.json(), headers: res.headers };
}

beforeAll(async () => {
  t = await setupApi();
  await t.db.query("UPDATE admins SET email = 'admin@pstarx.com' WHERE username = 'admin'");
});
afterAll(async () => t?.close());

describe("login", () => {
  it("entra por usuário ou por e-mail; sessão nova a cada login", async () => {
    const ip = nextIp();
    const a = await login("admin", "senha-de-teste-123", ip);
    const b = await login("ADMIN@pstarx.com", "senha-de-teste-123", ip);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(a.json.token).not.toBe(b.json.token);
    // validade máxima de 2 dias
    const hours = (new Date(a.json.expiresAt).getTime() - Date.now()) / 3600_000;
    expect(hours).toBeGreaterThan(47);
    expect(hours).toBeLessThan(49);
    const me = await t.api("GET", "/v1/admin/me", undefined, a.json.token);
    expect(me.json).toMatchObject({ username: "admin", email: "admin@pstarx.com", role: "admin" });
  });

  it("não revela se a conta existe (mesma resposta para conta inexistente e senha errada)", async () => {
    const ip = nextIp();
    const unknown = await login("ninguem", "qualquer-coisa-1", ip);
    const wrong = await login("admin", "senha-errada-123", ip);
    expect(unknown.status).toBe(401);
    expect(wrong.status).toBe(401);
    expect(unknown.json).toEqual(wrong.json);
  });

  it("força bruta: 5 erros bloqueiam a conta (429 + Retry-After), até com a senha certa; o bloqueio cresce", async () => {
    await t.db.query("DELETE FROM auth_lockouts");
    for (let i = 0; i < 5; i++) expect((await login("admin", `errada-${i}-xxxxx`, nextIp())).status).toBe(401);
    const blocked = await login("admin", "senha-de-teste-123", nextIp());
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers["retry-after"])).toBeGreaterThan(50);
    expect(Number(blocked.headers["retry-after"])).toBeLessThanOrEqual(60);
    expect(blocked.json.message).toMatch(/Muitas tentativas/);

    // passa o primeiro bloqueio: o próximo é de 5 min
    await t.db.query("UPDATE auth_lockouts SET locked_until = now() - interval '1 second' WHERE kind = 'account'");
    for (let i = 0; i < 5; i++) await login("admin", `errada-b-${i}-xxx`, nextIp());
    const again = await login("admin", "senha-de-teste-123", nextIp());
    expect(again.status).toBe(429);
    expect(Number(again.headers["retry-after"])).toBeGreaterThan(240);
  });

  it("conta inexistente também bloqueia igual (sem pista de quais contas existem)", async () => {
    for (let i = 0; i < 5; i++) await login("fantasma", `errada-${i}-xxxxx`, nextIp());
    expect((await login("fantasma", "qualquer-coisa-1", nextIp())).status).toBe(429);
  });

  it("admin desbloqueia na mão; a conta volta a entrar", async () => {
    const adminIp = nextIp();
    // sessão de outro admin para desbloquear (o "admin" está bloqueado)
    await t.db.query("UPDATE auth_lockouts SET locked_until = NULL WHERE key = 'admin'");
    const root = (await login("admin", "senha-de-teste-123", adminIp)).json.token;
    for (let i = 0; i < 5; i++) await login("admin", `errada-c-${i}-xxx`, nextIp());
    expect((await login("admin", "senha-de-teste-123", nextIp())).status).toBe(429);
    const locks = await t.api("GET", "/v1/admin/security/lockouts", undefined, root);
    expect(locks.json.lockouts.some((l: { kind: string; key: string }) => l.kind === "account" && l.key === "admin")).toBe(true);
    expect((await t.api("POST", "/v1/admin/security/unlock", { kind: "account", key: "admin" }, root)).status).toBe(200);
    expect((await login("admin", "senha-de-teste-123", nextIp())).status).toBe(200);
  });

  it("bloqueio por IP: 20 erros do mesmo IP (contas diferentes) bloqueiam o IP", async () => {
    const ip = nextIp();
    for (let i = 0; i < 20; i++) await login(`usuario-${i}`, "errada-xxxxxxx", ip);
    const r = await login("admin", "senha-de-teste-123", ip);
    expect(r.status).toBe(429);
    // outro IP continua entrando
    expect((await login("admin", "senha-de-teste-123", nextIp())).status).toBe(200);
  });

  it("o IP repassado só vale com o segredo do painel", async () => {
    const fake = await t.app.inject({
      method: "POST",
      url: "/v1/admin/login",
      payload: { username: "admin", password: "senha-de-teste-123" },
      headers: { "x-panel-secret": "errado", "x-client-ip": "198.51.100.99" },
    });
    expect(fake.statusCode).toBe(200);
    const ev = (await t.db.query("SELECT ip FROM auth_events WHERE event = 'login_success' ORDER BY id DESC LIMIT 1")).rows[0];
    expect(ev.ip).not.toBe("198.51.100.99");
  });
});

describe("sessões", () => {
  it("expira após 8 h sem uso e sai do banco", async () => {
    const tok = (await login("admin", "senha-de-teste-123", nextIp())).json.token;
    expect((await t.api("GET", "/v1/admin/me", undefined, tok)).status).toBe(200);
    await t.db.query("UPDATE sessions SET last_used_at = now() - interval '9 hours'");
    expect((await t.api("GET", "/v1/admin/me", undefined, tok)).status).toBe(401);
    // a sessão usada sai na hora; as outras paradas saem na limpeza do próximo login
    const { createHash } = await import("node:crypto");
    const hash = createHash("sha256").update(tok).digest("hex");
    expect((await t.db.query("SELECT 1 FROM sessions WHERE token_hash = $1", [hash])).rowCount).toBe(0);
  });

  it("lista as sessões ativas e encerra uma (vale na hora)", async () => {
    const a = (await login("admin", "senha-de-teste-123", nextIp())).json.token;
    const b = (await login("admin", "senha-de-teste-123", nextIp())).json.token;
    const list = (await t.api("GET", "/v1/admin/sessions", undefined, a)).json.sessions;
    expect(list.length).toBeGreaterThanOrEqual(2);
    expect(list.find((s: { current: boolean }) => s.current).userAgent).toBe("Teste/1.0");
    const other = list.find((s: { current: boolean }) => !s.current);
    expect((await t.api("DELETE", `/v1/admin/sessions/${other.id}`, undefined, a)).status).toBe(200);
    expect((await t.api("GET", "/v1/admin/me", undefined, b)).status).toBe(401);
  });

  it("logout invalida a sessão no servidor", async () => {
    const tok = (await login("admin", "senha-de-teste-123", nextIp())).json.token;
    await t.api("POST", "/v1/admin/logout", undefined, tok);
    expect((await t.api("GET", "/v1/admin/me", undefined, tok)).status).toBe(401);
  });
});

describe("usuários e papéis", () => {
  let root: string;
  let opId: string;

  beforeAll(async () => {
    root = (await login("admin", "senha-de-teste-123", nextIp())).json.token;
  });

  it("admin cria operador; operador não acessa usuários nem segurança", async () => {
    const r = await t.api("POST", "/v1/admin/users", { username: "op.joao", email: "Joao@PStarX.com", role: "operator", password: "senha-do-joao-1" }, root);
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ username: "op.joao", email: "joao@pstarx.com", role: "operator", disabled: false });
    opId = r.json.id;
    const op = (await login("joao@pstarx.com", "senha-do-joao-1", nextIp())).json.token;
    expect((await t.api("GET", "/v1/admin/users", undefined, op)).status).toBe(403);
    expect((await t.api("GET", "/v1/admin/security/events", undefined, op)).status).toBe(403);
    // a operação continua liberada
    expect((await t.api("GET", "/v1/admin/devices", undefined, op)).status).toBe(200);
    expect((await t.api("POST", "/v1/admin/users", { username: "dup", email: "joao@pstarx.com", role: "operator", password: "xxxxxxxxxxxx" }, root)).status).toBe(409);
  });

  it("desativar derruba as sessões e impede o login (resposta genérica)", async () => {
    const op = (await login("op.joao", "senha-do-joao-1", nextIp())).json.token;
    expect((await t.api("PATCH", `/v1/admin/users/${opId}`, { disabled: true }, root)).status).toBe(200);
    expect((await t.api("GET", "/v1/admin/me", undefined, op)).status).toBe(401);
    const r = await login("op.joao", "senha-do-joao-1", nextIp());
    expect(r.status).toBe(401);
    expect(r.json.message).toBe("usuário ou senha incorretos");
  });

  it("não deixa desativar nem rebaixar a si mesmo, nem ficar sem admin ativo", async () => {
    const meId = (await t.api("GET", "/v1/admin/me", undefined, root)).json.id;
    expect((await t.api("PATCH", `/v1/admin/users/${meId}`, { disabled: true }, root)).status).toBe(400);
    expect((await t.api("PATCH", `/v1/admin/users/${meId}`, { role: "operator" }, root)).status).toBe(400);
  });

  it("auditoria registra sucesso, falha, bloqueio, desbloqueio, logout e mudanças de usuário", async () => {
    const ev = await t.api("GET", "/v1/admin/security/events?limit=500", undefined, root);
    const kinds = new Set(ev.json.events.map((e: { event: string }) => e.event));
    for (const k of ["login_success", "login_failure", "login_blocked", "lockout", "unlock", "logout", "session_revoked", "user_created", "user_updated"]) {
      expect(kinds.has(k)).toBe(true);
    }
    const failure = ev.json.events.find((e: { event: string }) => e.event === "login_failure");
    expect(JSON.stringify(failure)).not.toMatch(/senha|errada/);
  });
});
