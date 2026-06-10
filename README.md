# Innovation Project Assistant — LINE Bot

A LINE Bot that helps users manage innovation projects, analyze novelty against existing solutions (Google/Serper, Semantic Scholar, GitHub), and track progress — all inside LINE chat. LLM calls go through [OpenRouter](https://openrouter.ai) (model configurable via `OPENROUTER_MODEL`).

## Commands

| Command | Description |
|---|---|
| `/new` | Multi-turn wizard to create a project (name → problem → target user → solution → tech stack → competition → deadline) |
| `/switch` | Pick the active project from a Flex Message button list |
| `/analyze` | Search existing solutions (Serper ×3, Semantic Scholar, GitHub in parallel) and run a 6-dimension Gemini analysis in Thai |
| `/update [text]` | Log a milestone + get a one-line LLM tip |
| `/status` | Show phase, milestones, deadline countdown, last analysis date |
| `/help` | List commands |
| anything else | Q&A with active-project context (last 10 messages of history kept per user) |

## Database setup (PostgreSQL)

Option A — Postgres installed on the machine:

```bash
./scripts/setup-db.sh          # creates botuser + innovation_bot DB
# customize: DB_USER=me DB_PASS=secret DB_NAME=mydb ./scripts/setup-db.sh
```

Option B — Docker:

```bash
docker compose up -d db        # postgres:16 on localhost:5432
```

Both match the default `DATABASE_URL` in `.env.example`
(`postgresql://botuser:botpass@localhost:5432/innovation_bot`).
Then create the tables:

```bash
npx prisma migrate dev --name init
```

## Local development

```bash
cp .env.example .env   # fill in keys
npm install
npx prisma migrate dev --name init
npm run dev            # tsx watch src/index.ts
```

Expose the webhook with a tunnel (e.g. `ngrok http 3000`) and set
`https://<tunnel>/webhook` in the LINE Developers Console.

## Environment variables

See [.env.example](.env.example) — LINE channel secret/token, `DATABASE_URL`
(PostgreSQL), `OPENROUTER_API_KEY` + `OPENROUTER_MODEL` (any OpenRouter model id,
default `google/gemini-2.5-flash`), `SERPER_API_KEY`, `PORT`.

## Deployment (VPS, Ubuntu 24)

```bash
# 1. Install dependencies
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo bash -
sudo apt install -y nodejs postgresql nginx certbot python3-certbot-nginx

# 2. Setup PostgreSQL (or run ./scripts/setup-db.sh after cloning)
sudo -u postgres createdb innovation_bot
sudo -u postgres createuser botuser --pwprompt

# 3. Clone and build
git clone <repo> innovation-bot && cd innovation-bot
npm install
cp .env.example .env && nano .env
npx prisma migrate deploy
npm run build

# 4. Start with PM2
sudo npm install -g pm2
pm2 start dist/index.js --name innovation-bot
pm2 save && pm2 startup

# 5. Nginx + HTTPS (LINE requires HTTPS)
sudo certbot --nginx -d yourdomain.com
# proxy: location /webhook { proxy_pass http://localhost:3000; }

# 6. Set webhook URL in LINE Developers Console:
#    https://yourdomain.com/webhook
```

## Architecture notes

- **Webhook latency**: `/analyze` replies immediately ("🔍 กำลังค้นหา…") and pushes
  the full result later via the Push API, so the LINE webhook never times out.
- **Signature verification**: the Fastify content-type parser keeps the raw body
  so `validateSignature` from `@line/bot-sdk` can verify `x-line-signature`.
- **Session state**: multi-turn flows (the `/new` wizard) and Q&A history live in
  the `Session.history` JSON column; history resets on project switch/create.
- **Search resilience**: each search service catches its own errors and returns
  `[]`, so one failing API never kills an analysis.
- **Analysis cache**: results are stored in `Project.lastAnalysis` /
  `lastAnalyzedAt` and surfaced by `/status` and Q&A context.
# Nova
