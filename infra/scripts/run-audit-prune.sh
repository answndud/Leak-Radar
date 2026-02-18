#!/usr/bin/env bash
set -euo pipefail

# Usage:
#   ADMIN_AUDIT_RETENTION_DAYS=180 ./infra/scripts/run-audit-prune.sh

if [[ -z "${ADMIN_AUDIT_RETENTION_DAYS:-}" ]]; then
  echo "[audit-prune] ADMIN_AUDIT_RETENTION_DAYS is not set"
  exit 1
fi

pnpm -w --filter @leak/api run audit:prune
