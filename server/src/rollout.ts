import fs from "node:fs";
import path from "node:path";
import { asSystem, type Db } from "./db.js";
import { readerScript } from "./reader.js";
import { readPending, readRelease, Release, writeJsonAtomic } from "./release.js";

/*
  Publicação em dois grupos, para o app do kiosk e para o leitor do SSW:
  - "all" (todos os coletores) e "pilot" (só os coletores marcados como piloto). Sem "pilot", os pilotos seguem "all".
  - Publicar para os pilotos testa a versão em produção num grupo pequeno; publicar para todos encerra o teste (o canal
    dos pilotos some e todos ficam iguais).
  - Cada publicação pode ser agendada (release_schedules); a API aplica na hora marcada (scheduleReleases).
  - Um leitor novo trazido por um deploy da API não chega a ninguém sozinho: fica disponível até ser publicado.
    Exceção: o primeiro (sem nada publicado ainda) vira o de todos, como antes.
  - O release.json (QR de cadastro) acompanha a versão de "all" do app do kiosk.
  Tabelas da plataforma (sem empresa): tudo aqui roda como sistema.
*/

export type Kind = "kiosk" | "reader";
export type Channel = "pilot" | "all";

export class RolloutError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 409,
  ) {
    super(message);
  }
}

interface KioskRow {
  version_code: number;
  version_name: string;
  file: string;
  sha256: string;
  size_bytes: string | number;
  signature_checksum: string;
  notes: string[];
  reversible: boolean | null;
  reversible_note: string | null;
  uploaded_by: string | null;
  uploaded_at: Date;
}

const KIOSK_PACKAGE = "com.pstarx.kiosk";

function toRelease(r: KioskRow): Release {
  return {
    packageName: KIOSK_PACKAGE,
    versionCode: r.version_code,
    versionName: r.version_name,
    file: r.file,
    sizeBytes: Number(r.size_bytes),
    sha256: r.sha256,
    signatureChecksum: r.signature_checksum,
    builtAt: r.uploaded_at.toISOString(),
  };
}

/** Versão do leitor escrita no próprio script (var VERSION = "..."). */
export function readerVersion(body: string): string | null {
  return body.match(/var VERSION = "([^"]{1,40})"/)?.[1] ?? null;
}

async function channels(db: Db, kind: Kind): Promise<{ all: string | null; pilot: string | null }> {
  const rows = (await asSystem(() => db.query<{ channel: Channel; ref: string }>("SELECT channel, ref FROM release_channels WHERE kind = $1", [kind]))).rows;
  return { all: rows.find((r) => r.channel === "all")?.ref ?? null, pilot: rows.find((r) => r.channel === "pilot")?.ref ?? null };
}

async function kioskRow(db: Db, code: number): Promise<KioskRow | null> {
  return (await asSystem(() => db.query<KioskRow>("SELECT * FROM kiosk_versions WHERE version_code = $1", [code]))).rows[0] ?? null;
}

/**
 * Na subida da API: registra o leitor deste deploy e, na primeira vez, importa o que já estava publicado
 * (release.json/pending.json do app; o leitor atual vira o de todos).
 */
export async function syncReleases(db: Db, apkDir: string): Promise<void> {
  await asSystem(async () => {
    const r = readerScript();
    if (r) {
      await db.query("INSERT INTO reader_versions (sha256, version, body) VALUES ($1, $2, $3) ON CONFLICT (sha256) DO NOTHING", [r.sha256, readerVersion(r.body), r.body]);
      await db.query("INSERT INTO release_channels (kind, channel, ref, updated_by) VALUES ('reader', 'all', $1, 'sistema') ON CONFLICT DO NOTHING", [r.sha256]);
    }
    const any = (await db.query("SELECT 1 FROM kiosk_versions LIMIT 1")).rowCount;
    if (!any) {
      const rel = readRelease(apkDir);
      const pend = readPending(apkDir);
      for (const v of [rel, pend]) {
        if (!v) continue;
        await db.query(
          `INSERT INTO kiosk_versions (version_code, version_name, file, sha256, size_bytes, signature_checksum, uploaded_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT DO NOTHING`,
          [v.versionCode, v.versionName, v.file, v.sha256, v.sizeBytes, v.signatureChecksum, v.builtAt],
        );
      }
      if (rel) await db.query("INSERT INTO release_channels (kind, channel, ref, updated_by) VALUES ('kiosk', 'all', $1, 'sistema') ON CONFLICT DO NOTHING", [String(rel.versionCode)]);
      if (pend) fs.rmSync(path.join(apkDir, "pending.json"), { force: true });
    }
  });
}

