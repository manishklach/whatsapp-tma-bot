import "dotenv/config";
import { loadConfig } from "./config.js";
import { ConversationService } from "./conversation.js";
import { ApiPdfProvider, LocalPdfProvider } from "./pdf.js";
import { createMessageWorker } from "./queue.js";
import { connectRedisStore } from "./store.js";
import { WhatsAppClient } from "./whatsapp.js";

const config = loadConfig();
const store = await connectRedisStore(config.REDIS_URL, config.SESSION_TTL_SECONDS);
const messaging = new WhatsAppClient({ accessToken: config.WHATSAPP_ACCESS_TOKEN, phoneNumberId: config.WHATSAPP_PHONE_NUMBER_ID, graphApiVersion: config.WHATSAPP_GRAPH_API_VERSION });
const pdf = config.PDF_API_URL ? new ApiPdfProvider(config.PDF_API_URL, config.PDF_API_TOKEN, config.PDF_API_TIMEOUT_MS, config.PDF_API_DOWNLOAD_ALLOWLIST) : new LocalPdfProvider();
const conversation = new ConversationService(store, messaging, pdf);
const worker = createMessageWorker(config.REDIS_URL, conversation);
console.log("TM-A message worker started");

async function shutdown(signal: string) {
  console.log(`${signal} received; shutting down worker`);
  await worker.close();
  await store.close();
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
