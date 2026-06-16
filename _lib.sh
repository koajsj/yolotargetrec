#!/usr/bin/env bash
# Shared helpers for run.sh / update.sh / restart.sh / stop.sh.
# Source with: source "$(dirname "$0")/_lib.sh"

set -e

LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

require_docker() {
  if ! command -v docker >/dev/null 2>&1; then
    echo "docker is not installed"
    exit 1
  fi
}

detect_compose_cmd() {
  if docker compose version >/dev/null 2>&1; then
    COMPOSE_CMD="docker compose"
  elif command -v docker-compose >/dev/null 2>&1; then
    COMPOSE_CMD="docker-compose"
  else
    echo "docker compose is not installed"
    exit 1
  fi
  export COMPOSE_CMD
}

require_docker_daemon() {
  if ! docker info >/dev/null 2>&1; then
    echo "docker daemon is not running or current user cannot access docker"
    echo "try: sudo systemctl start docker"
    echo "or run the script with sudo on a fresh VPS"
    exit 1
  fi
}

# Poll container health/status for up to max_attempts * 2 seconds. Echoes the
# final status (healthy / running / starting / missing / ...). Returns 0 on
# healthy/running, 1 otherwise.
wait_for_healthy() {
  local container="${1:-yolo-vps-app}"
  local max_attempts="${2:-60}"
  local status="starting"
  for _ in $(seq 1 "$max_attempts"); do
    status="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$container" 2>/dev/null || echo "missing")"
    if [ "$status" = "healthy" ] || [ "$status" = "running" ]; then
      echo "$status"
      return 0
    fi
    sleep 2
  done
  echo "$status"
  return 1
}

# Print a hint about whether the local working copy is ahead/behind origin.
# Network or auth failures are silently ignored (e.g. offline / private repo).
print_git_status_hint() {
  if [ ! -d "$LIB_DIR/.git" ] || ! command -v git >/dev/null 2>&1; then
    return 0
  fi
  echo "Checking for upstream updates..."
  if git -C "$LIB_DIR" fetch origin --quiet 2>/dev/null; then
    local ahead behind
    ahead=$(git -C "$LIB_DIR" rev-list --count '@{u}..HEAD' 2>/dev/null || echo 0)
    behind=$(git -C "$LIB_DIR" rev-list --count 'HEAD..@{u}' 2>/dev/null || echo 0)
    if [ "$behind" != "0" ] && [ -n "$behind" ]; then
      echo "  Local branch is $behind commit(s) behind origin."
      echo "  Run 'bash update.sh' (or 'git fetch && git merge --ff-only && $COMPOSE_CMD up -d --build') to pick up new code."
    elif [ "$ahead" != "0" ] && [ -n "$ahead" ]; then
      echo "  Local branch is $ahead commit(s) ahead of origin (will be ignored by run.sh)."
    else
      echo "  Up to date."
    fi
  fi
}

require_clean_git_worktree() {
  if [ ! -d "$LIB_DIR/.git" ] || ! command -v git >/dev/null 2>&1; then
    return 0
  fi
  if [ -n "$(git -C "$LIB_DIR" status --porcelain 2>/dev/null)" ]; then
    echo "working tree has local changes; commit or stash them before running update.sh"
    exit 1
  fi
}

git_fast_forward_update() {
  if [ ! -d "$LIB_DIR/.git" ] || ! command -v git >/dev/null 2>&1; then
    echo "git repository is required for update.sh"
    exit 1
  fi
  require_clean_git_worktree
  git -C "$LIB_DIR" fetch origin main
  git -C "$LIB_DIR" merge --ff-only FETCH_HEAD
}

server_ip() {
  local ip
  ip="$(hostname -I 2>/dev/null | awk '{print $1}')"
  if [ -z "$ip" ] && command -v ip >/dev/null 2>&1; then
    ip="$(ip route get 1.1.1.1 2>/dev/null | awk '{
      for (i = 1; i <= NF; i++) {
        if ($i == "src") {
          print $(i + 1)
          exit
        }
      }
    }')"
  fi
  if [ -z "$ip" ]; then
    ip="127.0.0.1"
  fi
  echo "$ip"
}
