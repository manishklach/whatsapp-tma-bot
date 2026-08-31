# Ready-to-paste Gemini deployment prompt

Use this prompt with Gemini to deploy the WhatsApp TM-A Intake Bot end to end.

## Before using the prompt

Replace these placeholders:

- `<YOUR PLATFORM OR VPS>`: for example, `Ubuntu VPS accessible through SSH` or `Railway`.
- `<YOUR BOT DOMAIN>`: for example, `bot.example.com`.
- `<MY-DOMAIN>`: the same bot domain without `https://`.

Attach the repository or allow Gemini to access GitHub. Do not insert the Meta access token, Meta App Secret, Redis password, or any other secret into the prompt. Gemini should pause and tell the operator how to enter secrets securely.

## Prompt

```text
Deploy the WhatsApp TM-A Intake Bot end to end by following this runbook:

https://github.com/manishklach/whatsapp-tma-bot/blob/main/docs/AI_DEPLOYMENT_RUNBOOK.md

Repository:
https://github.com/manishklach/whatsapp-tma-bot.git

My intended deployment:
- Platform/server: <YOUR PLATFORM OR VPS>
- Domain: <YOUR BOT DOMAIN>
- PDF provider: Use the built-in PDF generator
- Environment: Production

Instructions:

1. Read the complete runbook and repository documentation before making changes.
2. Begin with read-only preflight checks.
3. Give me a checklist of required infrastructure, credentials, and account access that is still missing.
4. Do not invent any IDs, domains, tokens, secrets, server addresses, or account details.
5. Never ask me to paste secrets into chat. Tell me exactly where I should enter them securely using `.env` or the hosting platform's secret manager.
6. Never display, log, commit, or include secret values in commands that may be recorded.
7. Stop and ask for my help whenever Meta login, DNS changes, business verification, phone verification, secret entry, payment approval, or another account-owner action is required.
8. Use the Docker deployment path unless my platform requires separate managed services.
9. Deploy all three required components:
   - HTTP webhook application
   - BullMQ worker
   - Redis with persistence and `maxmemory-policy=noeviction`
10. Keep Redis, the worker, and application port 3000 private. Only HTTPS ports 80/443 should be public.
11. Configure a trusted HTTPS domain and reverse proxy.
12. Configure the Meta WhatsApp `messages` webhook at:
    https://<MY-DOMAIN>/webhooks/whatsapp
13. Use the included PDF generator. Leave `PDF_API_URL`, `PDF_API_TOKEN`, and `PDF_API_DOWNLOAD_ALLOWLIST` empty.
14. Use `git pull --ff-only`. Do not rewrite Git history, delete volumes, or discard existing changes.
15. Run all verification steps:
    - public `/health` check
    - app, worker, and Redis status
    - Redis `noeviction` confirmation
    - Meta webhook verification
    - inbound WhatsApp conversation
    - START, BACK, SUMMARY, EDIT, and CONFIRM
    - trademark image and document uploads
    - PDF generation and WhatsApp delivery
    - worker-stop queue durability test
    - confirmation that ports 3000 and 6379 are not public
    - confirmation that `.env` and credentials are absent from Git
16. Do not declare the deployment complete until every applicable acceptance test passes.
17. If a step fails, diagnose it using logs without exposing secrets, fix it, and repeat the failed verification.
18. At completion, provide the final verification report specified in the runbook, including the deployed commit SHA and any remaining human actions.

Start now by reading the runbook and repository. Then show me:
- your understanding of the architecture;
- the deployment phases;
- the missing inputs you need from me;
- the first human action I must complete.

Do not begin destructive or account-level changes until I approve the preflight summary.
```

## Recommended workflow

1. Paste the prompt into Gemini.
2. Give Gemini access to the repository and runbook.
3. Review and approve its preflight summary.
4. Complete Meta, DNS, payment, and secret-entry checkpoints yourself when requested.
5. Require Gemini to execute every acceptance test.
6. Save the final verification report with the deployment records.

If the deployment uses an external PDF service, change the PDF-provider line and provide the non-secret endpoint/domain information. Enter the PDF token through the platform secret manager, never through the conversation.
