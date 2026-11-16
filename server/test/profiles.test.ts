import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { desiredConfig, hashPin, mergeConfig, verifyPin } from "../src/kioskConfig.js";
import { info, setupApi } from "./helpers.js";

let t: Awaited<ReturnType<typeof setupApi>>;
let deviceId: string;
let deviceToken: string;

beforeAll(async () => {
  t = await setupApi();
  const code = (await t.api("POST", "/v1/admin/enrollments", { name: "Lote" })).json.code;
  const r = await t.api("POST", "/v1/device/enroll", { code, info: info("SER1") }, "");
  deviceId = r.json.deviceId;
  deviceToken = r.json.token;
});
afterAll(async () => t?.close());

const checkin = (body: object = {}) => t.api("POST", "/v1/device/checkin", { info: info("SER1"), ...body }, deviceToken);
const detail = async () => (await t.api("GET", `/v1/admin/devices/${deviceId}`)).json;

describe("utilitários de configuração", () => {
  it("PIN do servidor tem o mesmo formato do app e confere", () => {
    const h = hashPin("1234");
    expect(h).toMatchObject({ algo: "pbkdf2-sha256", iterations: 100_000, numeric: true });
    expect(Buffer.from(h.hash, "base64")).toHaveLength(32);
    expect(verifyPin("1234", h)).toBe(true);
    expect(verifyPin("1235", h)).toBe(false);
  });

  it("merge igual ao do app e hash estável", () => {
    const m = mergeConfig({ kiosk: { enabled: true, apps: ["a.b", "c.d"] }, display: { brightness: 40 } }, { kiosk: { apps: ["e.f"] }, display: { brightness: null } });
    expect(m).toEqual({ kiosk: { enabled: true, apps: ["e.f"] }, display: { brightness: null } });
    const a = desiredConfig({ kiosk: { mode: "web", enabled: true } }, null, 0)!;
    const b = desiredConfig({ kiosk: { enabled: true, mode: "web" } }, null, 0)!;
    expect(a.hash).toBe(b.hash);
    expect(desiredConfig({ kiosk: { enabled: true } }, null, 1)!.hash).not.toBe(a.hash);
    expect(desiredConfig(null, null, 0)).toBeNull();
  });
});

