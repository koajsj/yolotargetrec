#!/usr/bin/env bash
set -e
source "$(dirname "$0")/_lib.sh"

require_docker
detect_compose_cmd
require_docker_daemon

$COMPOSE_CMD down
echo "Service stopped"
