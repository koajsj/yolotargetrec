#!/usr/bin/env bash
set -e

if command -v docker >/dev/null 2>&1; then
  :
else
  echo "docker is not installed"
  exit 1
fi

if docker compose version >/dev/null 2>&1; then
  COMPOSE_CMD="docker compose"
elif command -v docker-compose >/dev/null 2>&1; then
  COMPOSE_CMD="docker-compose"
else
  echo "docker compose is not installed"
  exit 1
fi

if docker info >/dev/null 2>&1; then
  :
else
  echo "docker daemon is not running"
  exit 1
fi

$COMPOSE_CMD up -d --build --remove-orphans

for i in $(seq 1 60); do
  STATUS="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' yolo-vps-app 2>/dev/null || true)"
  if [ "$STATUS" = "healthy" ] || [ "$STATUS" = "running" ]; then
    break
  fi
  sleep 2
done

STATUS="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' yolo-vps-app 2>/dev/null || true)"
if [ "$STATUS" = "healthy" ] || [ "$STATUS" = "running" ]; then
  :
else
  echo "service failed to become healthy"
  $COMPOSE_CMD logs --tail=100
  exit 1
fi

SERVER_IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
if [ -z "$SERVER_IP" ]; then
  SERVER_IP="127.0.0.1"
fi

echo "Service started"
echo "Open: http://${SERVER_IP}:8000"
