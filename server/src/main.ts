import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { createPool, migrate } from "./db.js";
import { scheduleOpsRetention } from "./opsRetention.js";
import { scheduleRetention } from "./retention.js";
import { ensureAdmin } from "./routes/admin.js";

const config = loadConfig();
const db = createPool(config.databaseUrl, config.dbSchema);
const applied = await migrate(db, config.dbSchema);
const app = await buildApp(config, db);
if (applied.length) app.log.info({ applied }, "migrações aplicadas");
await ensureAdmin(db, config, app.log);
const stopDataRetention = scheduleRetention(db, { ...config.retention, erasureSecret: config.authSecret }, app.log);
const stopRetention = scheduleOpsRetention(db, { eventDays: config.opsRetentionDays, heartbeatDays: config.opsHeartbeatRetentionDays, scanDays: config.opsScanRetentionDays }, app.log);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, async () => {
    stopRetention();
    stopDataRetention();
    await app.close();
    await db.end();
    process.exit(0);
  });
}

await app.listen({ host: "0.0.0.0", port: config.port });
