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
Express webhook -> conversation engine -> WhatsApp client
                       |          |
                       v          v
                     Redis     PDF provider
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
4. It returns HTTP 200 immediately, then processes each inbound message.
5. Redis `SET NX` claims each WhatsApp message ID for 24 hours so retries do not duplicate answers or PDFs.
6. The engine loads the sender's session and applies the message.
7. Media IDs are resolved and downloaded using the Graph API access token. Media is base64-encoded and retained inside the Redis-backed session for its TTL in this reference implementation; encryption depends on the Redis deployment and storage configuration.
8. On confirmation, the provider produces PDF bytes. The app uploads those bytes to WhatsApp's media endpoint and sends a document message by media ID.

## PDF API contract

When `PDF_API_URL` is set, the app sends `multipart/form-data`:

- `payload`: a JSON string containing all scalar and boolean answers.
- one part per uploaded answer (`markImage`, `enterpriseDocument`, and `poaDocument`) with its original MIME type and filename.
- `Authorization: Bearer <PDF_API_TOKEN>` when a token is configured.

The provider accepts either:

- an `application/pdf` response body; or
- JSON `{ "downloadUrl": "https://..." }`, after which the bot downloads the PDF.

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

Production hardening should add a managed secret store, structured redacted logging, metrics/alerts, rate limiting by sender, antivirus scanning for documents, outbound-domain allowlists for `downloadUrl`, Redis TLS/auth, and an asynchronous durable job queue. Meta access tokens should be system-user tokens with the minimum permissions and regular rotation.

## Reliability and scaling

Redis makes sessions and deduplication shared across replicas. The webhook acknowledges before processing so slow Graph/PDF operations do not trigger immediate Meta retries. The current post-response work is in-process; a process crash between acknowledgement and completion can lose that attempt. For strict delivery, write messages to a durable queue transactionally before acknowledging and run separate workers. Add exponential backoff for Graph/API `429` and `5xx` responses.

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
