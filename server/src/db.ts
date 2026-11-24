import { AsyncLocalStorage } from "node:async_hooks";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const MIGRATIONS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../migrations");

/** Papel restrito do banco (migração 019): sem superusuário e sem BYPASSRLS, sujeito às políticas por empresa. */
export const APP_ROLE = "kiosk_app";

/**
 * Contexto de banco da requisição (fase 3.3, RLS). Cada requisição HTTP roda num contexto "app": papel restrito e a
 * empresa da requisição em `app.tenant_id` (a da sessão do painel ou a do coletor). Sem empresa, as tabelas com RLS
 * não devolvem nada. "system" (papel dono, enxerga tudo) só para o que precisa ver mais de uma empresa: migrações,
 * jobs de fundo, a busca do coletor pelo token e as rotas da plataforma. Fora de requisição (jobs, inicialização,
 * testes) vale "system".
 */
export interface DbContext {
  system: boolean;
  tenantId: string | null;
}
const ctx = new AsyncLocalStorage<DbContext>();

/** Roda `fn` num contexto novo (usado no começo de cada requisição). */
export function runInContext<T>(store: DbContext, fn: () => T): T {
  return ctx.run(store, fn);
}

/** Roda `fn` como sistema (vê todas as empresas). Usar só onde a consulta precisa mesmo cruzar empresas. */
export function asSystem<T>(fn: () => Promise<T>): Promise<T> {
  return ctx.run({ system: true, tenantId: null }, fn);
}

/** Define a empresa da requisição atual (depois de saber de quem ela é: sessão do painel ou coletor). */
export function setTenant(tenantId: string | null) {
  const s = ctx.getStore();
  if (s && !s.system) s.tenantId = tenantId;
}

type Tagged = pg.PoolClient & { __role?: string; __tenant?: string };

/**
 * Pool do Postgres que aplica o contexto em cada conexão emprestada: papel (`role`) e empresa (`app.tenant_id`),
 * guardados por conexão para não repetir o SET quando não mudou.
 */
export class Db {
  constructor(
    private readonly pool: pg.Pool,
    private readonly appRole: string | null,
  ) {}

  private async prepare(c: Tagged) {
    const s = ctx.getStore();
    const system = !s || s.system || !this.appRole;
    const role = system ? "none" : this.appRole!;
    const tenant = system ? "" : (s!.tenantId ?? "");
    if (c.__role === role && c.__tenant === tenant) return;
    await c.query("SELECT set_config('role', $1, false), set_config('app.tenant_id', $2, false)", [role, tenant]);
    c.__role = role;
    c.__tenant = tenant;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async query<R extends pg.QueryResultRow = any>(text: string, params?: unknown[]): Promise<pg.QueryResult<R>> {
    const c = (await this.pool.connect()) as Tagged;
    try {
      await this.prepare(c);
      return await c.query<R>(text, params);
    } finally {
      c.release();
    }
  }

  /** Conexão para transação, já no contexto atual (o contexto vale do empréstimo até o release). */
  async connect(): Promise<pg.PoolClient> {
    const c = (await this.pool.connect()) as Tagged;
    try {
      await this.prepare(c);
    } catch (e) {
      c.release(e as Error);
      throw e;
    }
    return c;
  }

  end() {
    return this.pool.end();
  }
}

function migrationsDir(): string {
  // src/db.ts (tsx) ou dist/src/db.js (build): procura migrations/ subindo a partir daqui
  for (const candidate of [MIGRATIONS_DIR, path.resolve(MIGRATIONS_DIR, ".."), path.resolve(process.cwd(), "migrations")]) {
    if (fs.existsSync(path.join(candidate, "001_init.sql"))) return candidate;
  }
  throw new Error("pasta migrations/ não encontrada");
}

export function createPool(databaseUrl: string, schema: string): Db {
  if (!/^[a-z_][a-z0-9_]*$/.test(schema)) throw new Error(`schema inválido: ${schema}`);
  const pool = new pg.Pool({
    connectionString: databaseUrl,
    max: 10,
    options: `-c search_path=${schema}`,
  });
  return new Db(pool, APP_ROLE);
}

/** Aplica as migrações pendentes, em ordem, cada uma numa transação. Seguro com várias instâncias (advisory lock). */
export async function migrate(db: Db, schema: string, opts: { until?: string } = {}): Promise<string[]> {
  // sempre como sistema (papel dono): cria tabelas, papéis e políticas
  const client = await asSystem(() => db.connect());
  const applied: string[] = [];
  try {
    await client.query("SELECT pg_advisory_lock(727001)");
    await client.query(`CREATE SCHEMA IF NOT EXISTS ${schema}`);
    await client.query(`CREATE TABLE IF NOT EXISTS ${schema}.schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`);
    const done = new Set((await client.query<{ name: string }>(`SELECT name FROM ${schema}.schema_migrations`)).rows.map((r) => r.name));
    const dir = migrationsDir();
    const files = fs.readdirSync(dir).filter((f) => /^\d+_.+\.sql$/.test(f)).sort();
    for (const file of files) {
      if (done.has(file)) continue;
      // testes de atualização: para antes de uma migração (ex.: dados criados no formato antigo)
      if (opts.until && file >= opts.until) break;
      const sql = fs.readFileSync(path.join(dir, file), "utf8");
      await client.query("BEGIN");
      try {
        await client.query(`SET LOCAL search_path TO ${schema}`);
        await client.query(sql);
        await client.query(`INSERT INTO ${schema}.schema_migrations (name) VALUES ($1)`, [file]);
        await client.query("COMMIT");
        applied.push(file);
      } catch (e) {
        await client.query("ROLLBACK");
        throw new Error(`migração ${file} falhou: ${(e as Error).message}`);
      }
    }
  } finally {
    await client.query("SELECT pg_advisory_unlock(727001)").catch(() => undefined);
    client.release();
  }
  return applied;
}
