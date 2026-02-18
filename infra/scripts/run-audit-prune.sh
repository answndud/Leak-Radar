#!/usr/bin/env bash
set -euo pipefail

# Usage:
#   ADMIN_AUDIT_RETENTION_DAYS=180 ./infra/scripts/run-audit-prune.sh
#   ADMIN_AUDIT_VIEW_DELETE_RETENTION_DAYS=30 ./infra/scripts/run-audit-prune.sh
#   ADMIN_AUDIT_RETENTION_DAYS=180 ADMIN_AUDIT_VIEW_DELETE_RETENTION_DAYS=30 ./infra/scripts/run-audit-prune.sh

if [[ -z "${ADMIN_AUDIT_RETENTION_DAYS:-}" && -z "${ADMIN_AUDIT_VIEW_DELETE_RETENTION_DAYS:-}" ]]; then
  echo "[audit-prune] set ADMIN_AUDIT_RETENTION_DAYS or ADMIN_AUDIT_VIEW_DELETE_RETENTION_DAYS"
  exit 1
fi

pnpm -w --filter @leak/api run audit:prune
