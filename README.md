# OBE Architects Bot

FastAPI backend for the chat widget, with Redis-backed session state and Postgres lead storage.
Lead email notifications use a Postgres outbox + worker with SendGrid API delivery.

## Local Development (Windows)

### 1) Create and activate virtual environment

PowerShell:

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
```

cmd:

```cmd
python -m venv .venv
.\.venv\Scripts\activate.bat
```

### 2) Install dependencies

```powershell
pip install -r requirements-dev.txt
```

`psycopg[binary]` is already pinned in `requirements.txt`, which is the recommended setup for Windows local development.

### 3) Configure environment

PowerShell:

```powershell
Copy-Item .env.example .env
```

cmd:

```cmd
copy .env.example .env
```

For local Docker runs, update `.env` to:

```env
REDIS_URL=redis://localhost:6379/0
POSTGRES_DSN=postgresql://obe_user:obe_pass@localhost:5432/obe_bot
SENDGRID_API_KEY=YOUR_REAL_KEY
EMAIL_FROM=jojgame10@gmail.com
LEADS_NOTIFY_TO=jojgame10@gmail.com
```

### 4) Start Postgres and Redis in Docker

Start both services:

```powershell
docker compose up -d db redis
```

Check status:

```powershell
docker compose ps
```

### 5) Run the API

Recommended (avoids some Windows `--reload` multiprocessing edge cases):

```powershell
python -m uvicorn app.main:app --host 0.0.0.0 --port 8000
```

Or run:

```cmd
scripts\run_api.bat
```

If you want auto-reload, use:

```powershell
python -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

Run worker in a second terminal:

```powershell
python -m app.worker.email_worker
```

### 6) Run tests

Unit tests only (no Docker required):

```powershell
pytest -m "not integration" -q
```

or:

```cmd
scripts\run_tests.bat
```

Integration tests (requires `POSTGRES_DSN` and running Postgres):

```powershell
pytest -m integration -q
```

or:

```cmd
scripts\run_tests_integration.bat
```

### 7) SendGrid sender verification (required)

In SendGrid, verify `jojgame10@gmail.com` as a Single Sender:

1. `Settings -> Sender Authentication -> Single Sender Verification`
2. Complete verification for `jojgame10@gmail.com`

Without this, SendGrid will reject sends from `EMAIL_FROM=jojgame10@gmail.com`.

### 8) Quick API verification

Health check:

```powershell
curl.exe http://127.0.0.1:8000/health
```

Chat message:

```powershell
curl.exe -X POST http://127.0.0.1:8000/chat/message `
  -H "Content-Type: application/json" `
  -d "{\"channel\":\"web\",\"user_id\":\"demo-user\",\"session_id\":null,\"text\":null,\"button_id\":null}"
```

Admin leads:

```powershell
curl.exe -H "X-API-Key: change_me_to_a_long_random_string" http://127.0.0.1:8000/admin/leads
```

WhatsApp webhook verify:

```powershell
curl.exe -i "http://127.0.0.1:8000/webhook/whatsapp?hub.verify_token=verify_me&hub.challenge=abc123"
```

## Notes

- `/admin/leads` expects the `X-API-Key` header.
- `/admin/leads` validates `limit` in range `1..500`.
- `/admin/analytics/clicks-by-department` expects the `X-API-Key` header.
- Lead notifications are enqueued in `email_outbox` and sent asynchronously by the worker.
- `/chat/message` now returns `503` when Redis is unavailable (graceful degradation instead of crash).
- `pytest` integration tests are marked with `@pytest.mark.integration` and are skipped automatically when `POSTGRES_DSN` is not set.
- Unhandled API exceptions now log full stack traces to the server console.

## Quickstart (Local)

1. Copy `.env.example` to `.env` and set local values.
2. Start services:

```powershell
docker compose up -d --build
docker compose ps
```

3. Verify:

```powershell
curl.exe -i http://127.0.0.1:8080/health
curl.exe -I http://127.0.0.1:8080/widget.js
```

## Production Deployment (Server)

See `deploy/deploy.md` for step-by-step Ubuntu instructions.

## Webhook Notes

- WhatsApp callback URL: `https://<your-domain>/webhook/whatsapp`
- Nginx proxies `/webhook/*` to the app (no port changes).

## WhatsApp Cloud API

Webhook callback URL:

- `https://chatbot.yourcompany.com/webhook/whatsapp`

Required env vars:

- `WHATSAPP_VERIFY_TOKEN`
- `WHATSAPP_ACCESS_TOKEN`
- `WHATSAPP_PHONE_NUMBER_ID`
- `WHATSAPP_GRAPH_VERSION` (default `v20.0`)
- `WHATSAPP_APP_SECRET` (optional, enables signature verification)
- `HANDOFF_NOTIFY_TO` (optional; falls back to `LEADS_NOTIFY_TO`)

Manual test checklist:

- Send greeting to WhatsApp number -> main menu buttons appear.
- Tap `View Projects` -> list categories appears.
- Tap `Talk to Human` -> acknowledgement + bot silence.
- Admin toggle `/admin/conversations/{id}/handoff` works.

## Docker Compose Stack (Nginx + API + Redis + Postgres + Worker)

