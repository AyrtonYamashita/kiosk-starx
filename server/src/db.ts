import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

export type Db = pg.Pool;

const MIGRATIONS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../migrations");

function migrationsDir(): string {
  // src/db.ts (tsx) ou dist/src/db.js (build): procura migrations/ subindo a partir daqui
  for (const candidate of [MIGRATIONS_DIR, path.resolve(MIGRATIONS_DIR, ".."), path.resolve(process.cwd(), "migrations")]) {
    if (fs.existsSync(path.join(candidate, "001_init.sql"))) return candidate;
  }
  throw new Error("pasta migrations/ não encontrada");
}

export function createPool(databaseUrl: string, schema: string): Db {
  if (!/^[a-z_][a-z0-9_]*$/.test(schema)) throw new Error(`schema inválido: ${schema}`);
  return new pg.Pool({
    connectionString: databaseUrl,
    max: 10,
    options: `-c search_path=${schema}`,
  });
}

/** Aplica as migrações pendentes, em ordem, cada uma numa transação. Seguro com várias instâncias (advisory lock). */
export async function migrate(db: Db, schema: string): Promise<string[]> {
  const client = await db.connect();
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
