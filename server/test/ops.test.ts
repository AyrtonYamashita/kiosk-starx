import crypto from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { sha256hex, signBatch } from "../src/ops.js";
import { info, setupApi } from "./helpers.js";

let t: Awaited<ReturnType<typeof setupApi>>;
let deviceId: string;
let token: string;
let lastTs = Date.now() - 60_000;

const T0 = Date.now() - 10 * 60_000;
const at = (sec: number) => T0 + sec * 1000;
const id = () => crypto.randomUUID();
const tot = (qty: number, kg = qty * 4, value = qty * 199) => ({ qty, kg, value });

/** Envia um lote como o app: corpo exato + x-ts + HMAC (chave = SHA-256 do token). */
async function send(events: object[], o: { ts?: number; token?: string; device?: string; body?: string; signature?: string } = {}) {
  const ts = o.ts ?? (lastTs = Math.max(lastTs + 1, Date.now()));
  const body = o.body ?? JSON.stringify({ schema: 1, events });
  const res = await t.app.inject({
    method: "POST",
    url: "/v1/device/events",
    payload: body,
    headers: {
      "content-type": "application/json",
      "x-device-id": o.device ?? deviceId,
      "x-ts": String(ts),
      "x-signature": o.signature ?? signBatch(sha256hex(o.token ?? token), ts, body),
    },
  });
  return { status: res.statusCode, json: res.json(), ts, body };
}

const op = async () => (await t.db.query("SELECT * FROM ops_operations WHERE device_id = $1 ORDER BY started_at DESC LIMIT 1", [deviceId])).rows[0];
const state = async () => (await t.db.query("SELECT * FROM ops_device_state WHERE device_id = $1", [deviceId])).rows[0];

beforeAll(async () => {
  t = await setupApi();
  const code = (await t.api("POST", "/v1/admin/enrollments", { name: "Lote" })).json.code;
  const r = await t.api("POST", "/v1/device/enroll", { code, info: info("OPS1") }, "");
  deviceId = r.json.deviceId;
  token = r.json.token;
  expect((await t.api("PATCH", `/v1/admin/devices/${deviceId}`, { opsReader: true })).status).toBe(200);
});
beforeEach(async () => {
  await t.db.query("DELETE FROM ops_events");
  await t.db.query("DELETE FROM ops_operations");
  await t.db.query("DELETE FROM ops_device_state");
});
afterAll(async () => t?.close());

