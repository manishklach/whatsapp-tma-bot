import PDFDocument from "pdfkit";
import type { Answer, MediaAnswer, PdfProvider } from "./types.js";

const isMedia = (value: Answer | undefined): value is MediaAnswer => typeof value === "object" && value !== null && "data" in value;
const display = (value: Answer | undefined): string => value === true ? "Yes" : value === false ? "No" : typeof value === "string" ? (value || "Not provided") : isMedia(value) ? (value.filename || `Uploaded ${value.mimeType}`) : "Not provided";

export class LocalPdfProvider implements PdfProvider {
  async generate(answers: Record<string, Answer>): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ size: "A4", bufferPages: true, margins: { top: 46, bottom: 46, left: 46, right: 46 }, info: { Title: `TM-A Intake - ${display(answers.tradeMark)}` } });
      const chunks: Buffer[] = [];
      doc.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);

      const field = (label: string, key: string) => {
        if (doc.y > 740) doc.addPage();
        doc.font("Helvetica-Bold").fontSize(9).fillColor("#334155").text(label.toUpperCase());
        doc.font("Helvetica").fontSize(11).fillColor("#0f172a").text(key === "serviceAddress" && answers[key] === "__SAME__" ? display(answers.applicantAddress) : display(answers[key]), { paragraphGap: 7 });
      };
      const section = (title: string) => {
        if (doc.y > 700) doc.addPage();
        doc.moveDown(0.4).font("Helvetica-Bold").fontSize(14).fillColor("#166534").text(title);
        doc.moveTo(46, doc.y + 3).lineTo(549, doc.y + 3).strokeColor("#86efac").stroke();
        doc.moveDown(0.8);
      };

      doc.font("Helvetica-Bold").fontSize(20).fillColor("#0f172a").text("FORM TM-A INTAKE SUMMARY", { align: "center" });
      doc.font("Helvetica").fontSize(10).fillColor("#475569").text("Trade Marks Act, 1999 - Application data collected via WhatsApp", { align: "center" });
      doc.moveDown(1);
      const noticeY = doc.y;
      doc.roundedRect(46, noticeY, 503, 36, 4).fillAndStroke("#fefce8", "#fde047");
      doc.fillColor("#713f12").fontSize(8).text("DRAFT: This generated summary is not an official filing and should be reviewed by a qualified professional before submission.", 56, noticeY + 10, { width: 483 });
      doc.y = noticeY + 44;

      section("Application");
      field("Application filed as", "applicationFiledAs");
      section("Applicant");
      [["Name", "applicantName"], ["Address", "applicantAddress"], ["Country", "country"], ["Jurisdiction", "jurisdiction"], ["Address for service", "serviceAddress"], ["Mobile", "mobile"], ["Email", "email"], ["Nature of applicant", "applicantNature"], ["Legal status", "legalStatus"]].forEach(([l, k]) => field(l!, k!));
      if (answers.hasAgent === true) {
        section("Applicant's Agent");
        [["Name", "agentName"], ["Address", "agentAddress"], ["Nature of agent", "agentNature"], ["Registration number", "agentRegistrationNo"]].forEach(([l, k]) => field(l!, k!));
      }
      section("Mark Details");
      [["Category", "markCategory"], ["Trademark", "tradeMark"], ["Image description", "markDescription"], ["Language", "markLanguage"], ["Conditions or limitations", "limitations"]].forEach(([l, k]) => field(l!, k!));
      const image = answers.markImage;
      if (isMedia(image) && image.mimeType.startsWith("image/")) {
        if (doc.y > 590) doc.addPage();
        try { doc.image(image.data, { fit: [400, 150], align: "center" }); doc.moveDown(); } catch { field("Trademark image", "markImage"); }
      }
      section("Class of Goods or Services");
      field("Class", "classNumber"); field("Description", "goodsServices");
      section("Use and Verification");
      [["Statement as to use", "useStatement"], ["Used since", "useSinceDate"], ["Other information", "otherStatement"], ["Verified by", "verificationName"], ["Verification date", "verificationDate"]].forEach(([l, k]) => { if (answers[k!] !== undefined) field(l!, k!); });
      section("Attachments");
      field("Enterprise proof", "enterpriseDocument"); field("Authorization (POA)", "poaDocument");
      const pages = doc.bufferedPageRange();
      for (let i = 0; i < pages.count; i++) {
        doc.switchToPage(i);
        doc.font("Helvetica").fontSize(8).fillColor("#64748b").text(`Generated ${new Date().toISOString()}  |  Page ${i + 1} of ${pages.count}`, 46, 760, { width: 503, align: "center", lineBreak: false });
      }
      doc.end();
    });
  }
}

export class ApiPdfProvider implements PdfProvider {
  constructor(private readonly url: string, private readonly token?: string, private readonly timeoutMs = 30000, private readonly downloadAllowlist: string[] = []) {}
  async generate(answers: Record<string, Answer>): Promise<Buffer> {
    const form = new FormData();
    const payload: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(answers)) {
      if (isMedia(value)) form.append(key, new Blob([Uint8Array.from(value.data)], { type: value.mimeType }), value.filename || `${key}.${value.mimeType.split("/")[1] || "bin"}`);
      else payload[key] = value;
    }
    form.append("payload", JSON.stringify(payload));
    const response = await fetch(this.url, { method: "POST", headers: this.token ? { Authorization: `Bearer ${this.token}` } : undefined, body: form, signal: AbortSignal.timeout(this.timeoutMs) });
    if (!response.ok) throw new Error(`PDF API ${response.status}: ${await response.text()}`);
    const contentType = response.headers.get("content-type") || "";
    if (contentType.includes("application/pdf")) return Buffer.from(await response.arrayBuffer());
    const { downloadUrl } = (await response.json()) as { downloadUrl?: string };
    if (!downloadUrl) throw new Error("PDF API must return application/pdf or JSON with downloadUrl");
    const parsedDownloadUrl = new URL(downloadUrl);
    const hostname = parsedDownloadUrl.hostname.toLowerCase().replace(/\.$/, "");
    const allowed = parsedDownloadUrl.protocol === "https:" && this.downloadAllowlist.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`));
    if (!allowed) throw new Error(`PDF download host is not allowed: ${hostname}`);
    const download = await fetch(parsedDownloadUrl, { redirect: "error", signal: AbortSignal.timeout(this.timeoutMs) });
    if (!download.ok) throw new Error(`PDF download failed: ${download.status}`);
    return Buffer.from(await download.arrayBuffer());
  }
}
