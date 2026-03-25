#!/bin/bash
set -euo pipefail

NO_CACHE=${NO_CACHE:-0}
RESET_VOLUMES=${RESET_VOLUMES:-0}

echo "=========================================="
echo "  University Auth PoC VPS Deploy"
echo "=========================================="
echo ""

if [ ! -f .env ]; then
  echo "ERROR: .env file is missing."
  echo ""
  echo "Create it first:" 
  echo "  cp .env.example .env"
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

if ! command -v docker >/dev/null 2>&1; then
  echo "ERROR: docker is not installed."
  exit 1
fi

if ! docker compose version >/dev/null 2>&1; then
  echo "ERROR: docker compose is not available."
  exit 1
fi

echo "Domains:"
echo "  App: https://$APP_DOMAIN"
echo "  VNC: https://$VNC_DOMAIN"
echo ""
echo "Run modes:"
echo "  default          clean restart with rebuild"
echo "  NO_CACHE=1       rebuild images without Docker cache"
echo "  RESET_VOLUMES=1  also remove compose volumes"
echo ""

DOWN_ARGS=(down --remove-orphans)
if [ "$RESET_VOLUMES" = "1" ]; then
  DOWN_ARGS+=(--volumes)
fi

echo "Stopping existing containers..."
docker compose "${DOWN_ARGS[@]}"

if [ "$NO_CACHE" = "1" ]; then
  echo "Rebuilding images without cache..."
  docker compose build --no-cache
  echo "Starting containers..."
  docker compose up -d
else
  echo "Rebuilding images..."
  docker compose up -d --build
fi

echo ""
echo "Deploy complete."
echo "App URL: https://$APP_DOMAIN"
echo "VNC URL: https://$VNC_DOMAIN"
echo ""
echo "Make sure both DNS records already point to this VPS."
echo "If HTTPS is not ready yet, inspect logs with:"
echo "  docker compose logs -f caddy"
