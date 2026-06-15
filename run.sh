#!/usr/bin/env bash
set -e
source "$(dirname "$0")/_lib.sh"

require_docker
detect_compose_cmd
require_docker_daemon
print_git_status_hint

$COMPOSE_CMD up -d --build --remove-orphans

if status="$(wait_for_healthy yolo-vps-app 60)"; then
  ip=$(server_ip)
  echo "Service started"
  echo "Open: http://${ip}:8000"
else
  echo "service failed to become healthy (status: $status)"
  $COMPOSE_CMD logs --tail=100
  exit 1
fi
