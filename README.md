# LovHackSeason2

## VPS deploy

This PoC can be deployed manually on a VPS over SSH with Docker Compose and Caddy running in containers.

### What gets exposed

- `https://APP_DOMAIN` serves the web app
- `https://VNC_DOMAIN` serves noVNC

### Prerequisites

- Docker and `docker compose` installed on the VPS
- DNS `A` records for both domains pointed at the VPS
- Ports `80` and `443` open on the server

### Setup

```bash
cp .env.example .env
chmod +x deploy.sh
```

Required `.env` values:

```dotenv
OPENAI_API_KEY=...
APP_DOMAIN=uni-schedule-sync.xyz
VNC_DOMAIN=vnc.uni-schedule-sync.xyz
```

### Deploy

```bash
./deploy.sh
```

Optional modes:

```bash
NO_CACHE=1 ./deploy.sh
RESET_VOLUMES=1 ./deploy.sh
```

### Logs

```bash
docker compose logs -f caddy
docker compose logs -f web
docker compose logs -f browser
```

### Files

- `deploy.sh` runs the VPS deployment
- `.env.example` shows required environment variables
- `Caddyfile` configures HTTPS and reverse proxying
