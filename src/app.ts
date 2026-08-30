import crypto from "node:crypto";
import express, { type Request, type Response } from "express";
import type { ConversationService } from "./conversation.js";
import { parseIncomingMessages } from "./whatsapp.js";

type AppOptions = { verifyToken: string; appSecret: string; conversation: ConversationService };

function signatureValid(raw: Buffer, signature: string | undefined, secret: string): boolean {
  if (!signature?.startsWith("sha256=")) return false;
  const expected = `sha256=${crypto.createHmac("sha256", secret).update(raw).digest("hex")}`;
  const supplied = Buffer.from(signature);
  const wanted = Buffer.from(expected);
  return supplied.length === wanted.length && crypto.timingSafeEqual(supplied, wanted);
}

export function createApp(options: AppOptions) {
  const app = express();
  app.disable("x-powered-by");
  app.get("/health", (_req, res) => res.json({ status: "ok" }));
  app.get("/webhooks/whatsapp", (req: Request, res: Response) => {
    if (req.query["hub.mode"] === "subscribe" && req.query["hub.verify_token"] === options.verifyToken) return res.status(200).send(req.query["hub.challenge"]);
    return res.sendStatus(403);
  });
  app.post("/webhooks/whatsapp", express.raw({ type: "application/json", limit: "2mb" }), (req: Request, res: Response) => {
    const raw = req.body as Buffer;
    if (!signatureValid(raw, req.header("x-hub-signature-256"), options.appSecret)) return res.sendStatus(401);
    let body: unknown;
    try { body = JSON.parse(raw.toString("utf8")); } catch { return res.sendStatus(400); }
    res.sendStatus(200);
    for (const message of parseIncomingMessages(body)) {
      void options.conversation.handle(message).catch((error) => console.error("Message processing failed", { messageId: message.id, error }));
    }
  });
  return app;
}
