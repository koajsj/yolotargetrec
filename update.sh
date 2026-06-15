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

git pull origin main
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
  $COMPOSE_CMD ps
else
  echo "service failed after update"
  $COMPOSE_CMD logs --tail=100
  exit 1
fi

echo "Update completed"
