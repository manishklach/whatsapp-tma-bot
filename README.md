# WhatsApp TM-A Intake Bot

[![CI](https://github.com/manishklach/whatsapp-tma-bot/actions/workflows/ci.yml/badge.svg)](https://github.com/manishklach/whatsapp-tma-bot/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/manishklach/whatsapp-tma-bot)](https://github.com/manishklach/whatsapp-tma-bot/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-20%2B-339933?logo=node.js&logoColor=white)](package.json)

A production-oriented TypeScript service that conducts a guided Form TM-A trademark intake over WhatsApp, collects supporting media, presents a final review, generates a draft PDF, and returns the document to the user through the WhatsApp Cloud API.

The questionnaire is based on the fields represented in an Indian Trade Marks Form TM-A under the Trade Marks Act, 1999. Questions are declared in code and can be changed or localized without rewriting the conversation engine.

> **Important:** This project generates a draft intake summary. It does not file a trademark application, replace the official form, or provide legal advice. A qualified professional should review all information before submission to the Trade Marks Registry.

## Table of contents

- [What the bot does](#what-the-bot-does)
- [Features](#features)
- [Architecture](#architecture)
- [Conversation flow](#conversation-flow)
- [Information collected](#information-collected)
- [Prerequisites](#prerequisites)
- [Quick start with Docker](#quick-start-with-docker)
- [Run without Docker](#run-without-docker)
- [Configure Meta WhatsApp](#configure-meta-whatsapp)
- [Environment variables](#environment-variables)
- [External PDF API contract](#external-pdf-api-contract)
- [HTTP endpoints](#http-endpoints)
- [Project structure](#project-structure)
- [Development and testing](#development-and-testing)
- [Security and privacy](#security-and-privacy)
- [Production readiness](#production-readiness)
- [Troubleshooting](#troubleshooting)
- [Customization](#customization)
- [Documentation](#documentation)
- [Contributing and license](#contributing-and-license)

## What the bot does

1. Receives an inbound WhatsApp message through a signed Meta webhook.
2. Displays a privacy notice and asks the user to reply `START`.
3. Asks one TM-A question at a time and validates each answer.
4. Conditionally asks for agent, prior-use, enterprise, trademark-image, and authorization details.
5. Downloads images and documents from WhatsApp when the user uploads them.
6. Shows a human-readable summary and lets the user confirm or edit the answers.
7. Calls a configured PDF-generation API or uses the included PDFKit renderer.
8. Uploads the resulting PDF to WhatsApp and sends it to the user as a document.

## Features

- Meta webhook subscription verification
- Constant-time HMAC-SHA256 validation of `X-Hub-Signature-256`
- Immediate webhook acknowledgement followed by asynchronous message handling
- Declarative questionnaire with conditional branches
- Numbered choices and normalized free-text answers
- Email, phone, date, answer-length, message-type, and upload-size validation
- User commands: `BACK`, `SUMMARY`, `RESTART`, `CANCEL`, `EDIT`, and `CONFIRM`
- Redis-backed session persistence with configurable expiration
- WhatsApp message-ID deduplication to handle webhook retries safely
- WhatsApp image/document download and generated-PDF upload
- Configurable external PDF API with bearer-token support and timeouts
- Working built-in A4 PDF generator with page numbers and draft disclaimer
- Retry-safe PDF generation: failed jobs return to the review state
- Dependency-injected stores, messaging clients, and PDF providers for testing
- Dockerfile, Docker Compose, strict TypeScript, Vitest, and GitHub Actions CI
- No source-document personal data or credentials committed to the repository

## Architecture

```text
┌──────────┐       messages/uploads       ┌────────────────────────┐
│ End user │ ───────────────────────────> │ Meta WhatsApp Cloud API│
└──────────┘                              └───────────┬────────────┘
      ^                                                │ signed webhook
      │ generated PDF                                  v
      │                                     ┌──────────────────────┐
      └─────────────────────────────────────│ Express webhook      │
                                            │ verification + HMAC  │
                                            └──────────┬───────────┘
                                                       v
                                            ┌──────────────────────┐
                                            │ Conversation engine  │
                                            └───────┬────────┬─────┘
                                                    │        │
                                      sessions/idempotency   │ PDF request
                                                    v        v
                                               ┌────────┐ ┌────────────────┐
                                               │ Redis  │ │ Local or API   │
                                               └────────┘ │ PDF provider   │
                                                          └────────────────┘
```

The main abstractions are:

- `SessionStore`: session persistence and inbound-message claims.
- `MessagingClient`: text delivery, media download, and PDF delivery.
- `PdfProvider`: creation of a PDF from normalized answers and uploaded files.
- `ConversationService`: channel-independent state machine and command handling.

See [docs/DESIGN.md](docs/DESIGN.md) for the full component design, data model, reliability tradeoffs, API contract, scaling path, and threat considerations.

## Conversation flow

```text
new user
   │
   v
consent ── START ──> collecting questions
                          │
                          ├── BACK / SUMMARY
                          ├── CANCEL ──> cancelled
                          └── last answer
                                  │
                                  v
                               reviewing
                              /         \
                         EDIT             CONFIRM
                          │                  │
                          v                  v
                     collecting         generating
                                             │
                                      success│failure
                                             │
                                      completed/reviewing
```

Commands are case-insensitive:

| Command | Available state | Behavior |
| --- | --- | --- |
| `START` | New/consent | Accepts the notice and begins intake. |
| `BACK` | Collecting | Returns to the previous applicable question. |
| `SUMMARY` | Collecting/reviewing | Shows answers collected so far. |
| `EDIT` | Reviewing | Replays applicable questions while retaining current answers. |
| `CONFIRM` | Reviewing | Generates and sends the PDF. |
| `CANCEL` | Collecting/reviewing | Cancels the current intake. |
| `RESTART` | Any | Creates a fresh intake session. |

## Information collected

The default questionnaire covers:

- application filing category;
- applicant name, address, country, jurisdiction, service address, mobile, and email;
- applicant nature and legal status;
- optional agent name, address, role, registration number, and POA;
- mark category, wording, description, image, and language;
- limitations or conditions on use;
- Nice Classification class and goods/services description;
- proposed-use or prior-use statement and first-use date;
- other important statements;
- verification name and date; and
- Startup/Small Enterprise supporting documentation when applicable.

## Prerequisites

- Node.js 20 or newer, or Docker with Docker Compose
- Redis 7 or a compatible managed Redis service
- A Meta developer app with the WhatsApp product enabled
- A WhatsApp Business phone-number ID
- A suitable WhatsApp Cloud API access token
- A public HTTPS URL for the webhook

## Quick start with Docker

```bash
git clone https://github.com/manishklach/whatsapp-tma-bot.git
cd whatsapp-tma-bot
cp .env.example .env
```

Edit `.env`, then run:

```bash
docker compose up --build
```

Confirm the service is healthy:

```bash
curl http://localhost:3000/health
```

Expected response:

```json
{"status":"ok"}
```

Docker Compose starts the application and a Redis 7 instance with append-only persistence. The application is exposed on port `3000` by default.

## Run without Docker

Start Redis locally or configure a managed instance, then:

```bash
npm ci
cp .env.example .env
npm run dev
```

For a production-style local run:

```bash
npm run build
npm start
```

## Configure Meta WhatsApp

1. Create or open a Meta developer app and add the WhatsApp product.
2. Obtain the app secret, access token, and WhatsApp phone-number ID.
3. Deploy or expose this service through a public HTTPS URL.
4. In the WhatsApp webhook configuration, set the callback URL to:

   ```text
   https://YOUR_HOST/webhooks/whatsapp
   ```

5. Enter the exact value configured as `WHATSAPP_VERIFY_TOKEN`.
6. Subscribe the WhatsApp Business Account to the `messages` webhook field.
7. Send a test message to the configured WhatsApp number.

The Graph API version is configurable so deployments can upgrade without source changes. See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) for operational setup and the production checklist.

## Environment variables

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `PORT` | No | `3000` | HTTP listening port. |
| `NODE_ENV` | No | `development` | Runtime mode: `development`, `test`, or `production`. |
| `WHATSAPP_VERIFY_TOKEN` | Yes | - | Secret value used during Meta webhook verification. |
| `WHATSAPP_APP_SECRET` | Yes | - | Meta app secret used for webhook HMAC verification. |
| `WHATSAPP_ACCESS_TOKEN` | Yes | - | Token used for Graph API messaging and media operations. |
| `WHATSAPP_PHONE_NUMBER_ID` | Yes | - | Sender phone-number ID in the WhatsApp Cloud API. |
| `WHATSAPP_GRAPH_API_VERSION` | No | `v26.0` | Version prefix used for Graph API requests. |
| `REDIS_URL` | No | `redis://localhost:6379` | Redis connection URL. |
| `SESSION_TTL_SECONDS` | No | `604800` | Session retention period; default is seven days. |
| `PDF_API_URL` | No | empty | External PDF endpoint. Empty selects the local renderer. |
| `PDF_API_TOKEN` | No | empty | Optional bearer token for the external PDF endpoint. |
| `PDF_API_TIMEOUT_MS` | No | `30000` | PDF request and download timeout. |

Never commit `.env`. The repository includes only `.env.example` placeholders.

## External PDF API contract

When `PDF_API_URL` is configured, the bot sends an HTTP `POST` using `multipart/form-data`.

### Request

- `payload`: JSON string containing all scalar and boolean answers.
- `markImage`: uploaded image part when supplied.
- `enterpriseDocument`: uploaded enterprise proof when supplied.
- `poaDocument`: uploaded authorization document when supplied.
- `Authorization: Bearer <PDF_API_TOKEN>` when a token is configured.

Conceptual payload:

```json
{
  "applicationFiledAs": "Small Enterprise",
  "applicantName": "Example Applicant",
  "hasAgent": true,
  "markCategory": "DEVICE",
  "tradeMark": "EXAMPLE",
  "classNumber": "35",
  "useStatement": "Proposed to be used"
}
```

### Supported responses

Return PDF bytes directly:

```http
HTTP/1.1 200 OK
Content-Type: application/pdf
```

Or return a download URL:

```json
{
  "downloadUrl": "https://files.example.com/generated/document.pdf"
}
```

An API error or timeout returns the session to `reviewing`; the user can reply `CONFIRM` to retry without re-entering answers.

## HTTP endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/health` | Liveness response without sensitive data. |
| `GET` | `/webhooks/whatsapp` | Meta webhook challenge verification. |
| `POST` | `/webhooks/whatsapp` | Signed inbound WhatsApp events. |

The webhook body is limited to 2 MB. User-uploaded media is downloaded separately through the Graph API and limited to 15 MB per item.

## Project structure

```text
.
├── .github/workflows/ci.yml   # Typecheck, tests, and build
├── docs/
│   ├── DESIGN.md              # Architecture and engineering decisions
│   └── DEPLOYMENT.md          # Meta and production deployment guide
├── src/
│   ├── app.ts                 # Express routes and HMAC verification
│   ├── config.ts              # Zod environment validation
│   ├── conversation.ts        # Intake state machine
│   ├── index.ts               # Dependency wiring and process lifecycle
│   ├── pdf.ts                 # Local and external PDF providers
│   ├── questions.ts           # TM-A questions and validation
│   ├── store.ts               # Redis and in-memory stores
│   ├── types.ts               # Shared interfaces and data types
│   └── whatsapp.ts            # Graph API client and webhook parser
├── tests/
│   ├── conversation.test.ts
│   └── webhook.test.ts
├── docker-compose.yml
├── Dockerfile
└── package.json
```

## Development and testing

Install exact locked dependencies:

```bash
npm ci
```

Available scripts:

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the service with TypeScript watch mode. |
| `npm run typecheck` | Run strict TypeScript checking without output. |
| `npm test` | Run the Vitest suite once. |
| `npm run test:watch` | Run tests interactively in watch mode. |
| `npm run build` | Compile production JavaScript into `dist/`. |
| `npm start` | Run the compiled service. |

The automated suite covers webhook verification and signatures, new-session behavior, message deduplication, choice validation, binary session serialization, and readable PDF creation. Every push and pull request runs installation, type checking, tests, and the production build in GitHub Actions.

## Security and privacy

This application processes phone numbers, contact information, trademark material, and potentially sensitive identity/business documents. Before production use:

- provide a clear privacy notice and lawful basis for processing;
- use a session TTL appropriate for your jurisdiction and business process;
- enable Redis TLS, authentication, encryption at rest, and restricted network access;
- store secrets in a managed secret store and rotate Meta tokens;
- limit application and operator access using least privilege;
- scan uploaded documents for malware;
- use encrypted object storage instead of Redis for larger/longer-lived media;
- redact personal data and tokens from structured logs;
- restrict external PDF download URLs to trusted destinations;
- document deletion, backup, incident-response, and data-subject-request procedures; and
- obtain professional legal and security review before handling production filings.

Implemented controls include webhook HMAC verification, constant-time signature comparison, request-size limits, message deduplication, upload-size limits, environment-only secrets, non-root container execution, generic user-facing errors, and text-only PDF rendering of user input.

## Production readiness

The repository is a complete working reference implementation. Higher-volume or strict-delivery deployments should additionally:

- place a durable queue between webhook acknowledgement and message processing;
- run message workers separately from HTTP replicas;
- add exponential backoff and jitter for Graph/API `429` and `5xx` responses;
- add distributed tracing, structured redacted logs, metrics, and alerts;
- add rate limits per sender and business number;
- use encrypted object storage with short-lived references for uploads;
- validate the external PDF service against an outbound-domain allowlist;
- add dead-letter handling and operator replay tools; and
- run end-to-end tests using Meta test numbers before each production release.

## Troubleshooting

### Meta cannot verify the webhook

- Confirm the callback is public HTTPS and ends in `/webhooks/whatsapp`.
- Confirm `WHATSAPP_VERIFY_TOKEN` exactly matches the value entered in Meta.
- Check that the service is running and `/health` returns `200`.

### Webhook requests return `401`

- Confirm `WHATSAPP_APP_SECRET` belongs to the same Meta app sending events.
- Ensure a proxy is not modifying the raw JSON body.
- Do not replace the raw-body middleware on the webhook route with parsed JSON middleware.

### Messages arrive but replies do not

- Confirm the access token is valid and has the required WhatsApp permissions.
- Confirm `WHATSAPP_PHONE_NUMBER_ID` is the sender number, not the displayed phone number.
- Inspect service logs for Graph API status codes and error bodies.

### Sessions disappear

- Check Redis connectivity and persistence.
- Increase `SESSION_TTL_SECONDS` if the configured retention policy permits it.
- Verify Redis eviction and memory policies in the hosting environment.

### PDF generation fails

- Leave `PDF_API_URL` empty to verify the built-in renderer first.
- If using an external provider, confirm its multipart field names and response format.
- Check `PDF_API_TIMEOUT_MS`, authentication, response content type, and download URL accessibility.

## Customization

- Change questions, options, validation, and branches in `src/questions.ts`.
- Implement a different `PdfProvider` for another document-generation service.
- Implement a different `SessionStore` for PostgreSQL, DynamoDB, or another database.
- Implement `MessagingClient` to reuse the conversation engine on another channel.
- Add locale-specific prompt dictionaries while retaining stable field IDs.
- Replace the local renderer if an official filing-template integration becomes available.

## Documentation

- [Detailed design](docs/DESIGN.md): architecture, state, PDF contract, data retention, security, reliability, testing, and extension points.
- [Deployment guide](docs/DEPLOYMENT.md): prerequisites, local setup, Meta webhook configuration, provider selection, and production checklist.
- [Changelog](CHANGELOG.md): version history and release details.

## Contributing and license

Issues and pull requests are welcome. Run `npm run typecheck`, `npm test`, and `npm run build` before opening a pull request.

Released under the [MIT License](LICENSE).
