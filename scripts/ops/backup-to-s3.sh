#!/usr/bin/env bash
# Backup SQLite/Postgres + uploads to S3 (Yandex Object Storage).
# Usage: bash scripts/ops/backup-to-s3.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
: "${S3_BUCKET:?Set S3_BUCKET}"
: "${AWS_ACCESS_KEY_ID:?Set AWS_ACCESS_KEY_ID}"
: "${AWS_SECRET_ACCESS_KEY:?Set AWS_SECRET_ACCESS_KEY}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
ARCHIVE="/tmp/crm-backup-${STAMP}.tar.gz"
tar -czf "$ARCHIVE" \
  ${CRM_DB_PATH:-crm.db} \
  uploads 2>/dev/null || tar -czf "$ARCHIVE" uploads
aws s3 cp "$ARCHIVE" "s3://${S3_BUCKET}/crm-backups/$(basename "$ARCHIVE")"
rm -f "$ARCHIVE"
echo "Uploaded s3://${S3_BUCKET}/crm-backups/$(basename "$ARCHIVE")"
