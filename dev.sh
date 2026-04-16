#!/usr/bin/env bash
set -e

cleanup() {
  kill $BACKEND_PID $FRONTEND_PID 2>/dev/null
  wait $BACKEND_PID $FRONTEND_PID 2>/dev/null
  exit 0
}
trap cleanup INT TERM

npx tsx src/cli/cli.ts serve &
BACKEND_PID=$!

cd web && npm run dev &
FRONTEND_PID=$!

wait
