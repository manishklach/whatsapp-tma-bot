# WhatsApp TM-A Intake Bot v1.0.0

This is the first stable release of the WhatsApp TM-A Intake Bot: a complete TypeScript service for collecting Indian Form TM-A trademark application details through WhatsApp and returning a generated draft PDF.

## Highlights

- Guided, one-question-at-a-time WhatsApp intake based on the supplied two-page Form TM-A structure.
- Conditional branches keep the conversation relevant: agent and POA details, prior-use date, enterprise proof, and mark media appear only when applicable.
- A review-and-confirm workflow lets the user inspect or edit information before document generation.
- A working local PDFKit renderer means the project runs end to end without purchasing or integrating another document service.
- A configurable external PDF API adapter supports teams that already have a filing-document generator.
- Redis persistence and message-ID claims protect sessions and prevent webhook retries from duplicating work.
- Signed webhook handling, input validation, upload limits, environment-only secrets, and a non-root container provide secure defaults.
- Docker Compose, detailed operator documentation, automated tests, and a green CI pipeline make the project straightforward to evaluate and deploy.

## Conversation capabilities

Users can reply with numbered or named options and use the following commands throughout the intake:

- `BACK` returns to the previous applicable question.
- `SUMMARY` shows information collected so far.
- `EDIT` reopens the questionnaire from the review screen.
- `CONFIRM` starts document generation.
- `CANCEL` closes the current intake.
- `RESTART` creates a fresh session.

The default flow collects application category, applicant contact and legal details, optional agent information, mark details and artwork, Nice class and goods/services, use status, verification, enterprise proof, and authorization documentation.

## PDF generation

The bundled renderer creates a clearly labeled A4 draft intake summary and supports trademark artwork. For external generation, configure `PDF_API_URL`; the adapter sends scalar answers as JSON plus uploaded media as multipart file fields. It accepts either a direct `application/pdf` response or a JSON response containing `downloadUrl`.

If generation fails, the session returns to the review state and the user can retry without entering all answers again.

## Operations and deployment

The release includes a multi-stage Node.js Dockerfile, Docker Compose application and Redis services, health endpoint, Zod-based environment validation, graceful shutdown, Meta webhook setup instructions, external PDF API documentation, and a production checklist.

## Quality verification

- Strict TypeScript type checking passes.
- Eight automated conversation, persistence, PDF, and webhook tests pass.
- The production build passes on Node.js 22.
- GitHub Actions validates every push and pull request.
- The generated PDF was rendered and visually inspected as a clean two-page A4 document with no clipping, overlap, or unintended blank pages.
- Dependency audit reports no known vulnerabilities at release time.

## Security and privacy notes

This service can process personal and legal/business information. Production operators must provide an appropriate privacy notice, choose a lawful retention policy, use TLS and encrypted storage, rotate Meta credentials, restrict operator access, scan documents, redact logs, and establish deletion and incident-response procedures.

The generated document is a draft intake summary. It is not an official filing and does not constitute legal advice.

## Upgrade and compatibility

This is the initial stable release, so there are no migration steps. Runtime requirements are Node.js 20 or later and Redis 7 or a compatible managed Redis service. Meta Graph API versioning is configurable through `WHATSAPP_GRAPH_API_VERSION`.

## Documentation

- [README](https://github.com/manishklach/whatsapp-tma-bot#readme)
- [Detailed design](https://github.com/manishklach/whatsapp-tma-bot/blob/main/docs/DESIGN.md)
- [Deployment guide](https://github.com/manishklach/whatsapp-tma-bot/blob/main/docs/DEPLOYMENT.md)
- [Changelog](https://github.com/manishklach/whatsapp-tma-bot/blob/main/CHANGELOG.md)
