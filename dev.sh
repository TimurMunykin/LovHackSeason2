#!/bin/bash
set -e

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

docker compose up --build