describe("eventos do leitor do SSW: uma descarga", () => {
  it("sessão + início + bipagens + fim viram uma operação com tempos por volume", async () => {
    const r = await send([
      { id: id(), at: at(0), type: "session", user: "ayrton", domain: "ALT", branch: "OTI" },
      { id: id(), at: at(5), type: "op_start", fn: "coleta", plate: "ABC1D23", units: ["ALT", "OTI", "BOT", "CGB"], total: tot(10) },
    ]);
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ accepted: 2, duplicates: 0 });
    expect(typeof r.json.serverTime).toBe("number");

    let o = await op();
    expect(o).toMatchObject({ fn: "coleta", plate: "ABC1D23", ssw_user: "ayrton", domain: "ALT", branch: "OTI", ended_at: null });
    expect(o.units).toEqual(["ALT", "OTI", "BOT", "CGB"]);
    expect(Number(o.total_qty)).toBe(10);
    expect((await state()).screen).toBe("bipagem");

    // 1º volume aos 20 s, 2º aos 30 s, mais 2 de uma vez aos 50 s (20 s para 2 volumes)
    await send([
      { id: id(), at: at(20), type: "progress", fn: "coleta", plate: "ABC1D23", read: tot(1) },
      { id: id(), at: at(30), type: "progress", fn: "coleta", plate: "ABC1D23", read: tot(2) },
    ]);
    await send([{ id: id(), at: at(50), type: "progress", fn: "coleta", plate: "ABC1D23", read: tot(4) }]);
    o = await op();
    expect(o.scans).toBe(4);
    expect(Number(o.read_qty)).toBe(4);
    expect(Number(o.read_value)).toBe(4 * 199);
    expect(new Date(o.first_scan_at).getTime()).toBe(at(20));
    expect(new Date(o.last_scan_at).getTime()).toBe(at(50));
    // intervalos: 10 s (1 volume) + 20 s (2 volumes) = 30 s em 3 volumes
    expect(Number(o.scan_interval_sum_ms)).toBe(30_000);
    expect(o.scan_interval_count).toBe(3);

    await send([{ id: id(), at: at(90), type: "op_end", fn: "coleta", plate: "ABC1D23", reason: "concluded" }]);
    o = await op();
    expect(o.end_reason).toBe("concluded");
    expect(new Date(o.ended_at).getTime()).toBe(at(90));
    const s = await state();
    expect(s.operation_id).toBeNull();
    expect(s.ssw_user).toBe("ayrton");
  });

  it("recarregar a mesma descarga continua a operação; outra placa encerra a anterior", async () => {
    await send([{ id: id(), at: at(0), type: "op_start", fn: "manifesto", plate: "AAA1234", total: tot(5) }]);
    const first = await op();
    await send([{ id: id(), at: at(10), type: "op_start", fn: "manifesto", plate: "AAA1234", total: tot(6), read: tot(1) }]);
    expect((await op()).id).toBe(first.id);
    expect(Number((await op()).total_qty)).toBe(6);
    await send([{ id: id(), at: at(20), type: "op_start", fn: "romaneio", plate: "BBB9876", total: tot(3) }]);
    const prev = (await t.db.query("SELECT end_reason FROM ops_operations WHERE id = $1", [first.id])).rows[0];
    expect(prev.end_reason).toBe("replaced");
    expect((await op()).plate).toBe("BBB9876");
  });

  it("progresso sem início (app reiniciado no meio) abre a operação; sair do SSW encerra", async () => {
    await send([{ id: id(), at: at(0), type: "progress", fn: "coleta", plate: "CCC1111", read: tot(3), total: tot(8) }]);
    const o = await op();
    expect(o).toMatchObject({ plate: "CCC1111", scans: 0 });
    expect(Number(o.total_qty)).toBe(8);
    await send([{ id: id(), at: at(30), type: "session", user: null }]);
    expect((await op()).end_reason).toBe("left");
    expect((await state()).screen).toBe("login");
  });

  it("eventos fora de ordem no lote são aplicados pela hora do aparelho", async () => {
    await send([
      { id: id(), at: at(20), type: "progress", fn: "coleta", plate: "DDD2222", read: tot(1) },
      { id: id(), at: at(0), type: "op_start", fn: "coleta", plate: "DDD2222", total: tot(4) },
    ]);
    const o = await op();
    expect(new Date(o.started_at).getTime()).toBe(at(0));
    expect(o.scans).toBe(1);
  });

  it("heartbeat atualiza a tela e o 'vivo' do coletor", async () => {
    await send([{ id: id(), at: at(0), type: "heartbeat", screen: "menu", user: "joao" }]);
    const s = await state();
    expect(s).toMatchObject({ screen: "menu", ssw_user: "joao" });
    expect(new Date(s.last_heartbeat_at).getTime()).toBe(at(0));
  });
});

