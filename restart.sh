#!/usr/bin/env bash
set -e
source "$(dirname "$0")/_lib.sh"

require_docker
detect_compose_cmd
require_docker_daemon

$COMPOSE_CMD restart

if status="$(wait_for_healthy yolo-vps-app 60)"; then
  echo "Service restarted"
else
  echo "service failed after restart (status: $status)"
  $COMPOSE_CMD logs --tail=100
  exit 1
fi
