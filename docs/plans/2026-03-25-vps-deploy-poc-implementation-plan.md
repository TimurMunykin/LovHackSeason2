# VPS Deploy PoC Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a repeatable VPS deployment flow for the current PoC with `.env` configuration, Dockerized Caddy HTTPS, and a manual `deploy.sh` entrypoint.

**Architecture:** Extend the existing two-service Docker Compose stack with a `caddy` reverse proxy that terminates TLS and routes traffic to the existing internal services. Keep the runtime close to `dev.sh`, but move production configuration into `.env` and add a dedicated deploy script that validates prerequisites and restarts the stack cleanly.

**Tech Stack:** Docker Compose, Caddy, Bash, Node.js, Express, Playwright

---

### Task 1: Add deployment environment template

**Files:**
- Create: `.env.example`
- Modify: `.gitignore`

**Step 1: Write the environment template**

Create `.env.example` with the exact variables the deployment requires:

```dotenv
OPENAI_API_KEY=
APP_DOMAIN=uni-schedule-sync.xyz
VNC_DOMAIN=vnc.uni-schedule-sync.xyz
VNC_BASIC_AUTH_USER=admin
VNC_BASIC_AUTH_HASH=
```

**Step 2: Keep real secrets out of git**

Ensure `.gitignore` contains:

```gitignore
.env
```

Add it only if it is not already present.

**Step 3: Verify the template is readable**

Run: `python - <<'PY'
from pathlib import Path
text = Path('.env.example').read_text()
required = ['OPENAI_API_KEY', 'APP_DOMAIN', 'VNC_DOMAIN', 'VNC_BASIC_AUTH_USER', 'VNC_BASIC_AUTH_HASH']
missing = [k for k in required if k not in text]
assert not missing, missing
print('env template ok')
PY`

Expected: `env template ok`

**Step 4: Commit**

```bash
git add .env.example .gitignore
git commit -m "chore: add deployment environment template"
```

### Task 2: Add Caddy reverse proxy configuration

**Files:**
- Create: `Caddyfile`

**Step 1: Write the Caddy configuration**

Create `Caddyfile` with two site blocks using Compose env substitution:

```caddyfile
{$APP_DOMAIN} {
  encode gzip zstd
  reverse_proxy web:3000
}

{$VNC_DOMAIN} {
  basicauth {
    {$VNC_BASIC_AUTH_USER} {$VNC_BASIC_AUTH_HASH}
  }
  reverse_proxy browser:6080
}
```

Keep the file minimal. Caddy will handle HTTP to HTTPS redirects automatically when ports `80` and `443` are exposed.

**Step 2: Validate basic Caddyfile structure**

Run: `docker run --rm -v "$PWD/Caddyfile:/etc/caddy/Caddyfile" caddy:2 caddy fmt --overwrite /etc/caddy/Caddyfile`

Expected: the command succeeds and may rewrite formatting.

**Step 3: Re-read the file**

Open `Caddyfile` and confirm both domains and the `basicauth` block are still present.

**Step 4: Commit**

```bash
git add Caddyfile
git commit -m "feat: add caddy proxy config for deployment"
```

### Task 3: Update Docker Compose for production routing

**Files:**
- Modify: `docker-compose.yml`

**Step 1: Add the Caddy service**

Extend `docker-compose.yml` with:

```yaml
  caddy:
    image: caddy:2
    ports:
      - "80:80"
      - "443:443"
    environment:
      - APP_DOMAIN=${APP_DOMAIN}
      - VNC_DOMAIN=${VNC_DOMAIN}
      - VNC_BASIC_AUTH_USER=${VNC_BASIC_AUTH_USER}
      - VNC_BASIC_AUTH_HASH=${VNC_BASIC_AUTH_HASH}
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy_data:/data
      - caddy_config:/config
    depends_on:
      - web
      - browser
```

**Step 2: Stop exposing internal services publicly**

Update `web` and `browser` so they no longer publish host ports in production Compose. Keep service-to-service networking intact.

Target shape:

```yaml
services:
  caddy: ...
  web:
    build: ./web
    depends_on:
      - browser
    environment:
      - BROWSER_API=http://browser:3001

  browser:
    build: ./browser
    shm_size: "2g"
    environment:
      - OPENAI_API_KEY=${OPENAI_API_KEY}

volumes:
  caddy_data:
  caddy_config:
```

**Step 3: Validate the Compose file**

Run: `docker compose config`

Expected: merged config prints successfully with no validation errors.

**Step 4: Commit**

```bash
git add docker-compose.yml
git commit -m "feat: route app traffic through caddy"
```

### Task 4: Create the VPS deployment script

