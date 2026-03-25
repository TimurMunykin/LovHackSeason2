# VPS Deploy PoC Design

## Goal

- Add a simple production deployment flow for the current auth and schedule extraction PoC.
- The deployment must be runnable manually over SSH on a VPS via a single `deploy.sh` script.
- The deployed stack must support HTTPS through Caddy and use a `.env` file for runtime configuration.

## Current State

- Local development is started with `dev.sh`, which checks `OPENAI_API_KEY`, tears down the current Docker Compose stack, and runs `docker compose up --build`.
- The app currently has two services in `docker-compose.yml`: `web` on port `3000` and `browser` with noVNC exposed on port `6080`.
- The `web` service proxies API calls to `browser`, and `browser` requires `OPENAI_API_KEY`.
- There is no production-oriented reverse proxy, HTTPS handling, or `.env.example` yet.

## Requirements

- Keep the deployment lightweight and suitable for a PoC.
- Keep the operational model close to the existing local Docker workflow.
- Allow the user to SSH into the VPS and run a repository script manually.
- Support a real domain such as `uni-schedule-sync.xyz`.
- Run Caddy in Docker rather than installing it directly on the VPS.
- Add `.env`-based configuration, including secrets and deployment-specific hostnames.

## Options Considered

### Option 1: Docker Compose with Caddy in a container

- Add a third `caddy` service to `docker-compose.yml`.
- Expose only `80` and `443` publicly.
- Keep `web` and `browser` on the internal Docker network.
- Route the main app domain to `web` and a separate VNC subdomain to `browser`.
- Protect the VNC route with Caddy basic auth.

**Pros**

- Closest match to the current development workflow.
- Fully reproducible from the repository.
- Minimal VPS setup beyond Docker and Compose.
- Easy to rerun from `deploy.sh`.

**Cons**

- Slightly more Compose and config complexity.

### Option 2: Caddy on the host, app in Docker

- Install and manage Caddy separately on the VPS.
- Keep only application services in Docker.

**Pros**

- Slightly less container wiring.

**Cons**

- More manual server setup.
- Less portable and harder to reproduce.

### Option 3: No Caddy, expose app ports directly

- Publish `3000` and `6080` from Docker and access them directly.

**Pros**

- Fastest setup.

**Cons**

- No proper HTTPS.
- Weak production story even for a PoC.

## Chosen Approach

- Use Docker Compose with Caddy in a container.
- Publish only `80` and `443` through Caddy.
- Route the main domain, for example `uni-schedule-sync.xyz`, to `web:3000`.
- Route a VNC subdomain, for example `vnc.uni-schedule-sync.xyz`, to `browser:6080`.
- Protect the VNC subdomain with HTTP basic auth configured through environment values.
- Keep `browser:3001` internal and reachable only from `web`.

## Architecture

### Services

- `caddy`: handles TLS termination, HTTP to HTTPS redirect, reverse proxying, and VNC basic auth.
- `web`: serves the frontend and proxies API calls to `browser`.
- `browser`: runs Playwright, Xvfb, x11vnc, noVNC, and the session API.

### Networking

- `caddy` is the only service with public port mappings.
- `web` and `browser` stay on the Compose network without direct host exposure.
- `web` continues to reach `browser` through `http://browser:3001`.
- `caddy` proxies to `web:3000` for the app and `browser:6080` for noVNC.

### Domains

- Main app: `APP_DOMAIN`, such as `uni-schedule-sync.xyz`.
- VNC access: `VNC_DOMAIN`, such as `vnc.uni-schedule-sync.xyz`.

### Configuration

- Add `.env.example` with:
  - `OPENAI_API_KEY`
  - `APP_DOMAIN`
  - `VNC_DOMAIN`
  - `VNC_BASIC_AUTH_USER`
  - `VNC_BASIC_AUTH_HASH`
- The real `.env` file will live on the VPS and will not be committed.

## deploy.sh Behavior

- Validate that `.env` exists.
- Load `.env` for Docker Compose.
- Validate required variables.
- Check that Docker and `docker compose` are available.
- Support the same style of restart as `dev.sh`:
  - default: rebuild and restart cleanly
  - `NO_CACHE=1`: rebuild without cache
  - `RESET_VOLUMES=1`: also remove Compose volumes
- Start the stack and print the resulting URLs.
- Print a short reminder that DNS for both domains must already point to the VPS.

## Caddy Behavior

- Automatically provision HTTPS certificates for the configured domains.
- Reverse proxy the main domain to `web:3000`.
- Reverse proxy the VNC subdomain to `browser:6080`.
- Require basic auth on the VNC subdomain.

## Security Posture

- This remains a PoC, so the goal is reasonable protection rather than hardening for high-risk production use.
- The public app remains reachable without auth, matching current PoC expectations.
- The VNC surface is more sensitive, so it must not be left fully public.
- Basic auth is sufficient for this PoC and much better than exposing noVNC openly.

## Error Handling

- `deploy.sh` should fail fast when `.env` is missing or required variables are empty.
- `deploy.sh` should show a clear message if Docker or Compose is not installed.
- If Caddy cannot obtain certificates, the script should leave logs available through standard `docker compose logs` instructions.

## Verification

- Run a Compose config validation after changes.
- Start the stack locally in Compose-compatible mode if possible.
- Verify that the main domain is intended to resolve to `web` and the VNC domain to noVNC.
- Verify that `.env.example` documents all required variables.

## Files Expected To Change

- Modify: `docker-compose.yml`
- Create: `deploy.sh`
- Create: `Caddyfile`
- Create: `.env.example`
- Modify: `README.md`
- Optionally modify: `.gitignore`

## Out of Scope

- Full CI/CD pipeline.
- Automatic git pull or remote branch management on the VPS.
- systemd unit setup on the host.
- Advanced secrets management.
- Stronger authentication or VPN-based protection for noVNC.
