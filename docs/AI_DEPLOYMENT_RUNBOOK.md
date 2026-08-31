# AI-assisted end-to-end deployment runbook

This document is written so a person can give it to Gemini, ChatGPT, Codex, Claude, or another capable coding/operations agent and ask that agent to deploy the WhatsApp TM-A Intake Bot from start to finish.

The default path uses one Linux server, Docker Compose, Redis, a reverse proxy, and a public HTTPS domain. A managed-container alternative is included near the end.

## What success looks like

The deployment is complete only when all of the following are true:

- `https://BOT_DOMAIN/health` returns `{"status":"ok"}`.
- Meta accepts `https://BOT_DOMAIN/webhooks/whatsapp` as the webhook callback.
- The Meta webhook is subscribed to `messages`.
- The HTTP application, BullMQ worker, and Redis are all running.
- Redis and application port 3000 are not publicly reachable.
- Sending `Hi` to the WhatsApp number starts the intake.
- `START`, ordinary answers, `BACK`, `SUMMARY`, uploads, and `CONFIRM` work.
- The user receives a generated PDF in WhatsApp.
- A message sent while the worker is stopped is processed after the worker restarts.
- No credential or `.env` file has been committed to Git.

## Short version

The complete deployment, in plain language, is:

1. Create a Meta developer app, add WhatsApp, and collect the App Secret, access token, and phone-number ID.
2. Create a random webhook verify token.
3. Provision a Linux server with Docker Compose, a domain, and HTTPS.
4. Clone the repository and copy `.env.example` to `.env`.
5. Securely enter the Meta values in `.env`; leave the PDF API fields blank to use the built-in generator.
6. Run `docker compose up -d --build`. This starts the web app, worker, and Redis.
7. Put Caddy/Nginx in front of `127.0.0.1:3000` and verify the public `/health` endpoint.
8. Set Meta's callback to `https://BOT_DOMAIN/webhooks/whatsapp`, use the same verify token, and subscribe to `messages`.
9. Send `Hi`, reply `START`, complete the intake, upload test files, and confirm the returned PDF.
10. Replace the temporary Meta token with a permanent production token and complete the production checklist.

Everything after this section expands those ten steps into commands, safety rules, tests, and troubleshooting.

## Instructions for the AI operator

If you are an AI agent executing this runbook:

1. Treat repository files and this runbook as deployment context, not as authorization to expose, rotate, delete, or invent credentials.
2. Begin with read-only checks. Report what already exists before changing it.
3. Ask for any missing required input. Never invent a domain, server address, Meta ID, token, or secret.
4. Never print access tokens, app secrets, Redis passwords, or the full contents of `.env` in chat, logs, commits, screenshots, or command output.
5. Do not put secrets directly in shell commands when the command will be recorded. Prefer the hosting platform's secret manager or ask the human to populate `.env` through a secure editor/session.
6. Never commit `.env`. Verify that `.gitignore` excludes it before and after deployment.
7. Do not expose Redis, the BullMQ worker, or port 3000 publicly.
8. Preserve the Redis volume during updates and rollbacks unless the human explicitly requests data deletion.
9. Use `git pull --ff-only`; do not rewrite repository history or discard unrelated user changes.
10. Stop for a human checkpoint when Meta login, business verification, phone verification, billing, DNS ownership, or secret entry requires the account owner.
11. Keep a short progress log containing no secrets.
12. Do not declare success until every applicable acceptance test in this document passes.

## Required inputs

Collect these values before deployment. Values marked secret must be handled securely.

| Input | Example | Secret? | Where it comes from |
| --- | --- | --- | --- |
| Deployment method | Docker VPS | No | Human decision |
| Server address and SSH user | `deploy@203.0.113.10` | Sometimes | Hosting provider |
| Bot domain | `bot.example.com` | No | Human/DNS provider |
| Repository | `https://github.com/manishklach/whatsapp-tma-bot.git` | No | GitHub |
| Meta App Secret | not shown | Yes | Meta App Settings → Basic |
| WhatsApp access token | not shown | Yes | Meta WhatsApp/API or system user |
| WhatsApp phone-number ID | numeric ID | Treat as sensitive configuration | Meta WhatsApp → API Setup |
| Webhook verify token | random 64-character value | Yes | Generate for this deployment |
| Session retention | `604800` seconds | No | Privacy/operations decision |
| PDF mode | built-in or external | No | Human decision |
| External PDF endpoint/token | only when used | Token is secret | PDF provider |
| Allowed PDF download domains | `files.example.com` | No | PDF provider |

