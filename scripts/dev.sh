#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)

docker compose -f "$ROOT_DIR/docker/docker-compose.yml" up -d

( cd "$ROOT_DIR/server" && npm install )
( cd "$ROOT_DIR/server" && npm run dev ) &
SERVER_PID=$!

sleep 2
node "$ROOT_DIR/client_stub/index.js"

kill "$SERVER_PID"