describe("carga de manifesto, diagnóstico da tela e leitor entregue pela API (0.5.1)", () => {
  it("carga vira operação com o nome certo no painel", async () => {
    const r = await send([
      { id: id(), at: at(0), type: "session", user: "jeff", domain: "ALT", branch: "CGB" },
      { id: id(), at: at(2), type: "op_start", fn: "carga_manifesto", plate: "ARMAZEM", units: ["MRS"], total: tot(263), read: tot(200) },
      { id: id(), at: at(5), type: "progress", fn: "carga_manifesto", plate: "ARMAZEM", read: tot(201) },
    ]);
    expect(r.status).toBe(200);
    expect(await op()).toMatchObject({ fn: "carga_manifesto", plate: "ARMAZEM", scans: 1 });
    const detail = (await t.api("GET", `/v1/admin/ops/devices/${deviceId}`)).json;
    expect(detail.operation).toMatchObject({ fn: "carga_manifesto", fnLabel: "Carga de Manifesto" });
    const cards = (await t.api("GET", "/v1/admin/ops/cards")).json.cards as { deviceId: string; operation?: { fnLabel: string } }[];
    expect(JSON.stringify(cards.find((c) => c.deviceId === deviceId))).toContain("Carga de Manifesto");
    // função desconhecida continua recusada
    expect((await send([{ id: id(), at: at(9), type: "op_start", fn: "carga_outra", plate: "X", total: tot(1) }])).status).toBe(400);
  });

  it("códigos de barras: guardados com o tipo, sem repetir, na carga e na consulta", async () => {
    const sc = (code: string, kind: string, sid = code, ageMs = 0) => ({ scan: { id: `s-${sid}`, code, kind, ageMs } });
    const base = { fn: "carga_manifesto", plate: "PVA" };
    expect(
      (
        await send([
          { id: id(), at: at(0), type: "session", user: "felipef", domain: "ALT", branch: "CGB" },
          { id: id(), at: at(1), type: "op_start", ...base, total: tot(319), read: tot(310) },
          { id: id(), at: at(4), type: "progress", ...base, read: tot(311), extra: sc("24788807547686", "lido", "a", 300) },
          { id: id(), at: at(7), type: "progress", ...base, read: tot(311), extra: sc("24788807547686", "nao_contou", "b") },
          { id: id(), at: at(9), type: "progress", ...base, read: tot(311), extra: sc("99900011122233", "outra", "c") },
          // o mesmo registro chega de novo num retrato seguinte: não repete
          { id: id(), at: at(10), type: "progress", ...base, read: tot(312), extra: sc("99900011122233", "outra", "c") },
        ])
      ).status,
    ).toBe(200);
    const rows = (await t.db.query("SELECT code, kind, read_qty, at FROM ops_scans WHERE device_id = $1 ORDER BY at", [deviceId])).rows;
    expect(rows.map((r) => [r.code, r.kind, Number(r.read_qty)])).toEqual([
      ["24788807547686", "lido", 311],
      ["24788807547686", "nao_contou", 311],
      ["99900011122233", "outra", 311],
    ]);
    expect(rows[0].at.getTime()).toBe(at(4) - 300); // hora em que o código apareceu
    expect((await op()).read_qty).toBe("312");

    const detail = (await t.api("GET", `/v1/admin/ops/devices/${deviceId}`)).json;
    expect(detail.codes.map((c: { code: string; kind: string }) => c.kind)).toEqual(["outra", "nao_contou", "lido"]);

    const found = (await t.api("GET", "/v1/admin/ops/scans?code=24788807547686")).json.results;
    expect(found).toHaveLength(2);
    expect(found[0]).toMatchObject({ code: "24788807547686", device: { id: deviceId }, operation: { fnLabel: "Carga de Manifesto", plate: "PVA", user: "felipef" } });
    expect((await t.api("GET", "/v1/admin/ops/scans?code=2478880")).json.results).toHaveLength(2); // começo do código
    expect((await t.api("GET", "/v1/admin/ops/scans?code=2%25")).status).toBe(400); // curto demais
    expect((await t.api("GET", "/v1/admin/ops/scans?code=%25%25%25")).json.results).toHaveLength(0); // % não é curinga

    // guardados 1 ano
    await t.db.query("UPDATE ops_scans SET at = now() - interval '366 days' WHERE code = '99900011122233'");
    const { pruneOpsEvents } = await import("../src/opsRetention.js");
    expect((await pruneOpsEvents(t.db, { eventDays: 90, heartbeatDays: 7, scanDays: 365 })).scans).toBe(1);
    expect((await t.api("GET", "/v1/admin/ops/scans?code=99900011122233")).json.results).toHaveLength(0);
  });

  it("app perdeu a sessão sem avisar (sinal de vida sem usuário): a carga fecha depois de 2 min, na hora do último sinal com usuário", async () => {
    const base = { fn: "coleta", plate: "ARMAMAN" };
    const hb = (sec: number, user: string | null, screen: string) => ({ id: id(), at: at(sec), type: "heartbeat", screen, user, ...(screen === "bipagem" ? base : {}) });
    expect(
      (
        await send([
          { id: id(), at: at(0), type: "session", user: "bthiago", domain: "ALT", branch: "CGB" },
          { id: id(), at: at(1), type: "op_start", ...base, total: tot(0) },
          hb(15, "bthiago", "bipagem"),
          // app reiniciado: o rastreador recomeça sem usuário e cai no login, sem mandar "session null"
          hb(19, null, "outra"),
          hb(20, null, "login"),
          hb(90, null, "login"),
        ])
      ).status,
    ).toBe(200);
    expect((await op()).ended_at).toBeNull(); // menos de 2 min: pode ser a página carregando de novo
    // de volta à mesma bipagem antes dos 2 min: continua a mesma carga
    expect((await send([hb(100, "bthiago", "bipagem"), hb(130, null, "outra"), hb(200, null, "login")])).status).toBe(200);
    expect((await op()).ended_at).toBeNull();
    expect((await send([hb(260, null, "login")])).status).toBe(200);
    const o = await op();
    expect(o.end_reason).toBe("left");
    expect(o.ended_at.getTime()).toBe(at(100));
    expect((await state()).operation_id).toBeNull();
    const card = (await t.api("GET", "/v1/admin/ops/cards")).json.cards.find((c: { deviceId: string }) => c.deviceId === deviceId);
    expect(card.operation).toBeNull();
    // sinal de vida sem usuário na própria bipagem não fecha nada (a página ainda não mandou o retrato)
    expect((await send([{ id: id(), at: at(300), type: "op_start", ...base, total: tot(1) }, hb(500, null, "bipagem")])).status).toBe(200);
    expect((await op()).ended_at).toBeNull();
  });

  it("tela apagada: sem sinal fecha a carga com o motivo, o card mostra; voltando na mesma bipagem, reabre", async () => {
    const { closeStaleOps } = await import("../src/opsRetention.js");
    const base = { fn: "manifesto", plate: "TELA1A1" };
    expect(
      (
        await send([
          { id: id(), at: at(0), type: "session", user: "ana", domain: "ALT", branch: "CGB" },
          { id: id(), at: at(1), type: "op_start", ...base, total: tot(5), read: tot(2) },
          // o coletor avisa que apagou a tela (ainda com a colaboradora logada) e cala
          { id: id(), at: at(30), type: "heartbeat", screen: "apagada", user: "ana", ...base },
        ])
      ).status,
    ).toBe(200);
    expect((await op()).ended_at).toBeNull(); // "apagada" com alguém logado não é saída
    await t.db.query("UPDATE ops_device_state SET last_event_at = now() - interval '4 minutes', last_heartbeat_at = now() - interval '4 minutes' WHERE device_id = $1", [deviceId]);
    expect((await closeStaleOps(t.db, 3)).operations).toHaveLength(1);
    expect(await op()).toMatchObject({ end_reason: "signal_lost", end_detail: "tela_apagada" });
    const card = (await t.api("GET", "/v1/admin/ops/cards")).json.cards.find((c: { deviceId: string }) => c.deviceId === deviceId);
    expect(card.operation).toBeNull();
    expect(card).toMatchObject({ screen: "apagada", lastEnded: { plate: "TELA1A1", endReason: "signal_lost", endDetail: "tela_apagada", fnLabel: "Descarga de Manifesto" } });
    expect((await t.api("GET", `/v1/admin/ops/devices/${deviceId}`)).json.operation).toMatchObject({ endReason: "signal_lost", endDetail: "tela_apagada" });

    // acendeu a tela na mesma bipagem: o sinal de vida já reabre (sem esperar leitura) e o motivo some
    expect((await send([{ id: id(), at: at(300), type: "heartbeat", screen: "bipagem", user: "ana", ...base }])).status).toBe(200);
    expect(await op()).toMatchObject({ ended_at: null, end_reason: null, end_detail: null });
    expect((await state()).operation_id).toBe((await op()).id);

    // desligado: o mesmo, com outro motivo
    expect((await send([{ id: id(), at: at(320), type: "heartbeat", screen: "desligado", user: "ana", ...base }])).status).toBe(200);
    await t.db.query("UPDATE ops_device_state SET last_event_at = now() - interval '4 minutes', last_heartbeat_at = now() - interval '4 minutes' WHERE device_id = $1", [deviceId]);
    await closeStaleOps(t.db, 3);
    expect((await op()).end_detail).toBe("desligado");
  });

  it("erros de bipagem: mensagem do SSW guardada, agrupada por tipo, contada na carga e filtrável", async () => {
    const sc = (code: string, kind: string, sid: string, error?: string) => ({ scan: { id: `e-${sid}`, code, kind, ageMs: 0, ...(error ? { error } : {}) } });
    const base = { fn: "coleta", plate: "ARMAZEM" };
    const msg = "Código não pertence / não localizado na empresa";
    expect(
      (
        await send([
          { id: id(), at: at(0), type: "session", user: "ayrton", domain: "ALT", branch: "CGB" },
          { id: id(), at: at(1), type: "op_start", ...base, total: tot(10), read: tot(0) },
          { id: id(), at: at(2), type: "progress", ...base, read: tot(0), extra: sc("99999999999", "erro", "a", msg) },
          // o mesmo registro de novo (retrato seguinte): não conta duas vezes
          { id: id(), at: at(3), type: "progress", ...base, read: tot(0), extra: sc("99999999999", "erro", "a", msg) },
          // mensagem atrasada: primeiro "não contou", depois o mesmo registro com a mensagem
          { id: id(), at: at(4), type: "progress", ...base, read: tot(0), extra: sc("12345", "nao_contou", "b") },
          { id: id(), at: at(5), type: "progress", ...base, read: tot(0), extra: sc("12345", "erro", "b", "CTRC 4711 já foi lido") },
          { id: id(), at: at(6), type: "progress", ...base, read: tot(0), extra: sc("12346", "erro", "c", "CTRC 4712 já foi lido") },
        ])
      ).status,
    ).toBe(200);
    const rows = (await t.db.query("SELECT code, kind, error, error_key FROM ops_scans WHERE device_id = $1 AND scan_id LIKE 'e-%' ORDER BY at", [deviceId])).rows;
    expect(rows).toEqual([
      { code: "99999999999", kind: "erro", error: msg, error_key: "codigo nao pertence / nao localizado na empresa" },
      { code: "12345", kind: "erro", error: "CTRC 4711 já foi lido", error_key: "ctrc # ja foi lido" },
      { code: "12346", kind: "erro", error: "CTRC 4712 já foi lido", error_key: "ctrc # ja foi lido" },
    ]);
    expect((await op()).scan_errors).toBe(3);

    const detail = (await t.api("GET", `/v1/admin/ops/devices/${deviceId}`)).json;
    expect(detail.operation.scanErrors).toBe(3);
    expect(detail.codes[0]).toMatchObject({ code: "12346", kind: "erro", error: "CTRC 4712 já foi lido" });
    expect(detail.card.operation).toMatchObject({ scanErrors: 3, lastError: { code: "12346", message: "CTRC 4712 já foi lido" } });
    expect((await t.api("GET", "/v1/admin/ops/scans?code=99999999999")).json.results[0]).toMatchObject({ kind: "erro", error: msg });

    const all = (await t.api("GET", "/v1/admin/ops/scan-errors")).json;
    expect(all.errors).toHaveLength(3);
    expect(all.next).toBeNull();
    expect(all.errors[0]).toMatchObject({ code: "12346", message: "CTRC 4712 já foi lido", operation: { plate: "ARMAZEM", user: "ayrton", fnLabel: "Descarga de Coleta" } });
    expect(all.types).toEqual([
      expect.objectContaining({ type: "ctrc # ja foi lido", message: "CTRC 4712 já foi lido", count: 2 }),
      expect.objectContaining({ type: "codigo nao pertence / nao localizado na empresa", count: 1 }),
    ]);
    const only = (await t.api("GET", `/v1/admin/ops/scan-errors?type=${encodeURIComponent("ctrc # ja foi lido")}`)).json;
    expect(only.errors.map((e: { code: string }) => e.code)).toEqual(["12346", "12345"]);
    expect(only.types).toHaveLength(2); // o resumo ignora o próprio filtro de tipo
    expect((await t.api("GET", "/v1/admin/ops/scan-errors?user=outro")).json.errors).toHaveLength(0);
    expect((await t.api("GET", "/v1/admin/ops/scan-errors?plate=armaz")).json.errors).toHaveLength(3);
    expect((await t.api("GET", `/v1/admin/ops/scan-errors?device=${deviceId}`)).json.errors).toHaveLength(3);
    expect((await t.api("GET", "/v1/admin/ops/scan-errors?from=2020-01-01&to=2020-01-31")).json.errors).toHaveLength(0);
    expect((await t.api("GET", "/v1/admin/ops/scan-errors?from=ontem")).status).toBe(400);

    // tipo desconhecido e mensagem longa demais continuam recusados
    expect((await send([{ id: id(), at: at(7), type: "progress", ...base, read: tot(0), extra: sc("1", "xpto", "d") }])).status).toBe(400);
    expect((await send([{ id: id(), at: at(8), type: "progress", ...base, read: tot(0), extra: sc("1", "erro", "d", "x".repeat(301)) }])).status).toBe(400);
  });

  it("diagnóstico de tela não entendida é guardado e não mexe na operação", async () => {
    const d = {
      id: id(),
      at: at(0),
      type: "diag",
      screen: "bipagem",
      reason: "bipagem sem funcao",
      path: "/bin/sswbar/carga/manifesto/armazem",
      title: "Carga de Manifesto",
      ids: ["td#total_qtde", "td#cap_qtde"],
      inputs: ["hidden:funcao=4", "hidden:placa=ARMAZEM"],
      texts: ["Placa provisória: ARMAZEM"],
      reader: "2026-11-18.2",
    };
    expect((await send([d])).status).toBe(200);
    const row = (await t.db.query("SELECT type, data FROM ops_events WHERE id = $1", [d.id])).rows[0];
    expect(row.type).toBe("diag");
    expect(row.data).toMatchObject({ reason: "bipagem sem funcao", inputs: ["hidden:funcao=4", "hidden:placa=ARMAZEM"] });
    expect(await op()).toBeUndefined();
    expect((await send([{ ...d, id: id(), ids: Array.from({ length: 200 }, (_, i) => `x#${i}`) }])).status).toBe(400);
  });

  it("check-in informa o sha256 do leitor e o coletor baixa o script", async () => {
    const tokenOk = token;
    const ck = (await t.api("POST", "/v1/device/checkin", { appVersion: "0.5.1" }, tokenOk)).json;
    expect(ck.reader.sha256).toMatch(/^[0-9a-f]{64}$/);
    const res = await t.app.inject({ method: "GET", url: "/v1/device/reader", headers: { authorization: `Bearer ${tokenOk}` } });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("javascript");
    expect(sha256hex(res.body)).toBe(ck.reader.sha256);
    expect(res.body).toContain("carga_");
    expect((await t.app.inject({ method: "GET", url: "/v1/device/reader", headers: { authorization: "Bearer nada" } })).statusCode).toBe(401);
  });
});

