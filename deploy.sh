#!/bin/bash
set -euo pipefail

RESET_VOLUMES=${RESET_VOLUMES:-0}
COMPOSE_FILES="-f docker-compose.yml -f docker-compose.prod.yml"

echo "=========================================="
echo "  UniCal — VPS Deploy"
echo "=========================================="
echo ""

if [ ! -f .env ]; then
  echo "ERROR: .env file is missing."
  echo "  cp .env.example .env   # then fill in values"
  exit 1
fi

set -a
. ./.env
set +a

required_vars=(GOOGLE_CLIENT_ID GOOGLE_CLIENT_SECRET SESSION_SECRET POSTGRES_PASSWORD DOCKER_REPO_PREFIX APP_DOMAIN)
for var in "${required_vars[@]}"; do
  if [ -z "${!var:-}" ]; then
    echo "ERROR: $var is not set in .env"
    exit 1
  fi
done

export BASE_URL="https://${APP_DOMAIN}"

if ! command -v docker >/dev/null 2>&1; then
  echo "ERROR: docker is not installed."
  exit 1
fi

if ! docker compose version >/dev/null 2>&1; then
  echo "ERROR: docker compose is not available."
  exit 1
fi

echo "App URL: ${BASE_URL}"
echo ""

DOWN_ARGS=(${COMPOSE_FILES} down --remove-orphans)
if [ "$RESET_VOLUMES" = "1" ]; then
  DOWN_ARGS+=(--volumes)
fi

echo "Pulling latest images..."
docker compose ${COMPOSE_FILES} pull

echo "Stopping existing containers..."
docker compose ${DOWN_ARGS[@]}

echo "Starting containers..."
docker compose ${COMPOSE_FILES} up -d

echo ""
echo "Deploy complete."
echo "App URL: ${BASE_URL}"
echo ""
echo "Make sure DNS for ${APP_DOMAIN} points to this VPS."
echo "If HTTPS is not ready yet, check:"
echo "  docker compose ${COMPOSE_FILES} logs -f caddy"
