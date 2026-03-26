#!/usr/bin/env bash
# generate-swagger.sh
#
# Fetches the OpenAPI spec from the running backend and saves it as:
#   openapi.json   — always produced
#   openapi.yaml   — produced if python3 or yq is available
#
# Usage:
#   ./generate-swagger.sh              # expects app on localhost:3001
#   PORT=8080 ./generate-swagger.sh    # custom port
#   ./generate-swagger.sh --start      # start docker compose first if needed

set -euo pipefail

PORT="${PORT:-3001}"
BASE_URL="http://localhost:${PORT}"
SPEC_URL="${BASE_URL}/v3/api-docs"
OUT_JSON="openapi.json"
OUT_YAML="openapi.yaml"

# ── helpers ──────────────────────────────────────────────────────────────────

red()   { printf '\033[31m%s\033[0m\n' "$*"; }
green() { printf '\033[32m%s\033[0m\n' "$*"; }
blue()  { printf '\033[34m%s\033[0m\n' "$*"; }
bold()  { printf '\033[1m%s\033[0m\n' "$*"; }

is_up() { curl -sf --max-time 3 "${SPEC_URL}" > /dev/null 2>&1; }

wait_for_app() {
    local tries=40   # 40 × 3 s = up to 2 min
    blue "Waiting for backend on ${BASE_URL} ..."
    for ((i = 1; i <= tries; i++)); do
        if is_up; then
            green "Backend is up."
            return 0
        fi
        printf '.'
        sleep 3
    done
    printf '\n'
    red "ERROR: Backend did not become reachable after $((tries * 3)) seconds."
    red "Make sure the app is running (or pass --start to start docker compose)."
    exit 1
}

# ── argument parsing ──────────────────────────────────────────────────────────

START_DOCKER=false
for arg in "$@"; do
    case "$arg" in
        --start) START_DOCKER=true ;;
        --help|-h)
            bold "Usage: ./generate-swagger.sh [--start] [--help]"
            echo ""
            echo "  --start   Run 'docker compose up -d' if the backend is not reachable."
            echo "  PORT=N    Override the backend port (default: 3001)."
            echo ""
            echo "Output:"
            echo "  openapi.json   OpenAPI 3 spec (JSON)"
            echo "  openapi.yaml   OpenAPI 3 spec (YAML)  — requires python3 or yq"
            exit 0
            ;;
    esac
done

# ── optionally start docker compose ──────────────────────────────────────────

if ! is_up; then
    if [ "$START_DOCKER" = true ]; then
        bold "Starting docker compose..."
        docker compose up -d
    fi
    wait_for_app
else
    green "Backend already up on ${BASE_URL}."
fi

# ── fetch the spec ────────────────────────────────────────────────────────────

bold "Fetching OpenAPI spec from ${SPEC_URL} ..."
curl -sf "${SPEC_URL}" -o "${OUT_JSON}"
green "Saved: ${OUT_JSON}"

# pretty-print JSON in-place (requires python3 or jq)
if command -v jq &>/dev/null; then
    jq . "${OUT_JSON}" > "${OUT_JSON}.tmp" && mv "${OUT_JSON}.tmp" "${OUT_JSON}"
elif python3 -c "import json" &>/dev/null 2>&1; then
    python3 -c "
import json, sys
data = json.load(open('${OUT_JSON}'))
with open('${OUT_JSON}', 'w') as f:
    json.dump(data, f, indent=2, ensure_ascii=False)
print('  (pretty-printed)')
"
fi

# ── convert to YAML ───────────────────────────────────────────────────────────

if command -v yq &>/dev/null; then
    yq -P "${OUT_JSON}" > "${OUT_YAML}"
    green "Saved: ${OUT_YAML}  (via yq)"
elif python3 -c "import yaml" &>/dev/null 2>&1; then
    python3 -c "
import json, yaml
data = json.load(open('${OUT_JSON}'))
with open('${OUT_YAML}', 'w') as f:
    yaml.dump(data, f, default_flow_style=False, allow_unicode=True, sort_keys=False)
print('Saved: ${OUT_YAML}  (via python3 pyyaml)')
"
    green "Saved: ${OUT_YAML}"
else
    blue "Note: install 'yq' or 'python3-yaml' (pip install pyyaml) to also get ${OUT_YAML}."
fi

# ── summary ───────────────────────────────────────────────────────────────────

bold ""
bold "Done. Swagger UI: ${BASE_URL}/swagger-ui.html"
