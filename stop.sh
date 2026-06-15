#!/usr/bin/env bash
set -e

if docker compose version >/dev/null 2>&1; then
  COMPOSE_CMD="docker compose"
elif command -v docker-compose >/dev/null 2>&1; then
  COMPOSE_CMD="docker-compose"
else
  echo "docker compose is not installed"
  exit 1
fi

$COMPOSE_CMD down
echo "Service stopped"