### What is exposed

- Widget assets: `GET /widget.js`, `GET /widget.css`
- API (proxied): `POST /api/chat/message`, `POST /api/consultation/request`, `POST /api/analytics/event`, `GET /api/admin/analytics/clicks-by-department`
- Health endpoint (proxied): `GET /health`
- Webhooks (proxied): `GET/POST /webhook/whatsapp`, `GET/POST /webhook/instagram`
- Worker process: `python -m app.worker.email_worker` (compose service: `worker`)

### Local run (full stack)

```powershell
docker compose up -d --build
docker compose ps
```

### Verification through nginx (expected outputs)

Health:

```powershell
curl.exe -i http://chatbot.local/health
```

Expected: `HTTP/1.1 200 OK` and JSON body similar to `{"ok":true,"env":"dev"}`.

Widget JS served by nginx:

```powershell
curl.exe -I http://chatbot.local/widget.js
```

Expected: `HTTP/1.1 200 OK` and `Cache-Control: public, max-age=3600`.

Chat endpoint via nginx proxy:

```powershell
curl.exe -X POST http://chatbot.local/api/chat/message `
  -H "Content-Type: application/json" `
  -d "{\"channel\":\"web\",\"user_id\":\"demo-user\",\"session_id\":null,\"text\":null,\"button_id\":null}"
```

Expected: `200 OK` with JSON containing `session_id`, `messages`, and `buttons`.

### Analytics event + aggregated admin analytics (via nginx proxy)

Set your base URL once:

```powershell
$API_BASE = "https://chatbot.yourcompany.com"
```

Record a click event:

```powershell
curl.exe -X POST "$API_BASE/api/analytics/event" `
  -H "Content-Type: application/json" `
  -d "{\"event_name\":\"project_category_click\",\"department\":\"Residential\",\"category\":\"Villas\",\"url\":\"https://obearchitects.com/obe/projectlists.php?category=villas\",\"session_id\":\"s_demo\",\"user_id\":\"web_user\",\"source\":\"chatbot\"}"
```

Get aggregated click counts by department:

```powershell
curl.exe -H "X-API-Key: change_me_to_a_long_random_string" "$API_BASE/api/admin/analytics/clicks-by-department"
```

Get aggregated click counts by department with a UTC date range:

```powershell
curl.exe -H "X-API-Key: change_me_to_a_long_random_string" "$API_BASE/api/admin/analytics/clicks-by-department?start=2026-02-01T00:00:00Z&end=2026-02-23T23:59:59Z"
```

## Cross-Origin Test Harness (Fake Client Website)

File: `test-client/test-client.html`

### 1) Add hostnames on your machine

On Linux/macOS (`/etc/hosts`) add:

```txt
127.0.0.1 chatbot.local
127.0.0.1 client.local
```

On Windows (`C:\Windows\System32\drivers\etc\hosts`) add the same entries.

### 2) Start chatbot stack

```powershell
docker compose up -d --build
```

### 3) Serve the fake client site on `client.local:5500`

```powershell
cd test-client
python -m http.server 5500
```

### 4) Open the client site

Open `http://client.local:5500/test-client.html`.

Expected behavior:

- Browser loads widget script from `http://chatbot.local/widget.js`.
- Widget appears on the client page and opens successfully.
- Chat requests are sent to `http://chatbot.local/api/chat/message`.
- CORS succeeds only for configured allowed origins.

## Latest Stability Updates (2026-02-24)

- Removed committed production secret placeholder risk by enforcing `SENDGRID_API_KEY` as non-real placeholder in tracked env examples.
- Added Redis socket connect/read timeouts for session store and rate limiter clients.
- Added graceful Redis outage handling for chat requests (`503 Service temporarily unavailable`).
- Replaced request logging `print` with middleware logger output.
- Hardened webhook verify handlers to return `challenge` safely without integer coercion.
- Fixed bot welcome text encoding artifacts.

## Production Deployment (Linux Server)

Artifacts:

- `docker-compose.prod.yml`
- `.env.production.example` (committed template values only)
- `.env.production` (server-local real values, not for git)
- `deploy.sh`
- Optional systemd unit: `deploy/obe-chatbot.service`

### One-time server setup

1. Clone repo to a stable path, for example `/opt/obe-architects-bot`.
2. Copy `.env.production.example` to `.env.production`, then set real secrets and strong passwords.
3. Ensure DNS points `chatbot.yourcompany.com` to the server.
4. Configure TLS at your edge/reverse-proxy (or terminate TLS before this stack).

### Deploy/update

```bash
chmod +x deploy.sh
./deploy.sh
```

### Optional auto-start on reboot (systemd)

```bash
sudo cp deploy/obe-chatbot.service /etc/systemd/system/obe-chatbot.service
sudo systemctl daemon-reload
sudo systemctl enable --now obe-chatbot.service
sudo systemctl status obe-chatbot.service
```

## Client Embed Snippet (Paste before `</body>` in `footer.php`)

```html
<script>
  window.OBE_CHATBOT_CONFIG = {
    apiBase: "https://chatbot.yourcompany.com"
  };
</script>
<script src="https://chatbot.yourcompany.com/widget.js" defer></script>
```