/** Versão do app do kiosk para um coletor (piloto ou não). null: nada publicado. */
export async function kioskFor(db: Db, pilot: boolean): Promise<Release | null> {
  const ch = await channels(db, "kiosk");
  const ref = (pilot && ch.pilot) || ch.all;
  if (!ref) return null;
  const row = await kioskRow(db, Number(ref));
  return row ? toRelease(row) : null;
}

/** Versão publicada para todos (QR de cadastro). */
export const kioskAll = (db: Db) => kioskFor(db, false);

/** Leitor do SSW para um coletor (piloto ou não). Sem nada publicado: o deste deploy. */
export async function readerFor(db: Db, pilot: boolean): Promise<{ sha256: string; body: string } | null> {
  const ch = await channels(db, "reader");
  const ref = (pilot && ch.pilot) || ch.all;
  if (ref) {
    const row = (await asSystem(() => db.query<{ sha256: string; body: string }>("SELECT sha256, body FROM reader_versions WHERE sha256 = $1", [ref]))).rows[0];
    if (row) return row;
  }
  const r = readerScript();
  return r ? { sha256: r.sha256, body: r.body } : null;
}

/** Guarda uma versão nova do app enviada pelo painel (o arquivo já está em apkDir). */
export async function addKioskVersion(
  db: Db,
  v: Release & { notes: string[]; reversible: boolean | null; reversibleNote: string | null; uploadedBy: string | null },
): Promise<void> {
  await asSystem(() =>
    db.query(
      `INSERT INTO kiosk_versions (version_code, version_name, file, sha256, size_bytes, signature_checksum, notes, reversible, reversible_note, uploaded_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [v.versionCode, v.versionName, v.file, v.sha256, v.sizeBytes, v.signatureChecksum, JSON.stringify(v.notes), v.reversible, v.reversibleNote, v.uploadedBy],
    ),
  );
}

/** A versão mais nova já enviada (publicada ou não) e a assinatura que todas têm de ter. */
export async function kioskNewest(db: Db): Promise<Release | null> {
  const row = (await asSystem(() => db.query<KioskRow>("SELECT * FROM kiosk_versions ORDER BY version_code DESC LIMIT 1"))).rows[0];
  return row ? toRelease(row) : null;
}

/** Remove uma versão nunca publicada (nem agendada). */
export async function discardKioskVersion(db: Db, apkDir: string, code: number): Promise<void> {
  await asSystem(async () => {
    const used = await db.query(
      `SELECT 1 FROM release_channels WHERE kind = 'kiosk' AND ref = $1
       UNION ALL SELECT 1 FROM release_schedules WHERE kind = 'kiosk' AND ref = $1 AND done_at IS NULL AND canceled_at IS NULL`,
      [String(code)],
    );
    if (used.rowCount) throw new RolloutError("in_use", "esta versão está publicada ou agendada: não dá para descartar");
    const row = (await db.query<{ file: string }>("DELETE FROM kiosk_versions WHERE version_code = $1 RETURNING file", [code])).rows[0];
    if (!row) throw new RolloutError("not_found", "versão não encontrada", 404);
    fs.rmSync(path.join(apkDir, row.file), { force: true });
  });
}

/** Confere se dá para publicar (para os pilotos ou todos) agora ou na hora agendada. */
async function check(db: Db, kind: Kind, channel: Channel, ref: string): Promise<void> {
  const ch = await channels(db, kind);
  if (kind === "kiosk") {
    const row = await kioskRow(db, Number(ref));
    if (!row) throw new RolloutError("not_found", "versão do app não encontrada", 404);
    const all = ch.all ? Number(ch.all) : 0;
    // o Android não rebaixa: a versão de todos só anda para frente; a dos pilotos tem de ser mais nova que a de todos
    if (channel === "all" && Number(ref) < all) throw new RolloutError("not_newer", "os coletores já estão numa versão mais nova (o Android não instala uma versão mais velha por cima)");
    if (channel === "pilot" && Number(ref) <= all) throw new RolloutError("not_newer", "os pilotos só recebem uma versão mais nova que a de todos");
  } else {
    const row = (await asSystem(() => db.query("SELECT 1 FROM reader_versions WHERE sha256 = $1", [ref]))).rowCount;
    if (!row) throw new RolloutError("not_found", "versão do leitor não encontrada", 404);
  }
  if (channel === "all" && ch.all === ref) throw new RolloutError("already", "já é a versão de todos");
  if (channel === "pilot" && ch.pilot === ref) throw new RolloutError("already", "já é a versão dos pilotos");
}

/** Publica agora. Para todos: os pilotos voltam a seguir todos (o teste acabou). */
export async function publish(db: Db, apkDir: string, kind: Kind, channel: Channel, ref: string, by: string | null): Promise<void> {
  await check(db, kind, channel, ref);
  await asSystem(async () => {
    await db.query(
      `INSERT INTO release_channels (kind, channel, ref, updated_by) VALUES ($1, $2, $3, $4)
       ON CONFLICT (kind, channel) DO UPDATE SET ref = EXCLUDED.ref, updated_by = EXCLUDED.updated_by, updated_at = now()`,
      [kind, channel, ref, by],
    );
    if (channel === "all") await db.query("DELETE FROM release_channels WHERE kind = $1 AND channel = 'pilot'", [kind]);
  });
  if (kind === "kiosk" && channel === "all") await mirrorReleaseJson(db, apkDir);
}

/** Tira a versão dos pilotos (eles voltam à de todos). */
export async function clearPilot(db: Db, kind: Kind): Promise<void> {
  await asSystem(() => db.query("DELETE FROM release_channels WHERE kind = $1 AND channel = 'pilot'", [kind]));
}

/** Agenda (a hora tem de ser no futuro). As mesmas regras são conferidas de novo na hora de aplicar. */
export async function schedule(db: Db, kind: Kind, channel: Channel, ref: string, at: Date, by: string | null): Promise<string> {
  if (at.getTime() <= Date.now()) throw new RolloutError("past", "a hora agendada já passou", 400);
  await check(db, kind, channel, ref);
  const r = await asSystem(() =>
    db.query<{ id: string }>("INSERT INTO release_schedules (kind, channel, ref, run_at, created_by) VALUES ($1, $2, $3, $4, $5) RETURNING id", [kind, channel, ref, at, by]),
  );
  return r.rows[0].id;
}

export async function cancelSchedule(db: Db, id: string): Promise<boolean> {
  const r = await asSystem(() => db.query("UPDATE release_schedules SET canceled_at = now() WHERE id = $1 AND done_at IS NULL AND canceled_at IS NULL", [id]));
  return (r.rowCount ?? 0) > 0;
}

/** Aplica os agendamentos vencidos (em ordem). Uma falha fica registrada no próprio agendamento. */
export async function applyDue(db: Db, apkDir: string, now = new Date()): Promise<number> {
  const due = (
    await asSystem(() =>
      db.query<{ id: string; kind: Kind; channel: Channel; ref: string; created_by: string | null }>(
        "SELECT id, kind, channel, ref, created_by FROM release_schedules WHERE done_at IS NULL AND canceled_at IS NULL AND run_at <= $1 ORDER BY run_at, created_at",
        [now],
      ),
    )
  ).rows;
  for (const s of due) {
    let result = "publicado";
    try {
      await publish(db, apkDir, s.kind, s.channel, s.ref, s.created_by ? `${s.created_by} (agendado)` : "agendado");
    } catch (e) {
      result = e instanceof RolloutError ? `não publicado: ${e.message}` : "não publicado: erro interno";
    }
    await asSystem(() => db.query("UPDATE release_schedules SET done_at = now(), result = $2 WHERE id = $1", [s.id, result]));
  }
  return due.length;
}

/** release.json = versão de todos (o QR de cadastro instala ela). */
async function mirrorReleaseJson(db: Db, apkDir: string): Promise<void> {
  const rel = await kioskAll(db);
  if (!rel) return;
  fs.mkdirSync(apkDir, { recursive: true });
  writeJsonAtomic(path.join(apkDir, "release.json"), rel);
}

/** Roda os agendamentos a cada 30 s. Devolve a função que para. */
export function scheduleReleases(db: Db, apkDir: string, log: { info: (o: object, m: string) => void; error: (o: object, m: string) => void }, everyMs = 30_000) {
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      const n = await applyDue(db, apkDir);
      if (n) log.info({ n }, "publicações agendadas aplicadas");
    } catch (err) {
      log.error({ err }, "falha nas publicações agendadas");
    } finally {
      running = false;
    }
  };
  const t = setInterval(run, everyMs);
  t.unref?.();
  void run();
  return () => clearInterval(t);
}

/** Tudo o que a página de apps mostra sobre o app do kiosk e o leitor. */
export async function releasesView(db: Db, tenantId: string | null) {
  return asSystem(async () => {
    const [kch, rch] = [await channels(db, "kiosk"), await channels(db, "reader")];
    const versions = (await db.query<KioskRow>("SELECT * FROM kiosk_versions ORDER BY version_code DESC LIMIT 30")).rows;
    const readers = (await db.query<{ sha256: string; version: string | null; first_seen_at: Date }>("SELECT sha256, version, first_seen_at FROM reader_versions ORDER BY first_seen_at DESC LIMIT 15")).rows;
    const schedules = (
      await db.query<{ id: string; kind: Kind; channel: Channel; ref: string; run_at: Date; created_by: string | null; done_at: Date | null; result: string | null }>(
        `SELECT id, kind, channel, ref, run_at, created_by, done_at, result FROM release_schedules
         WHERE canceled_at IS NULL AND (done_at IS NULL OR done_at > now() - interval '7 days') ORDER BY run_at DESC LIMIT 30`,
      )
    ).rows;
    // coletores da empresa (a plataforma vê todos): versão do app, piloto, leitor
    const devices = (
      await db.query<{ id: string; name: string; tenant: string | null; pilot: boolean; app_version: string | null; app_version_code: number | null; last_seen_at: Date | null }>(
        `SELECT d.id, d.name, t.name AS tenant, d.pilot, d.app_version, d.app_version_code, d.last_seen_at
         FROM devices d LEFT JOIN tenants t ON t.id = d.tenant_id WHERE $1::uuid IS NULL OR d.tenant_id = $1 ORDER BY d.name`,
        [tenantId],
      )
    ).rows;
    const current = (await readerScript())?.sha256 ?? null;
    return {
      kiosk: {
        all: kch.all ? Number(kch.all) : null,
        pilot: kch.pilot ? Number(kch.pilot) : null,
        versions: versions.map((v) => ({
          versionCode: v.version_code,
          versionName: v.version_name,
          sizeBytes: Number(v.size_bytes),
          sha256: v.sha256,
          notes: v.notes ?? [],
          reversible: v.reversible,
          reversibleNote: v.reversible_note,
          uploadedBy: v.uploaded_by,
          uploadedAt: v.uploaded_at.toISOString(),
          devices: devices.filter((d) => d.app_version_code === v.version_code).length,
        })),
      },
      reader: {
        all: rch.all,
        pilot: rch.pilot,
        deployed: current,
        versions: readers.map((r) => ({ sha256: r.sha256, version: r.version, firstSeenAt: r.first_seen_at.toISOString() })),
      },
      schedules: schedules.map((s) => ({
        id: s.id,
        kind: s.kind,
        channel: s.channel,
        ref: s.ref,
        runAt: s.run_at.toISOString(),
        createdBy: s.created_by,
        doneAt: s.done_at?.toISOString() ?? null,
        result: s.result,
      })),
      devices: devices.map((d) => ({
        id: d.id,
        name: d.name,
        tenant: d.tenant,
        pilot: d.pilot,
        appVersion: d.app_version,
        appVersionCode: d.app_version_code,
        lastSeenAt: d.last_seen_at?.toISOString() ?? null,
      })),
    };
  });
}
