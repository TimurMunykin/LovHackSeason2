#!/bin/bash
set -e

NO_CACHE=${NO_CACHE:-0}
RESET_VOLUMES=${RESET_VOLUMES:-0}
COMPOSE_FILES="-f docker-compose.yml -f docker-compose.dev.yml"

echo "=========================================="
echo "  UniCal — Local Development"
echo "=========================================="
echo ""

# Source .env if it exists
if [ -f .env ]; then
  set -a
  . ./.env
  set +a
fi

# Defaults for local dev
export POSTGRES_PASSWORD=${POSTGRES_PASSWORD:-devpassword}
export SESSION_SECRET=${SESSION_SECRET:-dev-secret-change-me}
export BASE_URL=${BASE_URL:-http://localhost:3000}

# Google OAuth is required
if [ -z "$GOOGLE_CLIENT_ID" ] || [ -z "$GOOGLE_CLIENT_SECRET" ]; then
  echo "ERROR: GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are required."
  echo ""
  echo "Set them in .env or export before running:"
  echo "  cp .env.example .env   # then fill in values"
  echo "  ./dev.sh"
  exit 1
fi

echo "App will be at: $BASE_URL"
echo ""
echo "Run modes:"
echo "  default          clean restart with rebuild"
echo "  NO_CACHE=1       rebuild images without Docker cache"
echo "  RESET_VOLUMES=1  also remove compose volumes (resets DB)"
echo ""

DOWN_ARGS=(${COMPOSE_FILES} down --remove-orphans)
if [ "$RESET_VOLUMES" = "1" ]; then
  DOWN_ARGS+=(--volumes)
fi

echo "Stopping existing containers..."
docker compose ${DOWN_ARGS[@]}

if [ "$NO_CACHE" = "1" ]; then
  echo "Rebuilding images without cache..."
  docker compose ${COMPOSE_FILES} build --no-cache
  echo "Starting containers..."
  docker compose ${COMPOSE_FILES} up
else
  echo "Rebuilding and starting..."
  docker compose ${COMPOSE_FILES} up --build
fi
