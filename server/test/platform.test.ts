import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { info, platformLogin, setupApi } from "./helpers.js";

/** Fase 3.4: painel da plataforma (empresas, primeiro admin, suspender) e "entrar como" com auditoria. */
let t: Awaited<ReturnType<typeof setupApi>>;
let plat: string;
let A: { id: string; deviceId: string };
let novaId: string;
const login = async (username: string, password: string) => t.api("POST", "/v1/admin/login", { username, password }, "");

beforeAll(async () => {
  t = await setupApi();
  plat = await platformLogin(t);
  const code = (await t.api("POST", "/v1/admin/enrollments", { name: "A" })).json.code;
  A = {
    id: (await t.api("GET", "/v1/admin/me")).json.tenant.id,
    deviceId: (await t.api("POST", "/v1/device/enroll", { code, info: info("PLAT-A1") }, "")).json.deviceId,
  };
});
afterAll(async () => t?.close());

describe("empresas", () => {
  it("só a plataforma acessa", async () => {
    expect((await t.api("GET", "/v1/platform/tenants")).status).toBe(403);
    expect((await t.api("POST", `/v1/platform/tenants/${A.id}/enter`)).status).toBe(403);
    expect((await t.api("GET", "/v1/platform/tenants", undefined, plat)).status).toBe(200);
  });

  it("cria a empresa com o primeiro admin; ele entra e vê a empresa vazia", async () => {
    const body = {
      name: "Transportadora Nova",
      slug: "nova",
      admin: { username: "admin", displayName: "Maria Nova", email: "maria@nova.com", password: "senha-da-maria-1" },
    };
    const r = await t.api("POST", "/v1/platform/tenants", body, plat);
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ name: "Transportadora Nova", slug: "nova", status: "active", users: 1 });
    novaId = r.json.id;
    expect((await t.api("POST", "/v1/platform/tenants", body, plat)).status).toBe(409);
    expect((await t.api("POST", "/v1/platform/tenants", { ...body, slug: "Com Espaço" }, plat)).status).toBe(400);

    const m = await login("maria@nova.com", "senha-da-maria-1");
    expect(m.status).toBe(200);
    expect((await t.api("GET", "/v1/admin/me", undefined, m.json.token)).json).toMatchObject({ displayName: "Maria Nova", role: "admin", tenant: { slug: "nova" } });
    expect((await t.api("GET", "/v1/admin/devices", undefined, m.json.token)).json.devices).toEqual([]);
    // a leitura do SSW da empresa nova já tem a linha de ajustes
    expect((await t.api("GET", "/v1/admin/ops/settings", undefined, m.json.token)).json.readerAll).toBe(false);

    const list = (await t.api("GET", "/v1/platform/tenants", undefined, plat)).json.tenants;
    expect(list.find((x: { id: string }) => x.id === A.id)).toMatchObject({ devices: 1 });
  });

  it("suspender: sessões caem e ninguém da empresa entra; reativar volta", async () => {
    const m = (await login("maria@nova.com", "senha-da-maria-1")).json.token;
    expect((await t.api("PATCH", `/v1/platform/tenants/${novaId}`, { status: "suspended" }, plat)).json.status).toBe("suspended");
    expect((await t.api("GET", "/v1/admin/me", undefined, m)).status).toBe(401);
    const again = await login("maria@nova.com", "senha-da-maria-1");
    expect(again.status).toBe(403);
    expect(again.json.error).toBe("tenant_suspended");
    // senha errada continua com a resposta genérica (não revela que a empresa está suspensa)
    expect((await login("maria@nova.com", "senha-errada-123")).status).toBe(401);

    expect((await t.api("PATCH", `/v1/platform/tenants/${novaId}`, { status: "active", name: "Nova Transportes" }, plat)).json).toMatchObject({
      status: "active",
      name: "Nova Transportes",
    });
    expect((await login("maria@nova.com", "senha-da-maria-1")).status).toBe(200);
  });
});

describe("entrar como", () => {
  it("a plataforma vê a empresa enquanto está dentro; tudo fica na auditoria das duas", async () => {
    expect((await t.api("GET", "/v1/admin/devices", undefined, plat)).status).toBe(403);
    expect((await t.api("POST", `/v1/platform/tenants/${A.id}/enter`, undefined, plat)).status).toBe(200);
    expect((await t.api("GET", "/v1/admin/me", undefined, plat)).json).toMatchObject({ platform: true, acting: true, tenant: { id: A.id } });
    expect((await t.api("GET", "/v1/admin/devices", undefined, plat)).json.devices.map((d: { id: string }) => d.id)).toEqual([A.deviceId]);
    // age como admin da empresa: o que fizer aparece na trilha dela
    expect((await t.api("PATCH", `/v1/admin/devices/${A.deviceId}`, { name: "Renomeado pelo suporte" }, plat)).status).toBe(200);
    const evA = (await t.api("GET", "/v1/admin/security/events?limit=500")).json.events;
    expect(evA.some((e: { event: string; username: string }) => e.event === "tenant_enter" && e.username === "plataforma")).toBe(true);
    // a empresa não vê os usuários da plataforma na lista de usuários
    expect((await t.api("GET", "/v1/admin/users")).json.users.some((u: { username: string }) => u.username === "plataforma")).toBe(false);

    // trocar de empresa sem sair
    await t.api("POST", `/v1/platform/tenants/${novaId}/enter`, undefined, plat);
    expect((await t.api("GET", "/v1/admin/devices", undefined, plat)).json.devices).toEqual([]);

    expect((await t.api("POST", "/v1/platform/exit", undefined, plat)).status).toBe(200);
    expect((await t.api("GET", "/v1/admin/me", undefined, plat)).json).toMatchObject({ acting: false, tenant: null });
    expect((await t.api("GET", "/v1/admin/devices", undefined, plat)).status).toBe(403);

    const evP = (await t.api("GET", "/v1/platform/events", undefined, plat)).json.events.map((e: { event: string }) => e.event);
    for (const k of ["tenant_created", "tenant_suspended", "tenant_reactivated", "tenant_enter", "tenant_exit"]) expect(evP).toContain(k);
  });

  it("só vale para a sessão que entrou; outra sessão da plataforma continua fora", async () => {
    await t.api("POST", `/v1/platform/tenants/${A.id}/enter`, undefined, plat);
    const other = (await login("plataforma@pstarx.com", "senha-de-teste-123")).json.token;
    expect((await t.api("GET", "/v1/admin/me", undefined, other)).json.tenant).toBeNull();
    await t.api("POST", "/v1/platform/exit", undefined, plat);
  });
});
