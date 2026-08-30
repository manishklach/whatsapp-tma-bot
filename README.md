# WhatsApp TM-A Intake Bot

A complete TypeScript service that asks an end user the questions represented in an Indian Trade Marks Form TM-A, collects trademark images and supporting documents, reviews the answers, generates a draft PDF, and sends it back through WhatsApp Cloud API.

> This project produces an intake summary, not an official filing, and is not legal advice. Review all generated content before submission to the Trade Marks Registry.

## Features

- Signed Meta webhook verification and raw-body HMAC validation
- Declarative, conditional TM-A questionnaire
- `BACK`, `SUMMARY`, `RESTART`, `CANCEL`, `EDIT`, and `CONFIRM` commands
- Email, phone, date, choice, file-type, and upload-size validation
- Redis sessions with seven-day expiry and inbound-message idempotency
- WhatsApp media download, PDF upload, and document delivery
- Pluggable external PDF API plus a working built-in PDFKit generator
- Docker Compose, tests, type checking, and GitHub Actions CI

## Quick start

```bash
cp .env.example .env
# Fill in the five WHATSAPP_* values.
docker compose up --build
```

The service listens at `http://localhost:3000`, with:

- `GET /health`
- `GET /webhooks/whatsapp` for Meta verification
- `POST /webhooks/whatsapp` for signed events

Point Meta's callback URL to `https://YOUR_PUBLIC_HOST/webhooks/whatsapp` and subscribe to `messages`. See [deployment instructions](docs/DEPLOYMENT.md) for the complete setup.

## Run without Docker

Start a Redis instance, then:

```bash
npm install
cp .env.example .env
npm run dev
```

## Verify

```bash
npm run typecheck
npm test
npm run build
```

## PDF generation API

With no `PDF_API_URL`, the included renderer returns a polished draft summary. When the variable is set, the bot calls your API with multipart form data: scalar answers are in a `payload` JSON field and uploads are separate file parts. Return PDF bytes with `Content-Type: application/pdf`, or JSON containing a `downloadUrl`.

## Documentation

- [Detailed architecture, state machine, API contract, privacy, security, scaling, and testing](docs/DESIGN.md)
- [Deployment and Meta configuration](docs/DEPLOYMENT.md)

## License

MIT
