export type MediaAnswer = {
  mediaId: string;
  mimeType: string;
  filename?: string;
  data: Buffer;
};

export type Answer = string | boolean | MediaAnswer;

export type SessionStatus = "collecting" | "reviewing" | "generating" | "completed" | "cancelled";

export type Session = {
  phone: string;
  cursor: number;
  status: SessionStatus;
  answers: Record<string, Answer>;
  updatedAt: string;
};

export type IncomingMessage = {
  id: string;
  from: string;
  type: "text" | "image" | "document" | "unsupported";
  text?: string;
  mediaId?: string;
  mimeType?: string;
  filename?: string;
};

export interface SessionStore {
  get(phone: string): Promise<Session | null>;
  set(session: Session): Promise<void>;
  delete(phone: string): Promise<void>;
  claimMessage(messageId: string): Promise<boolean>;
  close(): Promise<void>;
}

export interface MessagingClient {
  sendText(to: string, body: string): Promise<void>;
  sendPdf(to: string, pdf: Buffer, filename: string, caption: string): Promise<void>;
  downloadMedia(mediaId: string, filename?: string): Promise<MediaAnswer>;
}

export interface PdfProvider {
  generate(answers: Record<string, Answer>): Promise<Buffer>;
}
