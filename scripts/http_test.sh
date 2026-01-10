#!/usr/bin/env bash
set -euo pipefail

BASE_URL=${1:-http://localhost:8080}

echo "GET $BASE_URL/health"
curl -s "$BASE_URL/health" | jq . || curl -s "$BASE_URL/health"

echo

echo "GET $BASE_URL/status"
curl -s "$BASE_URL/status" | jq . || curl -s "$BASE_URL/status"

echo

echo "GET $BASE_URL/integrations/test"
curl -s "$BASE_URL/integrations/test" | jq . || curl -s "$BASE_URL/integrations/test"
