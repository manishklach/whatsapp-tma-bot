import "dotenv/config";
import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { ConversationService } from "./conversation.js";
import { ApiPdfProvider, LocalPdfProvider } from "./pdf.js";
import { connectRedisStore } from "./store.js";
import { WhatsAppClient } from "./whatsapp.js";

const config = loadConfig();
const store = await connectRedisStore(config.REDIS_URL, config.SESSION_TTL_SECONDS);
const messaging = new WhatsAppClient({ accessToken: config.WHATSAPP_ACCESS_TOKEN, phoneNumberId: config.WHATSAPP_PHONE_NUMBER_ID, graphApiVersion: config.WHATSAPP_GRAPH_API_VERSION });
const pdf = config.PDF_API_URL ? new ApiPdfProvider(config.PDF_API_URL, config.PDF_API_TOKEN, config.PDF_API_TIMEOUT_MS) : new LocalPdfProvider();
const conversation = new ConversationService(store, messaging, pdf);
const app = createApp({ verifyToken: config.WHATSAPP_VERIFY_TOKEN, appSecret: config.WHATSAPP_APP_SECRET, conversation });
const server = app.listen(config.PORT, () => console.log(`TM-A bot listening on port ${config.PORT}`));

async function shutdown(signal: string) {
  console.log(`${signal} received; shutting down`);
  server.close(async () => { await store.close(); process.exit(0); });
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