Do not confuse the WhatsApp phone-number ID with the visible telephone number, WhatsApp Business Account ID, Meta App ID, or Business Manager ID.

## Human checkpoints

An AI agent usually cannot complete these without an authenticated browser session or human assistance:

- Create or select the Meta developer app.
- Add the WhatsApp product.
- Accept Meta terms or complete business verification.
- Register and verify a production telephone number.
- Create a permanent system-user access token.
- Read the Meta App Secret.
- Change DNS records for the bot domain.
- Approve hosting charges or firewall changes.

The agent should provide exact navigation guidance, wait for the human to complete the action, and then continue with non-secret confirmation such as “the value has been configured.”

## Architecture that must be deployed

```text
Internet / Meta
      |
      | HTTPS :443
      v
Reverse proxy
      |
      | private HTTP :3000
      v
Web app ─────> BullMQ / Redis <───── Worker
                                      |
                                      +──> WhatsApp Graph API
                                      +──> local or external PDF provider
```

There are three required runtime components:

1. `app`: receives signed Meta webhooks and durably enqueues messages.
2. `worker`: serially processes each user's conversation, downloads uploads, creates PDFs, and sends replies.
3. `redis`: stores BullMQ jobs, per-phone locks, message claims, and sessions.

Running only the web application is not sufficient. Messages will remain queued until a worker is running.

## Phase 1: Meta WhatsApp preparation

Use Meta's current Cloud API setup screens; labels can change over time.

