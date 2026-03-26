# UniCal — Student Calendar Assistant

Turns messy university schedules into your personal digital calendar.

## Prerequisites

- Docker and `docker compose`
- Google OAuth credentials ([console.cloud.google.com](https://console.cloud.google.com/apis/credentials))

## Quick Start (Development)

```bash
cp .env.example .env
# Fill in GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET
./dev.sh
```

App runs at `http://localhost:3000`.

Add `http://localhost:3000/auth/google/callback` as an authorized redirect URI in Google Cloud Console.

### Run modes

```bash
NO_CACHE=1 ./dev.sh        # rebuild without Docker cache
RESET_VOLUMES=1 ./dev.sh   # reset database
```

## Build & Release

```bash
./build-release.sh
```

Builds the web image and pushes to Docker Hub. Requires `DOCKER_REPO_PREFIX` in `.env`.

## Deploy to VPS

On the server:

```bash
cp .env.example .env
# Fill in all values
./deploy.sh
```

Pulls images from Docker Hub, starts with Caddy for HTTPS. Requires DNS `A` record for `APP_DOMAIN` pointing to the VPS and ports 80/443 open.

Add `https://APP_DOMAIN/auth/google/callback` as an authorized redirect URI in Google Cloud Console.

### Logs

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml logs -f
```

## Architecture

- `web/` — Express server, Google OAuth, Prisma ORM, static frontend
- PostgreSQL — user accounts and sessions
- Caddy — HTTPS reverse proxy (production only)

## Environment Variables

| Variable | Required for | Description |
|----------|-------------|-------------|
| `GOOGLE_CLIENT_ID` | dev, prod | Google OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | dev, prod | Google OAuth client secret |
| `SESSION_SECRET` | dev, prod | Session encryption key (auto-set in dev) |
| `POSTGRES_PASSWORD` | dev, prod | PostgreSQL password (auto-set in dev) |
| `DOCKER_REPO_PREFIX` | build, prod | Docker Hub username/org |
| `APP_DOMAIN` | prod | Domain for HTTPS |
| `IMAGE_TAG` | prod | Docker image tag (default: latest) |
