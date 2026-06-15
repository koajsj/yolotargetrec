#!/usr/bin/env bash
set -e
source "$(dirname "$0")/_lib.sh"

require_docker
detect_compose_cmd
require_docker_daemon

git_fast_forward_update
$COMPOSE_CMD up -d --build --remove-orphans

if status="$(wait_for_healthy yolo-vps-app 60)"; then
  $COMPOSE_CMD ps
  echo "Update completed"
else
  echo "service failed after update (status: $status)"
  $COMPOSE_CMD logs --tail=100
  exit 1
fi