1. Sign in to [Meta for Developers](https://developers.facebook.com/).
2. Create or select an appropriate business app.
3. Add the WhatsApp product.
4. Open WhatsApp → API Setup.
5. Record the WhatsApp phone-number ID securely.
6. For initial testing, obtain the temporary access token shown by Meta.
7. Open App Settings → Basic and record the App Secret securely.
8. Note the Meta test recipient and test number, or register a production number.

For production, create a system user in Meta Business Settings, assign the app and WhatsApp assets, and generate a long-lived/permanent token with only the WhatsApp permissions required by the deployment. Do not use a temporary development token in production.

Generate the webhook verify token locally. For example:

```bash
openssl rand -hex 32
```

Store the output securely. This is a token chosen by the operator; it must later be entered both in `.env` and in Meta's webhook configuration.

Do not configure the callback URL yet unless the public HTTPS deployment is already live.

## Phase 2: Prepare the server

The default instructions assume a current supported Ubuntu or Debian server.

1. Point an `A`/`AAAA` DNS record for `BOT_DOMAIN` to the server.
2. Confirm DNS resolution from an external machine.
3. Install Docker Engine and the Docker Compose plugin using Docker's current official installation instructions.
4. Install a reverse proxy such as Caddy or Nginx.
5. Enable a firewall.

Verify the tools:

```bash
docker --version
docker compose version
git --version
curl --version
```

Firewall policy:

- Allow SSH from trusted sources.
- Allow TCP 80 and 443.
- Deny public TCP 3000.
- Deny public TCP 6379.

Do not enable a firewall until SSH access is explicitly allowed, or the operator may lock themselves out.

The repository's Compose file binds the application to `127.0.0.1:3000`; preserve that loopback binding. Do not change it to `3000:3000` on a public server.

## Phase 3: Fetch and verify the application

Choose a stable server directory, for example `/opt/whatsapp-tma-bot`:

```bash
sudo mkdir -p /opt/whatsapp-tma-bot
sudo chown "$USER":"$USER" /opt/whatsapp-tma-bot
git clone https://github.com/manishklach/whatsapp-tma-bot.git /opt/whatsapp-tma-bot
cd /opt/whatsapp-tma-bot
git switch main
git pull --ff-only
```

Verify the repository before adding secrets:

```bash
git status --short
git log -1 --oneline
test ! -f .env
grep -n '^\.env$' .gitignore
```

The working tree should be clean, `.env` should not exist yet, and `.gitignore` should exclude it.

Optional verification before deployment:

```bash
npm ci
npm run typecheck
npm test
npm run build
```

If Node.js is not installed on the host, rely on the Docker build and GitHub Actions status instead.

## Phase 4: Create production configuration

Create the secret file from the example:

```bash
cp .env.example .env
chmod 600 .env
```

Populate `.env` through a secure editor or secret-injection method. Do not paste the populated file into chat.

```dotenv
PORT=3000
NODE_ENV=production

WHATSAPP_VERIFY_TOKEN=<random token created for this deployment>
WHATSAPP_APP_SECRET=<Meta App Secret>
WHATSAPP_ACCESS_TOKEN=<temporary test token or permanent production token>
WHATSAPP_PHONE_NUMBER_ID=<Meta phone-number ID>
WHATSAPP_GRAPH_API_VERSION=v26.0

REDIS_URL=redis://localhost:6379
SESSION_TTL_SECONDS=604800

PDF_API_URL=
PDF_API_TOKEN=
PDF_API_TIMEOUT_MS=30000
PDF_API_DOWNLOAD_ALLOWLIST=
```

Rules:

- Keep `PDF_API_URL` blank to use the included PDF generator. This is the simplest deployment and requires no extra service.
- The Compose file overrides `REDIS_URL` for app and worker containers with `redis://redis:6379`.
- Before changing `WHATSAPP_GRAPH_API_VERSION`, confirm that the selected version is supported by the current WhatsApp Cloud API.
- Choose `SESSION_TTL_SECONDS` according to the operator's privacy and retention policy.
- If the external PDF API returns PDF bytes directly, `PDF_API_DOWNLOAD_ALLOWLIST` may remain blank.
- If it returns `{ "downloadUrl": "https://..." }`, add only trusted exact/parent domains, comma-separated. HTTPS is mandatory and redirects are rejected.

Verify configuration without exposing values:

```bash
test -s .env
test "$(stat -c '%a' .env)" = "600"
git status --short
```

`git status` must not list `.env`.

## Phase 5: Start the application stack

Build and start all services:

```bash
cd /opt/whatsapp-tma-bot
docker compose pull
docker compose up -d --build
docker compose ps
```

Expected services:

- `app`: running/healthy at the process level
- `worker`: running
- `redis`: running and healthy

Inspect logs without copying secrets or personal data into external systems:

```bash
docker compose logs --tail=100 app worker redis
```

Test locally on the server:

```bash
curl --fail --show-error http://127.0.0.1:3000/health
```

Expected response:

```json
{"status":"ok"}
```

Confirm Redis policy:

```bash
docker compose exec redis redis-cli CONFIG GET maxmemory-policy
```

Expected policy: `noeviction`.

## Phase 6: Configure HTTPS

The application must be reachable by Meta over public HTTPS. Do not expose Redis or the worker.

Example Caddy configuration:

```caddyfile
BOT_DOMAIN {
    reverse_proxy 127.0.0.1:3000
}
```

Replace `BOT_DOMAIN` with the real domain, validate the Caddy configuration, and reload Caddy using the installation's supported commands.

For Nginx or a managed load balancer, proxy HTTPS requests to `127.0.0.1:3000`. Preserve the request body unchanged because webhook HMAC verification uses the exact raw JSON bytes.

Validate externally:

```bash
curl --fail --show-error https://BOT_DOMAIN/health
```

Check that the certificate is trusted, unexpired, and issued for the correct hostname.

From an external machine, confirm that ports 3000 and 6379 are not reachable. Do not rely only on the application server's local firewall test.

## Phase 7: Register the Meta webhook

In the Meta app's WhatsApp webhook configuration:

1. Set the callback URL to:

   ```text
   https://BOT_DOMAIN/webhooks/whatsapp
   ```

2. Enter the exact value stored as `WHATSAPP_VERIFY_TOKEN`.
3. Complete Meta's verification challenge.
4. Subscribe the WhatsApp Business Account to the `messages` field.
5. Confirm the app, App Secret, access token, phone-number ID, and WhatsApp Business Account belong to the same intended setup.

If verification fails:

- Confirm `/health` works publicly over HTTPS.
- Confirm the callback path is exactly `/webhooks/whatsapp`.
- Confirm the verify token matches byte-for-byte.
- Check `docker compose logs app`.
- Confirm the reverse proxy forwards query parameters.

## Phase 8: Test the complete user journey

Use a Meta test recipient or authorized production test number.

1. Send `Hi` to the WhatsApp number.
2. Confirm the bot sends its introduction and privacy notice.
3. Reply `START`.
4. Complete at least the following branches:
   - applicant address followed by `SAME` for service address;
   - `BACK` and `SUMMARY`;
   - an application filed as Startup or Small Enterprise;
   - agent `YES`, including agent details and POA upload;
   - agent `NO` in a separate run;
   - trademark image upload;
   - `CONFIRM` and PDF delivery.
5. Open the returned PDF and verify text, pagination, image, and attachment labels.
6. Reply `RESTART` and confirm a new intake begins.

Observe both processes during the test:

```bash
docker compose logs -f app worker
```

The web process should enqueue messages. The worker should process them and send replies.

## Phase 9: Test queue durability

This test proves that a webhook acknowledgement does not lose the message when the worker is unavailable.

```bash
docker compose stop worker
```

Send a new WhatsApp message, wait briefly, and confirm the app remains running. Then:

```bash
docker compose start worker
docker compose logs -f worker
```

The queued message should be processed after the worker starts. Do not purge Redis between these steps.

## Phase 10: Move from testing to production

Before public use:

1. Replace Meta's temporary token with a permanent/system-user token.
2. Complete required Meta business and phone-number verification.
3. Confirm the Meta app is in the appropriate live mode.
4. Remove development recipients and test-only configuration.
5. Store secrets in the hosting provider's secret manager where possible.
6. Enable Redis authentication, TLS for remote Redis, encryption at rest, and backups.
7. Establish data retention, deletion, privacy-notice, and incident-response procedures.
8. Add malware scanning before retaining or forwarding uploaded documents.
9. Configure alerts for app/worker exits, webhook 5xx responses, Redis availability, queue depth, failed/stalled jobs, Graph API failures, and PDF failures.
10. Review WhatsApp messaging-window and template requirements for any future business-initiated messages.

## Memory and data-retention warning

The current implementation stores uploaded media in Redis as base64 inside the session. Base64 increases the payload size by roughly one third, before Redis/JSON overhead. A 15 MB upload can therefore consume around 20 MB or more of Redis memory.

Before real traffic:

- Estimate concurrent sessions and upload frequency.
- Set an appropriate `SESSION_TTL_SECONDS`.
- Provision sufficient Redis memory with `noeviction`.
- For higher volume, move media to encrypted object storage and store short-lived references in Redis.

Do not reduce the risk by enabling Redis eviction: BullMQ requires queue keys not to be evicted.

## Managed-container alternative

On Railway, Render, Fly.io, AWS ECS, Google Cloud Run plus a worker service, Azure Container Apps, or a similar platform, create:

### Web service

- Source: this repository or its Dockerfile
- Build: Dockerfile, or `npm ci && npm run build`
- Start command: `npm start`
- Public port: `3000`
- Health path: `/health`
- Public HTTPS domain: required

### Worker service

- Same source/image and environment variables
- Start command: `npm run worker`
- No public port
- At least one continuously running instance

### Redis

- Managed Redis compatible with BullMQ
- Private network access where possible
- TLS/authentication when remote
- Persistence/backups
- `maxmemory-policy=noeviction`

Set the same application/Meta/PDF secrets on web and worker. Set the same `REDIS_URL` on both. Configure Meta's callback URL to the web service only.

Serverless platforms that suspend background processes are not suitable for the worker unless they provide a continuously running worker/job-consumer service.

## Routine operations

### View status

```bash
docker compose ps
docker compose logs --tail=100 app worker redis
curl --fail https://BOT_DOMAIN/health
```

### Deploy an update

```bash
cd /opt/whatsapp-tma-bot
git status --short
git pull --ff-only
docker compose build --pull
docker compose up -d
docker compose ps
curl --fail https://BOT_DOMAIN/health
```

Do not run an update when the working tree contains unexplained changes. Preserve `.env` and the Redis volume.

### Restart without deleting data

```bash
docker compose restart app worker
```

### Stop without deleting data

```bash
docker compose stop
```

Do not use `docker compose down -v` in routine operations because `-v` deletes the Redis volume.

## Troubleshooting decision tree

### Public health check fails

1. Test `curl http://127.0.0.1:3000/health` on the server.
2. If local fails, inspect `docker compose ps` and app logs.
3. If local succeeds, inspect DNS, firewall, reverse proxy, and certificate.

### Meta webhook verification fails

1. Confirm public health succeeds.
2. Confirm exact callback path and query forwarding.
3. Confirm the verify token matches.
4. Inspect app logs for the verification request.

### Webhook returns 401

1. Confirm `WHATSAPP_APP_SECRET` belongs to the sending Meta app.
2. Confirm the reverse proxy does not transform the JSON body.
3. Confirm Meta is calling the intended deployment.

### Messages arrive but there is no reply

1. Confirm both app and worker are running.
2. Inspect worker logs.
3. Confirm Redis is reachable from both containers/services.
4. Confirm the access token and phone-number ID.
5. Check Meta Graph API errors and token expiry.

### Messages remain queued

1. Start or restart the worker.
2. Confirm `REDIS_URL` is identical for app and worker.
3. Inspect failed/stalled BullMQ job logs.
4. Confirm Redis uses `noeviction` and has available memory.

### PDF generation fails

1. Leave `PDF_API_URL` blank and retry with the built-in provider.
2. If external, validate authentication, timeout, multipart contract, and response type.
3. For `downloadUrl`, confirm HTTPS and `PDF_API_DOWNLOAD_ALLOWLIST`.

### Upload fails

1. Confirm the upload is 15 MB or smaller.
2. Confirm the message type matches the requested image/document type.
3. Confirm the Meta token can retrieve media.
4. Check worker memory and Redis capacity.

## Final verification report

The AI operator should return a report like this, without secrets:

```text
Deployment target: <provider/server>
Repository commit: <commit SHA>
Public URL: https://<domain>
Health check: PASS/FAIL
HTTPS certificate: PASS/FAIL
App process: PASS/FAIL
Worker process: PASS/FAIL
Redis health/noeviction: PASS/FAIL
Meta webhook verification: PASS/FAIL
messages subscription: PASS/FAIL
Inbound conversation: PASS/FAIL
Upload handling: PASS/FAIL
PDF generation and WhatsApp delivery: PASS/FAIL
Worker-stop queue durability test: PASS/FAIL
Public port 3000 blocked: PASS/FAIL
Public Redis blocked: PASS/FAIL
Secrets absent from Git: PASS/FAIL
Remaining human actions: <list or none>
```

## Ready-to-paste prompt for Gemini or another AI

Copy the prompt below and attach or paste this runbook when asking an AI agent to deploy the project:

```text
Deploy the WhatsApp TM-A Intake Bot end to end by following the attached
AI_DEPLOYMENT_RUNBOOK.md.

Repository: https://github.com/manishklach/whatsapp-tma-bot.git

Use the Docker VPS path unless I explicitly specify a managed platform. Begin
with read-only preflight checks and list the required inputs that are missing.
Do not invent credentials or infrastructure details. Never print, commit, or
paste secrets into command output. Stop for my help when Meta login, DNS,
business/phone verification, secret entry, or payment approval is required.

Deploy the web app, separate BullMQ worker, and Redis. Keep Redis, the worker,
and port 3000 private. Configure HTTPS and the Meta messages webhook. Use the
built-in PDF generator unless I provide an external PDF API. Run every
acceptance test in the runbook, including the worker-stop queue durability
test. Do not declare success early.

At the end, provide the runbook's final verification report without exposing
any secret values. If anything remains blocked, identify the exact human action
needed and preserve all completed work safely.
```

## Authoritative project references

- [Repository README](../README.md)
- [Detailed design](DESIGN.md)
- [Deployment notes](DEPLOYMENT.md)
- [Environment example](../.env.example)
- [Docker Compose stack](../docker-compose.yml)
- [Meta WhatsApp Cloud API documentation](https://developers.facebook.com/docs/whatsapp/cloud-api/)
