import { afterEach, describe, expect, it, vi } from "vitest";
import { loadConfig } from "../src/config.js";
import { ApiPdfProvider } from "../src/pdf.js";
import { WhatsAppClient } from "../src/whatsapp.js";

afterEach(() => vi.unstubAllGlobals());

describe("ApiPdfProvider", () => {
  it("rejects downloadUrl hosts outside the configured allowlist", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ downloadUrl: "https://169.254.169.254/latest/meta-data" }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    const provider = new ApiPdfProvider("https://pdf.example.com/generate", undefined, 30000, ["files.example.com"]);
    await expect(provider.generate({ tradeMark: "TEST" })).rejects.toThrow("PDF download host is not allowed");
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("allows HTTPS subdomains of an allowlisted domain", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ downloadUrl: "https://generated.files.example.com/result.pdf" }), { status: 200, headers: { "content-type": "application/json" } }))
      .mockResolvedValueOnce(new Response(Buffer.from("%PDF-allowed"), { status: 200, headers: { "content-type": "application/pdf" } }));
    vi.stubGlobal("fetch", fetchMock);
    const provider = new ApiPdfProvider("https://pdf.example.com/generate", undefined, 30000, ["files.example.com"]);
    expect((await provider.generate({ tradeMark: "TEST" })).toString()).toBe("%PDF-allowed");
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({ redirect: "error" });
  });
});

describe("PDF download allowlist configuration", () => {
  const baseEnv = {
    WHATSAPP_VERIFY_TOKEN: "verify-secret",
    WHATSAPP_APP_SECRET: "app-secret",
    WHATSAPP_ACCESS_TOKEN: "access-token",
    WHATSAPP_PHONE_NUMBER_ID: "phone-id"
  };

  it("normalizes and validates comma-separated hosts", () => {
    const config = loadConfig({ ...baseEnv, PDF_API_DOWNLOAD_ALLOWLIST: "files.example.com, .CDN.EXAMPLE.ORG." });
    expect(config.PDF_API_DOWNLOAD_ALLOWLIST).toEqual(["files.example.com", "cdn.example.org"]);
  });

  it("rejects URLs and paths instead of accepting them as hosts", () => {
    expect(() => loadConfig({ ...baseEnv, PDF_API_DOWNLOAD_ALLOWLIST: "https://files.example.com/path" })).toThrow();
  });
});

describe("WhatsAppClient.downloadMedia", () => {
  it("rejects an oversized Content-Length before reading the body", async () => {
    const cancel = vi.fn(async () => {});
    const getReader = vi.fn();
    const oversizedResponse = { ok: true, status: 200, headers: new Headers({ "content-length": String(16 * 1024 * 1024) }), body: { cancel, getReader } } as unknown as Response;
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ url: "https://media.example.com/file", mime_type: "application/pdf" }), { status: 200 }))
      .mockResolvedValueOnce(oversizedResponse);
    vi.stubGlobal("fetch", fetchMock);
    const client = new WhatsAppClient({ accessToken: "test-token", phoneNumberId: "phone-id", graphApiVersion: "v26.0" });
    await expect(client.downloadMedia("media-id")).rejects.toThrow("exceeds the 15 MB limit");
    expect(cancel).toHaveBeenCalledOnce();
    expect(getReader).not.toHaveBeenCalled();
  });

  it("stops a streamed download that grows beyond the limit without Content-Length", async () => {
    let chunksSent = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new Uint8Array(1024 * 1024));
        chunksSent += 1;
        if (chunksSent === 16) controller.close();
      }
    });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ url: "https://media.example.com/file", mime_type: "application/pdf" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(body, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const client = new WhatsAppClient({ accessToken: "test-token", phoneNumberId: "phone-id", graphApiVersion: "v26.0" });
    await expect(client.downloadMedia("media-id")).rejects.toThrow("exceeds the 15 MB limit");
    expect(chunksSent).toBe(16);
  });
});
