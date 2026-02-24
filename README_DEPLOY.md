# OBE Bot Deployment Runbook

This document is the server-focused deployment guide for the current production architecture.

## 1) Architecture (As Deployed)

- Reverse proxy/static assets: `nginx` (serves `/widget.js`, `/widget.css`, proxies `/api/*`, `/health`, `/webhook/*`)
- API: FastAPI (`uvicorn app.main:app`) in `app` container
- Worker: `python -m app.worker.email_worker` in `worker` container
- Databases:
  - `postgres:16` (`db`)
  - `redis:7` (`redis`)
- Orchestration: `docker-compose.prod.yml`

Entrypoints and config:
- FastAPI app: `app/main.py`
- Nginx config: `docker/nginx.conf`
- Production compose: `docker-compose.prod.yml`
- Widget assets: `web/`
- Deploy helper script: `deploy.sh`
- Optional systemd unit: `deploy/obe-chatbot.service`

## 2) Prerequisites (Server)

Install:
1. Docker Engine
2. Docker Compose plugin (`docker compose`)
3. Git

Optional:
- Domain + TLS termination in front of this stack

## 3) Clone and Prepare

```bash
git clone <YOUR_GITHUB_REPO_URL> /opt/obe-architects-bot
cd /opt/obe-architects-bot
```

Copy production env template:

```bash
cp .env.production.example .env.production
```

Edit `.env.production` and set real values:
- `ADMIN_API_KEY`
- `POSTGRES_DSN` password
- `SENDGRID_API_KEY`
- webhook tokens/secrets (if used)
- WhatsApp Cloud API vars (if used)
- `ALLOWED_ORIGINS` with exact frontend origins

Do not commit `.env.production`.

WhatsApp Cloud API env vars:
- `WHATSAPP_VERIFY_TOKEN`
- `WHATSAPP_ACCESS_TOKEN`
- `WHATSAPP_PHONE_NUMBER_ID`
- `WHATSAPP_GRAPH_VERSION` (default `v20.0`)
- `WHATSAPP_APP_SECRET` (optional)
- `HANDOFF_NOTIFY_TO` (optional; falls back to `LEADS_NOTIFY_TO`)

## 4) Start Production Stack

```bash
./scripts/check_env.sh .env.production
docker compose --env-file .env.production -f docker-compose.prod.yml up -d --build
docker compose --env-file .env.production -f docker-compose.prod.yml ps
```

Expected running services:
- `app`
- `worker`
- `db`
- `redis`
- `nginx`

## 5) Verification Checks

Health:

```bash
curl -i http://127.0.0.1/health
```

Widget asset:

```bash
curl -I http://127.0.0.1/widget.js
```

Chat API via nginx:

```bash
curl -X POST http://127.0.0.1/api/chat/message \
  -H "Content-Type: application/json" \
  --data-raw '{"channel":"web","user_id":"deploy-smoke","session_id":null,"text":null,"button_id":null}'
```

WhatsApp webhook verification (if enabled):

```bash
curl -i "http://127.0.0.1/webhook/whatsapp?hub.verify_token=replace_me&hub.challenge=abc123"
```

## 6) Operations

Tail all logs:

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml logs -f
```

Tail app + worker:

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml logs -f app worker
```

Restart stack:

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml up -d --build
```

Stop stack:

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml down
```

## 7) Update Deployment

```bash
cd /opt/obe-architects-bot
git pull --ff-only
docker compose --env-file .env.production -f docker-compose.prod.yml up -d --build
docker compose --env-file .env.production -f docker-compose.prod.yml ps
```

Or run helper script:

```bash
chmod +x deploy.sh
./deploy.sh
```

## 8) Notes

- Nginx public API prefix is `/api/*`.
- Backend admin endpoints require `X-API-Key` header.
- Keep secrets only in server-side `.env.production` or a secrets manager.