describe("perfis", () => {
  let profileId: string;

  it("recusa campo desconhecido e tipo errado (com mensagem)", async () => {
    const r = await t.api("POST", "/v1/admin/profiles", { name: "X", config: { kiosk: { enabld: true, mode: "tv" } } });
    expect(r.status).toBe(400);
    expect(r.json.message).toMatch(/kiosk/);
    expect(r.json.errors.length).toBeGreaterThanOrEqual(2);
  });

  it("cria perfil com PIN em texto: grava só o hash e devolve marcador", async () => {
    const r = await t.api("POST", "/v1/admin/profiles", {
      name: "Expedição",
      description: "coletores da expedição",
      config: { kiosk: { enabled: true, mode: "apps", apps: ["com.android.chrome"] }, security: { pin: "2468" } },
    });
    expect(r.status).toBe(200);
    expect(r.json.config.security.pinHash).toBe("<definido>");
    profileId = r.json.id;
    const row = (await t.db.query("SELECT config FROM profiles WHERE id = $1", [profileId])).rows[0];
    expect(verifyPin("2468", row.config.security.pinHash)).toBe(true);
    expect(row.config.security.pin).toBeUndefined();
  });

  it("nome duplicado: 409", async () => {
    expect((await t.api("POST", "/v1/admin/profiles", { name: "Expedição", config: {} })).status).toBe(409);
  });

  it("editar com marcador mantém o PIN", async () => {
    const before = (await t.db.query("SELECT config FROM profiles WHERE id = $1", [profileId])).rows[0].config.security.pinHash;
    const r = await t.api("PUT", `/v1/admin/profiles/${profileId}`, {
      name: "Expedição",
      config: { kiosk: { enabled: true, mode: "apps", apps: ["com.android.chrome", "com.rscja.scanner"] }, security: { pinHash: "<definido>" } },
    });
    expect(r.status).toBe(200);
    const after = (await t.db.query("SELECT config FROM profiles WHERE id = $1", [profileId])).rows[0].config.security.pinHash;
    expect(after).toEqual(before);
  });

  it("aparelho sem perfil não recebe nada", async () => {
    const r = await checkin();
    expect(r.json.desired).toBeNull();
    expect((await detail()).configStatus).toBe("none");
  });

  it("perfil atribuído: o check-in entrega a configuração (com o hash do PIN) até o aparelho confirmar", async () => {
    expect((await t.api("PUT", `/v1/admin/devices/${deviceId}/config`, { profileId, overrides: { kiosk: { apps: ["com.android.deskclock"] } } })).status).toBe(200);
    expect((await detail()).configStatus).toBe("pending");
    const r = await checkin({ panelConfigHash: null });
    const d = r.json.desired;
    expect(d.hash).toMatch(/^[0-9a-f]{32}$/);
    expect(d.config.kiosk).toEqual({ enabled: true, mode: "apps", apps: ["com.android.deskclock"] });
    expect(d.config.security.pinHash.algo).toBe("pbkdf2-sha256");
    expect(d.config.schema).toBe(1);
    // não confirmou ainda: manda de novo
    expect((await checkin({ panelConfigHash: null })).json.desired.hash).toBe(d.hash);
    // aplicou
    const ok = await checkin({ applyResult: { hash: d.hash, ok: true, warnings: [] }, config: { kiosk: { enabled: true } }, configRevision: 5, configSource: "painel" });
    expect(ok.json.desired).toBeNull();
    const det = await detail();
    expect(det.configStatus).toBe("applied");
    expect(det.profileName).toBe("Expedição");
    expect(det.overrides).toEqual({ kiosk: { apps: ["com.android.deskclock"] } });
    expect((await checkin({ panelConfigHash: d.hash })).json.desired).toBeNull();
  });

  it("alteração local depois do painel: status 'modified'; reaplicar manda de novo", async () => {
    await checkin({ config: { kiosk: { enabled: false } }, configRevision: 6, configSource: "local" });
    expect((await detail()).configStatus).toBe("modified");
    expect((await t.api("POST", `/v1/admin/devices/${deviceId}/config/reapply`)).status).toBe(200);
    expect((await detail()).configStatus).toBe("pending");
    expect((await checkin()).json.desired).not.toBeNull();
  });

  it("falha ao aplicar: status 'error' e não reenvia em loop", async () => {
    const hash = (await checkin()).json.desired.hash;
    const r = await checkin({ applyResult: { hash, ok: false, error: "security.pin: muito curto" } });
    expect(r.json.desired).toBeNull();
    const det = await detail();
    expect(det.configStatus).toBe("error");
    expect(det.applyError).toBe("security.pin: muito curto");
    expect((await checkin()).json.desired).toBeNull();
    // reaplicar libera de novo
    await t.api("POST", `/v1/admin/devices/${deviceId}/config/reapply`);
    expect((await checkin()).json.desired).not.toBeNull();
  });

  it("listagem mostra perfil e situação; atribuição em lote", async () => {
    const list = (await t.api("GET", "/v1/admin/devices")).json.devices;
    expect(list[0]).toMatchObject({ profileName: "Expedição", hasOverrides: true, configStatus: "pending" });
    const p2 = (await t.api("POST", "/v1/admin/profiles", { name: "Site TMS", config: { kiosk: { enabled: true, mode: "web", web: { url: "https://tms.exemplo.com" } } } })).json;
    const r = await t.api("POST", "/v1/admin/devices/bulk/profile", { deviceIds: [deviceId], profileId: p2.id });
    expect(r.json.updated).toBe(1);
    expect((await detail()).profileName).toBe("Site TMS");
    const profiles = (await t.api("GET", "/v1/admin/profiles")).json.profiles;
    expect(profiles.find((p: { name: string }) => p.name === "Site TMS").devices).toBe(1);
  });

  it("ajuste inválido do aparelho é recusado", async () => {
    const r = await t.api("PUT", `/v1/admin/devices/${deviceId}/config`, { profileId: null, overrides: { display: { brightness: 300 } } });
    expect(r.status).toBe(400);
  });

  it("excluir perfil: aparelhos ficam sem perfil (sem nada a aplicar se não tiverem ajustes)", async () => {
    await t.api("PUT", `/v1/admin/devices/${deviceId}/config`, { profileId, overrides: null });
    expect((await t.api("DELETE", `/v1/admin/profiles/${profileId}`)).status).toBe(200);
    const det = await detail();
    expect(det.profileId).toBeNull();
    expect(det.configStatus).toBe("none");
  });

  it("código de cadastro com perfil: o aparelho já nasce com ele", async () => {
    const p = (await t.api("POST", "/v1/admin/profiles", { name: "Inicial", config: { kiosk: { enabled: true, mode: "app", app: "com.android.deskclock" } } })).json;
    const code = (await t.api("POST", "/v1/admin/enrollments", { name: "Com perfil", profileId: p.id })).json;
    expect(code.profileName).toBe("Inicial");
    const r = await t.api("POST", "/v1/device/enroll", { code: code.code, info: info("SER2") }, "");
    const ck = await t.api("POST", "/v1/device/checkin", { info: info("SER2") }, r.json.token);
    expect(ck.json.desired.config.kiosk.app).toBe("com.android.deskclock");
  });

  it("catálogo de apps vindo dos aparelhos", async () => {
    await checkin({ apps: [{ packageName: "com.android.chrome", label: "Chrome", system: false }], appsHash: "h1" });
    const r = await t.api("GET", "/v1/admin/apps-catalog");
    expect(r.json.apps).toContainEqual(expect.objectContaining({ package: "com.android.chrome", label: "Chrome", devices: 1 }));
  });
});

describe("campos de tela e site (atalho de recarregar, escurecer)", () => {
  it("aceita reloadButton e dimAfterSec; recusa fora da faixa", async () => {
    const ok = await t.api("POST", "/v1/admin/profiles", { name: "Escurece", config: { kiosk: { web: { reloadButton: true } }, display: { dimAfterSec: 120 } } });
    expect(ok.status).toBe(200);
    expect(ok.json.config).toMatchObject({ kiosk: { web: { reloadButton: true } }, display: { dimAfterSec: 120 } });
    const bad = await t.api("POST", "/v1/admin/profiles", { name: "Ruim", config: { display: { dimAfterSec: -5 } } });
    expect(bad.status).toBe(400);
  });
});
