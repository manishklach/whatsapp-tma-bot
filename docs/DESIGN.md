# Detailed design

## Goal and scope

The service turns the fields present in the supplied two-page Form TM-A PDF into a guided WhatsApp conversation. It collects text and media, shows a review step, generates a draft PDF through either an external API or the built-in renderer, uploads that PDF to WhatsApp, and sends it to the applicant.

The source PDF is treated as a field/layout reference. The generated document is explicitly labeled as a draft intake summary; it is not an official filing and the bot does not provide legal advice.

## Component view

```text
End user
   | WhatsApp messages and uploads
   v
Meta WhatsApp Cloud API
   | signed webhook                    | send text / upload PDF / download media
   v                                   ^
Express webhook -> BullMQ queue -> message worker -> conversation engine -> WhatsApp client
                      |                                  |          |
                      v                                  v          v
                    Redis                              Redis     PDF provider
                                                                |       |
                                                         built-in PDF   external multipart API
```

## Conversation model

One Redis record is maintained per WhatsApp phone number. A session has a status (`collecting`, `reviewing`, `generating`, `completed`, or `cancelled`), a cursor into the declarative question list, and a map of normalized answers.

Conditional questions keep the flow concise:

- Agent details and POA are requested only when an agent is present.
- First-use date is requested only for an already-used mark.
- enterprise proof is requested only for Startup or Small Enterprise applications.
- mark image and optional statements can be skipped.

The user may send `BACK`, `SUMMARY`, `RESTART`, or `CANCEL` while collecting. The final review accepts `CONFIRM` or `EDIT`. Choice input accepts either a displayed number or the option text. Email, phone, date, file type, length, and upload size are validated.

## Webhook and delivery flow

1. Meta verifies `GET /webhooks/whatsapp` with the configured verify token.
2. Meta sends a webhook to `POST /webhooks/whatsapp`.
3. The app validates `X-Hub-Signature-256` against the exact raw request bytes and app secret.
4. It durably adds each inbound message to BullMQ and returns HTTP 200 only after Redis confirms the enqueue. Enqueue failure returns HTTP 503 so Meta can retry.
5. A separate worker picks up the job and calls the conversation engine.
6. A renewable Redis `SET NX` lock serializes processing for each phone number. Inside that lock, a Redis message claim moves from `processing` to `done` only after successful handling; BullMQ retries may resume `processing`, while `done` messages are ignored for 24 hours.
7. The engine loads the sender's session and applies the message.
8. Media IDs are resolved and downloaded using the Graph API access token. Media is base64-encoded and retained inside the Redis-backed session for its TTL in this reference implementation; encryption depends on the Redis deployment and storage configuration.
9. On confirmation, the provider produces PDF bytes. The app uploads those bytes to WhatsApp's media endpoint and sends a document message by media ID.

## PDF API contract

When `PDF_API_URL` is set, the app sends `multipart/form-data`:

- `payload`: a JSON string containing all scalar and boolean answers.
- one part per uploaded answer (`markImage`, `enterpriseDocument`, and `poaDocument`) with its original MIME type and filename.
- `Authorization: Bearer <PDF_API_TOKEN>` when a token is configured.

The provider accepts either:

- an `application/pdf` response body; or
- JSON `{ "downloadUrl": "https://..." }`, after which the bot downloads the PDF.

`downloadUrl` is accepted only when it uses HTTPS and its hostname equals or is a subdomain of an entry in `PDF_API_DOWNLOAD_ALLOWLIST`. Redirect following is disabled so an allowed host cannot redirect the bot to an untrusted network target.

The request and download use `PDF_API_TIMEOUT_MS`. Provider failures restore the session to `reviewing`, retain the answers, and let the user retry `CONFIRM`.

## Data model and retention

```text
session:<phone>  JSON Session                     TTL default: 7 days
message:<id>     "1" (idempotency claim)          TTL: 24 hours
```

Redis append-only persistence is enabled in Docker Compose. Phone numbers and uploaded identity/legal documents are sensitive personal data. Before production use, configure an appropriate retention period, encrypted storage/volumes, access controls, backups, deletion procedures, privacy notice, and regional data handling. For larger media or multi-replica deployments, store files in encrypted object storage and keep only short-lived object references in Redis.

## Security decisions

- HMAC-SHA256 signature validation uses constant-time comparison.
- The service rejects unsigned, malformed, or oversized webhook bodies.
- Access tokens and app secrets are environment variables and excluded from Git.
- Uploaded media is size-limited to 15 MB.
- User input is rendered as text by PDFKit, not evaluated as HTML or code.
- The container runs as the unprivileged `node` user.
- The health endpoint contains no secret or customer data.
- Errors sent to users are generic; provider detail remains in service logs.

Production hardening should add a managed secret store, structured redacted logging, metrics/alerts, rate limiting by sender, antivirus scanning for documents, Redis TLS/auth, and strict review of the configured PDF download allowlist. Meta access tokens should be system-user tokens with the minimum permissions and regular rotation.

## Reliability and scaling

Redis makes sessions, phone locks, deduplication, and BullMQ jobs shared across replicas. The webhook acknowledges only after durable enqueue, while separate workers process jobs with exponential retry. BullMQ recovers stalled jobs after worker crashes. Per-phone locks prevent concurrent workers from overwriting one user's session. Production deployments should monitor failed/stalled jobs, keep Redis `maxmemory-policy=noeviction`, and add explicit Graph/API retry classification for `429` and `5xx` responses.

## Testing strategy

- Unit tests cover session start, idempotency, and input validation.
- Webhook tests cover verification, HMAC rejection, and signed payload acceptance.
- Type checking and production build run in CI.
- A production integration suite should use Meta test numbers and a sandbox PDF API; secrets belong in GitHub Actions environments.

## Key extension points

- Edit `src/questions.ts` to change the intake without rewriting the engine.
- Implement `SessionStore` to use another database.
- Implement `PdfProvider` for a different document service.
- Implement `MessagingClient` for another channel or local simulator.
- Add localization by storing prompt dictionaries keyed by locale.
