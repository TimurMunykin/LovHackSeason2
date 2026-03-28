#!/bin/bash
set -euo pipefail

echo "=========================================="
echo "  UniCal — Build & Push Release"
echo "=========================================="
echo ""

if [ -f .env ]; then
  set -a
  . ./.env
  set +a
fi

if [ -z "${DOCKER_REPO_PREFIX:-}" ]; then
  echo "ERROR: DOCKER_REPO_PREFIX is not set."
  echo "Set it in .env (e.g. DOCKER_REPO_PREFIX=yourdockerhubuser)"
  exit 1
fi

GIT_SHA=$(git rev-parse --short HEAD)
TAG=${IMAGE_TAG:-$GIT_SHA}

echo "Docker Hub prefix: $DOCKER_REPO_PREFIX"
echo "Tags: $TAG, latest"
echo ""

echo "Building lovhack-web..."
docker build \
  -t "${DOCKER_REPO_PREFIX}/lovhack-web:${TAG}" \
  -t "${DOCKER_REPO_PREFIX}/lovhack-web:latest" \
  ./web

echo ""
echo "Building lovhack-browser..."
docker build \
  -t "${DOCKER_REPO_PREFIX}/lovhack-browser:${TAG}" \
  -t "${DOCKER_REPO_PREFIX}/lovhack-browser:latest" \
  ./browser

echo ""
echo "Building lovhack-presentation..."
docker build \
  -t "${DOCKER_REPO_PREFIX}/lovhack-presentation:${TAG}" \
  -t "${DOCKER_REPO_PREFIX}/lovhack-presentation:latest" \
  ./presentation

echo ""
echo "Pushing lovhack-web..."
docker push "${DOCKER_REPO_PREFIX}/lovhack-web:${TAG}"
docker push "${DOCKER_REPO_PREFIX}/lovhack-web:latest"

echo "Pushing lovhack-browser..."
docker push "${DOCKER_REPO_PREFIX}/lovhack-browser:${TAG}"
docker push "${DOCKER_REPO_PREFIX}/lovhack-browser:latest"

echo "Pushing lovhack-presentation..."
docker push "${DOCKER_REPO_PREFIX}/lovhack-presentation:${TAG}"
docker push "${DOCKER_REPO_PREFIX}/lovhack-presentation:latest"

echo ""
echo "Done. Pushed images:"
echo "  ${DOCKER_REPO_PREFIX}/lovhack-web:${TAG}"
echo "  ${DOCKER_REPO_PREFIX}/lovhack-web:latest"
echo "  ${DOCKER_REPO_PREFIX}/lovhack-browser:${TAG}"
echo "  ${DOCKER_REPO_PREFIX}/lovhack-browser:latest"
echo "  ${DOCKER_REPO_PREFIX}/lovhack-presentation:${TAG}"
echo "  ${DOCKER_REPO_PREFIX}/lovhack-presentation:latest"
