// Copia o worker do maplibre-gl para public/ (o bundler do Next não acha o worker sozinho).
// Roda antes de "dev" e "build"; o arquivo gerado não vai para o git.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const src = path.join(root, "node_modules", "maplibre-gl", "dist", "maplibre-gl-worker.mjs");
const dest = path.join(root, "public", "vendor", "maplibre-gl-worker.mjs");
fs.mkdirSync(path.dirname(dest), { recursive: true });
fs.copyFileSync(src, dest);
console.log("maplibre worker ->", path.relative(root, dest));
