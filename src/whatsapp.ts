import type { IncomingMessage, MediaAnswer, MessagingClient } from "./types.js";

const MAX_MEDIA_BYTES = 15 * 1024 * 1024;

type WhatsAppConfig = {
  accessToken: string;
  phoneNumberId: string;
  graphApiVersion: string;
};

export class WhatsAppClient implements MessagingClient {
  private readonly base: string;
  constructor(private readonly config: WhatsAppConfig) {
    this.base = `https://graph.facebook.com/${config.graphApiVersion}`;
  }

  private async request(path: string, init?: RequestInit): Promise<Response> {
    const response = await fetch(`${this.base}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${this.config.accessToken}`, ...init?.headers }
    });
    if (!response.ok) throw new Error(`WhatsApp API ${response.status}: ${await response.text()}`);
    return response;
  }

  async sendText(to: string, body: string): Promise<void> {
    await this.request(`/${this.config.phoneNumberId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", recipient_type: "individual", to, type: "text", text: { preview_url: false, body } })
    });
  }

  async sendPdf(to: string, pdf: Buffer, filename: string, caption: string): Promise<void> {
    const form = new FormData();
    form.append("messaging_product", "whatsapp");
    form.append("type", "application/pdf");
    form.append("file", new Blob([Uint8Array.from(pdf)], { type: "application/pdf" }), filename);
    const uploaded = await this.request(`/${this.config.phoneNumberId}/media`, { method: "POST", body: form });
    const { id } = (await uploaded.json()) as { id: string };
    await this.request(`/${this.config.phoneNumberId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", to, type: "document", document: { id, filename, caption } })
    });
  }

  async downloadMedia(mediaId: string, filename?: string): Promise<MediaAnswer> {
    const metadata = await this.request(`/${mediaId}`);
    const { url, mime_type } = (await metadata.json()) as { url: string; mime_type: string };
    const response = await fetch(url, { headers: { Authorization: `Bearer ${this.config.accessToken}` } });
    if (!response.ok) throw new Error(`Media download failed: ${response.status}`);
    const declaredLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(declaredLength) && declaredLength > MAX_MEDIA_BYTES) {
      await response.body?.cancel();
      throw new Error("Uploaded media exceeds the 15 MB limit");
    }
    if (!response.body) throw new Error("Media download returned an empty body");
    const reader = response.body.getReader();
    const chunks: Buffer[] = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_MEDIA_BYTES) {
        await reader.cancel();
        throw new Error("Uploaded media exceeds the 15 MB limit");
      }
      chunks.push(Buffer.from(value));
    }
    const data = Buffer.concat(chunks, total);
    return { mediaId, mimeType: mime_type, filename, data };
  }
}

export function parseIncomingMessages(body: unknown): IncomingMessage[] {
  const entries = (body as any)?.entry ?? [];
  const output: IncomingMessage[] = [];
  for (const entry of entries) for (const change of entry.changes ?? []) {
    for (const message of change.value?.messages ?? []) {
      if (message.type === "text") output.push({ id: message.id, from: message.from, type: "text", text: message.text?.body });
      else if (message.type === "image") output.push({ id: message.id, from: message.from, type: "image", mediaId: message.image?.id, mimeType: message.image?.mime_type });
      else if (message.type === "document") output.push({ id: message.id, from: message.from, type: "document", mediaId: message.document?.id, mimeType: message.document?.mime_type, filename: message.document?.filename });
      else output.push({ id: message.id, from: message.from, type: "unsupported" });
    }
  }
  return output;
}
