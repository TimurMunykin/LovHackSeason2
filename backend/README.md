# unicalc-backend

Java/Spring Boot AI backend for UniCal. Handles:

- **Browser sessions** — AI-guided Playwright navigation (GPT vision) with human-in-the-loop login
- **Schedule extraction** — extracts schedule data from live university portals (network intercept + DOM parsing)
- **HTML extraction** — LLM-based schedule parsing from raw HTML files

## Stack

- Java 21, Spring Boot 3.x, Gradle
- PostgreSQL (session persistence)
- Playwright (Chromium browser automation, Xvfb headless display)
- OpenAI Chat Completions API (GPT vision for navigation, text for HTML extraction)
- Docker + Xvfb + x11vnc + noVNC

## Quick start

```bash
cp .env.example .env
# Edit .env: set OPENAI_API_KEY
docker compose up --build
```

- Backend API: `http://localhost:3001`
- VNC viewer: `http://localhost:6080/vnc_lite.html`

## API

### Browser sessions

| Method | Path | Body / Notes |
|--------|------|-------------|
| `POST` | `/sessions` | `{"url": "https://university.edu"}` → `{"sessionId": "...", "status": "starting"}` |
| `GET` | `/sessions/{id}` | Returns `{status, url, title, aiLog, result, vncUrl}` — poll this |
| `POST` | `/sessions/{id}/confirm` | Call after completing login in the VNC viewer |
| `DELETE` | `/sessions/{id}` | Stop session and close browser |

### HTML extraction (stateless)

| Method | Path | Body |
|--------|------|------|
| `POST` | `/extract` | `{"html": "<html>..."}` → `{"entries": [...]}` |

## Session flow

1. `POST /sessions` with university URL → receive `sessionId`
2. Open the VNC viewer at the `vncUrl` from `GET /sessions/{id}` — watch the browser
3. AI navigates to the login page (status: `navigating_login`)
4. When status becomes `active`, log in manually in the VNC viewer
5. `POST /sessions/{id}/confirm` → AI finds schedule page and extracts data
6. Poll `GET /sessions/{id}` until status is `success` or `failed`
7. On `success`, read `result.scheduleJson` for the extracted schedule entries

## Session statuses

| Status | Meaning |
|--------|---------|
| `starting` | Browser launching |
| `navigating_login` | AI looking for login page |
| `active` | Login page found, waiting for human |
| `navigating_schedule` | AI looking for schedule page |
| `extracting` | Pulling data from the page |
| `success` | Done — data in `result.scheduleJson` |
| `failed` | Something went wrong — see `result.error` |

## Environment variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `OPENAI_API_KEY` | yes | — | OpenAI API key |
| `DB_PASSWORD` | yes | `changeme` | PostgreSQL password |
| `ALLOWED_ORIGIN` | no | `http://localhost:3000` | CORS allowed origin |
| `OPENAI_MODEL_NAVIGATOR` | no | `gpt-4o-mini` | Model for AI navigation |
| `OPENAI_MODEL_EXTRACTOR` | no | `gpt-4o-mini` | Model for HTML extraction |
| `VNC_URL` | no | `http://localhost:6080/...` | noVNC URL returned in session status |
| `PORT` | no | `3001` | HTTP port |

## Local development (without Docker)

Requires Java 21, Gradle 8.x, and a running PostgreSQL instance.

```bash
# Generate Gradle wrapper (first time only)
gradle wrapper --gradle-version 8.12

# Run (with env vars set)
export OPENAI_API_KEY=...
export DATABASE_URL=jdbc:postgresql://localhost:5432/unical
./gradlew bootRun
```