describe("eventos do leitor do SSW: abuso", () => {
  it("o mesmo evento reenviado (lote novo) não conta de novo", async () => {
    const start = { id: id(), at: at(0), type: "op_start", fn: "coleta", plate: "EEE3333", total: tot(5) };
    const p1 = { id: id(), at: at(10), type: "progress", fn: "coleta", plate: "EEE3333", read: tot(1) };
    await send([start, p1]);
    const again = await send([start, p1, { id: id(), at: at(20), type: "progress", fn: "coleta", plate: "EEE3333", read: tot(2) }]);
    expect(again.json).toMatchObject({ accepted: 1, duplicates: 2 });
    expect((await op()).scans).toBe(2);
    expect(Number((await t.db.query("SELECT count(*) FROM ops_events")).rows[0].count)).toBe(3);
  });

  it("lote capturado e reenviado (mesma hora e assinatura) é recusado", async () => {
    const r = await send([{ id: id(), at: at(0), type: "heartbeat", screen: "menu" }]);
    expect(r.status).toBe(200);
    const replay = await send([], { ts: r.ts, body: r.body });
    expect(replay.status).toBe(409);
  });

  it("assinatura errada, token de outro, conteúdo alterado ou aparelho removido: 401", async () => {
    const ev = [{ id: id(), at: at(0), type: "heartbeat", screen: "menu" }];
    expect((await send(ev, { signature: "0".repeat(64) })).status).toBe(401);
    expect((await send(ev, { token: "token-de-outro" })).status).toBe(401);
    // assina um corpo e manda outro
    const ts = (lastTs += 1000);
    const signed = JSON.stringify({ schema: 1, events: ev });
    const tampered = JSON.stringify({ schema: 1, events: [{ ...ev[0], screen: "bipagem" }] });
    expect((await send([], { ts, body: tampered, signature: signBatch(sha256hex(token), ts, signed) })).status).toBe(401);
    expect((await send(ev, { device: crypto.randomUUID() })).status).toBe(401);
    // sem cabeçalhos
    const bare = await t.app.inject({ method: "POST", url: "/v1/device/events", payload: { schema: 1, events: ev } });
    expect(bare.statusCode).toBe(401);
    expect((await t.db.query("SELECT count(*) FROM ops_events")).rows[0].count).toBe("0");
  });

  it("relógio do aparelho muito fora: 401 com a hora do servidor (o app corrige)", async () => {
    const r = await send([{ id: id(), at: at(0), type: "heartbeat", screen: "menu" }], { ts: Date.now() - 10 * 60_000 });
    expect(r.status).toBe(401);
    expect(r.json.error).toBe("clock_skew");
    expect(Math.abs(r.json.serverTime - Date.now())).toBeLessThan(5000);
  });

  it("formato inválido, versão desconhecida, lote grande demais: recusados", async () => {
    expect((await send([{ id: id(), at: at(0), type: "desconhecido" }])).status).toBe(400);
    expect((await send([], { body: JSON.stringify({ schema: 2, events: [{ id: id(), at: at(0), type: "heartbeat", screen: "menu" }] }) })).status).toBe(400);
    expect((await send([{ id: "nao-e-uuid", at: at(0), type: "heartbeat", screen: "menu" }])).status).toBe(400);
    expect((await send([{ id: id(), at: at(0), type: "progress", fn: "coleta", plate: "X", read: { qty: -1, kg: 0, value: 0 } }])).status).toBe(400);
    const many = Array.from({ length: 201 }, () => ({ id: id(), at: at(0), type: "heartbeat", screen: "menu" }));
    expect((await send(many)).status).toBe(400);
    const huge = [{ id: id(), at: at(0), type: "session", user: "x".repeat(70_000) }];
    expect((await send(huge)).status).toBe(413);
    expect((await send([], { body: "{nao é json" })).status).toBe(400);
  });

  it("aparelho removido no painel deixa de mandar eventos", async () => {
    const code = (await t.api("POST", "/v1/admin/enrollments", { name: "Lote 2" })).json.code;
    const other = await t.api("POST", "/v1/device/enroll", { code, info: info("OPS2") }, "");
    await t.api("PATCH", `/v1/admin/devices/${other.json.deviceId}`, { opsReader: true });
    const ev = [{ id: id(), at: at(0), type: "heartbeat", screen: "menu" }];
    expect((await send(ev, { device: other.json.deviceId, token: other.json.token })).status).toBe(200);
    expect((await t.api("DELETE", `/v1/admin/devices/${other.json.deviceId}`)).status).toBe(200);
    expect((await send([{ ...ev[0], id: id() }], { device: other.json.deviceId, token: other.json.token })).status).toBe(401);
  });

  it("piloto: só coletor marcado no painel manda eventos; o check-in informa o app", async () => {
    const code = (await t.api("POST", "/v1/admin/enrollments", { name: "Piloto" })).json.code;
    const other = (await t.api("POST", "/v1/device/enroll", { code, info: info("OPS3") }, "")).json;
    const dev = { device: other.deviceId, token: other.token };
    const checkin = async () => (await t.api("POST", "/v1/device/checkin", { appVersion: "0.5.0" }, other.token)).json;
    const ev = () => [{ id: id(), at: Date.now(), type: "heartbeat", screen: "menu" }];

    expect((await checkin()).opsReader).toBe(false);
    expect((await t.api("GET", `/v1/admin/devices/${other.deviceId}`)).json.opsReader).toBe(false);
    const off = await send(ev(), dev);
    expect(off.status).toBe(403);
    expect(off.json.error).toBe("ops_disabled");

    expect((await t.api("PATCH", `/v1/admin/devices/${other.deviceId}`, { opsReader: true })).status).toBe(200);
    expect((await checkin()).opsReader).toBe(true);
    expect((await t.api("GET", `/v1/admin/devices/${other.deviceId}`)).json).toMatchObject({ opsReader: true, name: expect.any(String) });
    expect((await send(ev(), dev)).status).toBe(200);
    const log = await t.db.query("SELECT event FROM auth_events WHERE details->>'deviceId' = $1", [other.deviceId]);
    expect(log.rows.map((r) => r.event)).toEqual(["ops_reader_on"]);

    // renomear não mexe no piloto; corpo vazio é recusado
    expect((await t.api("PATCH", `/v1/admin/devices/${other.deviceId}`, { name: "Coletor piloto" })).status).toBe(200);
    expect((await checkin()).opsReader).toBe(true);
    expect((await t.api("PATCH", `/v1/admin/devices/${other.deviceId}`, {})).status).toBe(400);

    await t.api("PATCH", `/v1/admin/devices/${other.deviceId}`, { opsReader: false });
    expect((await send(ev(), dev)).status).toBe(403);
  });

  it("chave geral: lê em todos os coletores (menos os desligados um a um), avisa na hora e volta ao piloto", async () => {
    const enroll = async (serial: string) => {
      const code = (await t.api("POST", "/v1/admin/enrollments", { name: serial })).json.code;
      return (await t.api("POST", "/v1/device/enroll", { code, info: info(serial) }, "")).json as { deviceId: string; token: string };
    };
    const a = await enroll("OPS4"); // segue a chave geral
    const b = await enroll("OPS5"); // desligado só nele
    const checkin = async (d: { token: string }) => (await t.api("POST", "/v1/device/checkin", { appVersion: "0.5.0" }, d.token)).json.opsReader;
    const ev = () => [{ id: id(), at: Date.now(), type: "heartbeat", screen: "menu" }];
    await t.api("PATCH", `/v1/admin/devices/${b.deviceId}`, { opsReader: false });
    expect(await checkin(a)).toBe(false);
    const before = (await t.api("GET", "/v1/admin/ops/settings")).json;
    expect(before.readerAll).toBe(false);

    // ligar a chave geral acorda quem está esperando
    const waiting = t.app.inject({ method: "GET", url: "/v1/device/wait?timeoutSec=30", headers: { authorization: `Bearer ${a.token}` } });
    await new Promise((r) => setTimeout(r, 200));
    const t0 = Date.now();
    expect((await t.api("PUT", "/v1/admin/ops/settings", { readerAll: true })).status).toBe(200);
    expect((await waiting).json()).toEqual({ wake: true });
    expect(Date.now() - t0).toBeLessThan(5000);

    expect(await checkin(a)).toBe(true);
    expect(await checkin(b)).toBe(false);
    expect((await send(ev(), { device: a.deviceId, token: a.token })).status).toBe(200);
    expect((await send(ev(), { device: b.deviceId, token: b.token })).status).toBe(403);
    expect((await t.api("GET", `/v1/admin/devices/${a.deviceId}`)).json).toMatchObject({ opsReader: true, opsReaderChoice: null, opsReaderAll: true });
    expect((await t.api("GET", `/v1/admin/devices/${b.deviceId}`)).json).toMatchObject({ opsReader: false, opsReaderChoice: false, opsReaderAll: true });
    const list = (await t.api("GET", "/v1/admin/devices")).json.devices as { id: string; opsReader: boolean }[];
    expect(list.find((d) => d.id === a.deviceId)?.opsReader).toBe(true);
    const after = (await t.api("GET", "/v1/admin/ops/settings")).json;
    expect(after.readerAll).toBe(true);
    // todos leem, menos os desligados um a um (b e o coletor do teste do piloto)
    expect(after.devices.reading).toBe(after.devices.total - 2);

    // b volta a seguir a chave geral
    expect((await t.api("PATCH", `/v1/admin/devices/${b.deviceId}`, { opsReader: null })).status).toBe(200);
    expect(await checkin(b)).toBe(true);
    const log = await t.db.query(
      "SELECT event FROM auth_events WHERE event LIKE 'ops_reader%' AND (details->>'deviceId' = $1 OR event LIKE 'ops_reader_all%') ORDER BY id",
      [b.deviceId],
    );
    expect(log.rows.map((r) => r.event)).toEqual(["ops_reader_off", "ops_reader_all_on", "ops_reader_default"]);

    // operador vê, mas não mexe na chave geral; corpo inválido é recusado
    expect((await t.api("POST", "/v1/admin/users", { username: "op.ops", email: "op.ops@pstarx.com", role: "operator", password: "senha-do-operador-1" })).status).toBe(200);
    const opToken = (await t.api("POST", "/v1/admin/login", { username: "op.ops", password: "senha-do-operador-1" }, "")).json.token;
    expect((await t.api("GET", "/v1/admin/ops/settings", undefined, opToken)).status).toBe(200);
    expect((await t.api("PUT", "/v1/admin/ops/settings", { readerAll: false }, opToken)).status).toBe(403);
    expect((await t.api("PUT", "/v1/admin/ops/settings", { readerAll: "sim" })).status).toBe(400);

    // de volta ao piloto: só quem foi ligado um a um continua
    expect((await t.api("PUT", "/v1/admin/ops/settings", { readerAll: false })).status).toBe(200);
    expect(await checkin(a)).toBe(false);
    expect((await send(ev(), { device: a.deviceId, token: a.token })).status).toBe(403);
    expect((await send(ev())).status).toBe(200); // o coletor principal destes testes foi ligado nele mesmo
  });

  it("limite de envios por coletor", async () => {
    let limited = 0;
    for (let i = 0; i < 125; i++) {
      const r = await send([{ id: id(), at: at(i), type: "heartbeat", screen: "menu" }]);
      if (r.status === 429) limited++;
    }
    expect(limited).toBeGreaterThan(0);
  });
});
