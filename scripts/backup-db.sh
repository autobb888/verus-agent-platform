#!/bin/bash
# DB Backup Script — SQLite safe backup using .backup command
# Runs via cron or manually: ./scripts/backup-db.sh

set -e

DB_PATH="${DB_PATH:-./data/verus-platform.db}"
BACKUP_DIR="${BACKUP_DIR:-./backups}"
MAX_BACKUPS="${MAX_BACKUPS:-7}"

TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="$BACKUP_DIR/verus-platform_$TIMESTAMP.db"

mkdir -p "$BACKUP_DIR"

# Use SQLite's .backup for safe hot backup (works with WAL mode)
sqlite3 "$DB_PATH" ".backup '$BACKUP_FILE'"

# Compress
gzip "$BACKUP_FILE"
echo "[Backup] Created: ${BACKUP_FILE}.gz"

# Prune old backups (keep last N)
cd "$BACKUP_DIR"
ls -t verus-platform_*.db.gz 2>/dev/null | tail -n +$((MAX_BACKUPS + 1)) | xargs -r rm -f
echo "[Backup] Pruned to last $MAX_BACKUPS backups"

ls -lh "$BACKUP_DIR"/verus-platform_*.db.gz 2>/dev/null | tail -5
