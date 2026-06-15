#!/usr/bin/env bash
set -e

docker-compose up --build -d

SERVER_IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
if [ -z "$SERVER_IP" ]; then
  SERVER_IP="127.0.0.1"
fi

echo "Service started"
echo "Open: http://${SERVER_IP}:8000"
