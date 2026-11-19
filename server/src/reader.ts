import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sha256hex } from "./ops.js";

/**
 * Leitor do SSW (reader/ssw_reader.js) entregue aos coletores: o check-in informa o sha256 e o app baixa em
 * GET /v1/device/reader quando muda. Ajustes de mapeamento saem com a API, sem app novo.
 */
export interface ReaderScript {
  body: string;
  sha256: string;
}

let cached: { file: string; mtimeMs: number; script: ReaderScript } | null = null;

function readerFile(): string | null {
  const here = path.dirname(fileURLToPath(import.meta.url));
  // src/reader.ts (tsx), dist/src/reader.js (build) ou /app/reader (Docker)
  for (const dir of [path.resolve(here, "../reader"), path.resolve(here, "../../reader"), path.resolve(process.cwd(), "reader")]) {
    const f = path.join(dir, "ssw_reader.js");
    if (fs.existsSync(f)) return f;
  }
  return null;
}

/** O leitor atual (relido se o arquivo mudar). null se o arquivo não existir. */
export function readerScript(): ReaderScript | null {
  const file = readerFile();
  if (!file) return null;
  const mtimeMs = fs.statSync(file).mtimeMs;
  if (cached?.file === file && cached.mtimeMs === mtimeMs) return cached.script;
  const body = fs.readFileSync(file, "utf8");
  cached = { file, mtimeMs, script: { body, sha256: sha256hex(body) } };
  return cached.script;
}
