#!/usr/bin/env bash
set -e

git pull origin main
docker-compose up --build -d
docker-compose ps

echo "Update completed"
