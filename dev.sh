#!/bin/bash
set -e

NO_CACHE=${NO_CACHE:-0}
RESET_VOLUMES=${RESET_VOLUMES:-0}

echo "=========================================="
echo "  University Auth PoC"
echo "=========================================="
echo ""

if [ -z "$OPENAI_API_KEY" ]; then
  echo "ERROR: OPENAI_API_KEY is not set."
  echo ""
  echo "Run with:"
  echo "  OPENAI_API_KEY=sk-... ./dev.sh"
  echo ""
  echo "Or export it first:"
  echo "  export OPENAI_API_KEY=sk-..."
  echo "  ./dev.sh"
  exit 1
fi

echo "Building and starting containers..."
echo "App will be at: http://localhost:3000"
echo "VNC stream at:  http://localhost:6080"
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
  docker compose up
else
  echo "Rebuilding images..."
  docker compose up --build
fi
