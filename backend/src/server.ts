import { createApp } from "./app.js";
import { env } from "./config/env.js";
import { checkDatabase, pool } from "./db/pool.js";
import { startNotificationScheduler } from "./services/notificationService.js";

await checkDatabase();
const app = createApp();
const server = app.listen(env.PORT, () => {
  console.log(`SporeAlert API listening on http://localhost:${env.PORT}`);
});
const notificationScheduler = startNotificationScheduler();

async function shutdown(signal: string): Promise<void> {
  console.log(`${signal} received; shutting down`);
  notificationScheduler.stop();
  server.close(async () => {
    await pool.end();
    process.exit(0);
  });
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