**Files:**
- Create: `deploy.sh`

**Step 1: Copy the proven restart pattern from development**

Base the script structure on `dev.sh` so the operational behavior stays familiar:

```bash
#!/bin/bash
set -euo pipefail

NO_CACHE=${NO_CACHE:-0}
RESET_VOLUMES=${RESET_VOLUMES:-0}
```

**Step 2: Add environment and tool validation**

Require these checks before any Compose action:

```bash
if [ ! -f .env ]; then
  echo "ERROR: .env file is missing."
  exit 1
fi

set -a
. ./.env
set +a

required_vars=(OPENAI_API_KEY APP_DOMAIN VNC_DOMAIN VNC_BASIC_AUTH_USER VNC_BASIC_AUTH_HASH)
for var in "${required_vars[@]}"; do
  if [ -z "${!var:-}" ]; then
    echo "ERROR: $var is not set in .env"
    exit 1
  fi
done

command -v docker >/dev/null 2>&1 || { echo "ERROR: docker is not installed"; exit 1; }
docker compose version >/dev/null 2>&1 || { echo "ERROR: docker compose is not available"; exit 1; }
```

**Step 3: Add clean restart logic**

Reuse the same teardown pattern as `dev.sh`:

```bash
DOWN_ARGS=(down --remove-orphans)
if [ "$RESET_VOLUMES" = "1" ]; then
  DOWN_ARGS+=(--volumes)
fi

docker compose "${DOWN_ARGS[@]}"

if [ "$NO_CACHE" = "1" ]; then
  docker compose build --no-cache
  docker compose up -d
else
  docker compose up -d --build
fi
```

**Step 4: Add operator-facing output**

Print:

```text
https://$APP_DOMAIN
https://$VNC_DOMAIN
```

Also print a reminder that both DNS records must already point to the VPS and that certificate provisioning can be inspected with `docker compose logs caddy`.

**Step 5: Verify shell syntax**

Run: `bash -n deploy.sh`

Expected: no output, exit code `0`

**Step 6: Commit**

```bash
git add deploy.sh
git commit -m "feat: add manual VPS deploy script"
```

### Task 5: Document the deployment flow

**Files:**
- Modify: `README.md`

**Step 1: Add a short deployment section**

Document:

- prerequisites: Docker, Docker Compose, DNS records for both domains
- copy `.env.example` to `.env`
- generate Caddy password hash
- run `./deploy.sh`
- inspect logs with `docker compose logs -f caddy`, `docker compose logs -f web`, `docker compose logs -f browser`

Use concrete commands such as:

```bash
cp .env.example .env
docker run --rm caddy:2 caddy hash-password --plaintext 'change-me'
chmod +x deploy.sh
./deploy.sh
```

**Step 2: Mention the two public URLs**

Document that:

- `https://APP_DOMAIN` serves the app
- `https://VNC_DOMAIN` serves noVNC behind basic auth

**Step 3: Verify the README references real files**

Run: `python - <<'PY'
from pathlib import Path
text = Path('README.md').read_text()
for snippet in ['deploy.sh', '.env.example', 'Caddyfile']:
    assert snippet in text, snippet
print('readme ok')
PY`

Expected: `readme ok`

**Step 4: Commit**

```bash
git add README.md
git commit -m "docs: add VPS deployment instructions"
```

### Task 6: End-to-end configuration verification

**Files:**
- Modify if needed: `docker-compose.yml`
- Modify if needed: `Caddyfile`
- Modify if needed: `deploy.sh`
- Modify if needed: `README.md`

**Step 1: Re-run validation commands**

Run:

```bash
bash -n deploy.sh
docker compose config >/tmp/lovhack-compose.out
docker run --rm -v "$PWD/Caddyfile:/etc/caddy/Caddyfile" caddy:2 caddy adapt --config /etc/caddy/Caddyfile >/tmp/lovhack-caddy.json
```

Expected: all commands succeed.

**Step 2: Smoke-test startup with safe placeholder values**

Create a temporary `.env` from `.env.example`, fill placeholder values, then run:

```bash
docker compose up -d --build
docker compose ps
docker compose down --remove-orphans
```

Expected:

- services build and start
- `caddy`, `web`, and `browser` appear in `docker compose ps`
- teardown succeeds cleanly

If the browser service cannot fully operate without a real key, startup should still be inspected carefully and any failure mode should be documented.

**Step 3: Clean up temporary local secrets**

Remove the temporary `.env` if you created one for validation.

**Step 4: Commit**

```bash
git add docker-compose.yml Caddyfile deploy.sh README.md .env.example .gitignore
git commit -m "chore: verify VPS deployment stack"
```
