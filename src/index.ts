import "dotenv/config";
import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { BullMessageQueue } from "./queue.js";

const config = loadConfig();
const queue = new BullMessageQueue(config.REDIS_URL);
const app = createApp({ verifyToken: config.WHATSAPP_VERIFY_TOKEN, appSecret: config.WHATSAPP_APP_SECRET, queue });
const server = app.listen(config.PORT, () => console.log(`TM-A bot listening on port ${config.PORT}`));

async function shutdown(signal: string) {
  console.log(`${signal} received; shutting down`);
  server.close(async () => { await queue.close(); process.exit(0); });
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
