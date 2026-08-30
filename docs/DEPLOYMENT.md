# Deployment and Meta setup

## 1. Prerequisites

- Node.js 20+ or Docker
- A Meta developer app with the WhatsApp product enabled
- A WhatsApp Business phone number and phone-number ID
- A permanent/system-user access token for production
- A public HTTPS URL for this service

## 2. Configure locally

```bash
cp .env.example .env
# Edit .env with Meta credentials and long random secrets.
docker compose up --build
curl http://localhost:3000/health
```

Expose port 3000 with an HTTPS tunnel only for development. Never commit the tunnel URL or credentials.

## 3. Configure the Meta webhook

In the Meta app's WhatsApp configuration:

1. Set the callback URL to `https://YOUR_HOST/webhooks/whatsapp`.
2. Enter exactly the same value used for `WHATSAPP_VERIFY_TOKEN`.
3. Subscribe the WhatsApp Business Account to the `messages` webhook field.
4. Ensure `WHATSAPP_APP_SECRET`, access token, and phone-number ID belong to the same app/business setup.

## 4. Choose the PDF provider

Leave `PDF_API_URL` blank to use the included PDFKit renderer. To use a document-generation service, configure `PDF_API_URL` and optionally `PDF_API_TOKEN`; its request and response contract is in `DESIGN.md`.

## 5. Production checklist

- Deploy behind HTTPS with proxy request-size and timeout limits.
- Use managed Redis with TLS, authentication, encryption, and backups.
- Store secrets in the platform secret manager.
- Set a retention period matching the privacy notice and legal obligations.
- Add antivirus scanning and encrypted object storage for uploaded documents.
- Add a durable queue before scaling or requiring guaranteed processing.
- Configure alerts for webhook error rate, Graph API failures, PDF failures, Redis availability, and queue age.
- Run an end-to-end test with a Meta test number before connecting a production number.
