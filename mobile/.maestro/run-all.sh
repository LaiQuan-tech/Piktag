#!/bin/bash
# Run all Maestro E2E tests
# Usage: ./run-all.sh
# Requires: maestro installed, .env file with TEST_EMAIL and TEST_PASSWORD

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$SCRIPT_DIR/.env"

if [ ! -f "$ENV_FILE" ]; then
  echo "Error: .env file not found. Copy .env.example to .env and fill in credentials."
  exit 1
fi

# Load env vars
export $(grep -v '^#' "$ENV_FILE" | xargs)

echo "Running PikTag E2E tests..."
echo ""

tests=(
  "01_login.yaml"
  "02_search.yaml"
  "03_profile.yaml"
  "04_qr_scan_flow.yaml"
  "05_connections.yaml"
)

passed=0
failed=0

for test in "${tests[@]}"; do
  echo "▶ Running: $test"
  if maestro test "$SCRIPT_DIR/$test" --env TEST_EMAIL="$TEST_EMAIL" --env TEST_PASSWORD="$TEST_PASSWORD"; then
    echo "✓ PASSED: $test"
    ((passed++))
  else
    echo "✗ FAILED: $test"
    ((failed++))
  fi
  echo ""
done

echo "━━━━━━━━━━━━━━━━━━━━━━━"
echo "Results: $passed passed, $failed failed"

if [ $failed -gt 0 ]; then
  exit 1
fi
