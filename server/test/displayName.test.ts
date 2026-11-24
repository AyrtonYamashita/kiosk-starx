import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addTenant, setupApi } from "./helpers.js";

let t: Awaited<ReturnType<typeof setupApi>>;
beforeAll(async () => {
  t = await setupApi();
});
afterAll(async () => t?.close());

describe("nome de exibição", () => {
  it("a própria pessoa troca o nome em Conta; vazio volta ao nome de usuário", async () => {
    expect((await t.api("GET", "/v1/admin/me")).json.displayName).toBeNull();
    const r = await t.api("PATCH", "/v1/admin/me", { displayName: "  Ayrton   Yamashita " });
    expect(r.status).toBe(200);
    expect((await t.api("GET", "/v1/admin/me")).json).toMatchObject({ username: "admin", displayName: "Ayrton Yamashita" });
    expect((await t.api("PATCH", "/v1/admin/me", { displayName: "x".repeat(81) })).status).toBe(400);
    await t.api("PATCH", "/v1/admin/me", { displayName: "" });
    expect((await t.api("GET", "/v1/admin/me")).json.displayName).toBeNull();
    // o login continua pelo nome de usuário
    expect((await t.api("POST", "/v1/admin/login", { username: "admin", password: "senha-de-teste-123" }, "")).status).toBe(200);
  });

  it("o admin define o nome ao criar e ao editar; outra empresa não mexe", async () => {
    const u = await t.api("POST", "/v1/admin/users", { username: "op.bia", displayName: "Bia Souza", email: "bia@a.com", role: "operator", password: "senha-da-bia-123" });
    expect(u.json.displayName).toBe("Bia Souza");
    expect((await t.api("PATCH", `/v1/admin/users/${u.json.id}`, { displayName: "Beatriz Souza" })).json.displayName).toBe("Beatriz Souza");
    // editar outra coisa não apaga o nome
    expect((await t.api("PATCH", `/v1/admin/users/${u.json.id}`, { role: "admin" })).json.displayName).toBe("Beatriz Souza");
    const b = await addTenant(t, "nome-b");
    expect((await t.api("PATCH", `/v1/admin/users/${u.json.id}`, { displayName: "Invasor" }, b.token)).status).toBe(404);
  });
});
