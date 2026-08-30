# Changelog

All notable changes to this project are documented here. The project follows semantic versioning.

## [1.0.0] - 2026-08-30

### Added

- End-to-end WhatsApp Cloud API webhook service written in strict TypeScript.
- Meta subscription challenge handling and constant-time HMAC-SHA256 webhook verification.
- Declarative Form TM-A questionnaire covering applicant, agent, mark, class, use, verification, image, and attachment information.
- Conditional agent, prior-use, Startup/Small Enterprise, trademark-image, and POA flows.
- User commands for navigation, review, cancellation, editing, confirmation, and restarting.
- Validation for choices, email addresses, phone numbers, dates, text length, upload types, and media size.
- Redis-backed sessions with configurable retention and message-ID deduplication.
- WhatsApp Graph API support for sending text, downloading inbound media, uploading generated PDFs, and delivering documents.
- Built-in polished A4 PDF renderer with draft disclaimer, sections, page numbers, and image support.
- External multipart PDF API provider with optional bearer authentication, timeouts, direct PDF responses, and download-URL responses.
- Dockerfile, Docker Compose stack, environment schema, health endpoint, and graceful shutdown.
- Unit and webhook tests, strict type checking, production compilation, and GitHub Actions CI.
- Detailed architecture, security, privacy, deployment, customization, troubleshooting, and production-hardening documentation.

### Security

- Secrets are sourced exclusively from environment variables.
- Raw webhook requests are authenticated before parsing or processing.
- Duplicate inbound WhatsApp events are ignored safely.
- Uploads are size-limited and user-visible error messages avoid leaking provider details.
- The production container runs as an unprivileged user.

### Known production considerations

- Post-acknowledgement processing is in-process; strict delivery should use a durable queue and worker tier.
- Binary session data is retained in Redis for the configured TTL; production deployments should use encrypted object storage for large or long-lived media.
- The built-in document is a draft intake summary, not an official trademark filing.

[1.0.0]: https://github.com/manishklach/whatsapp-tma-bot/releases/tag/v1.0.0
