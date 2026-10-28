#!/bin/sh
# Nightly backup: pg_dump (custom format) with rotation + mirror of the media bucket, optional off-site copy.
# Layout under /backups:
#   db/nexus-YYYYMMDD-HHMMSS.dump   one per run, older than BACKUP_KEEP_DAYS deleted
#   media/                          mirror of the S3 bucket
#   media-changed/YYYYMMDD-HHMMSS/  objects deleted/overwritten in the bucket since the previous run
#   last-success                    timestamp of the last complete run (monitor its age)
# Env: PG* (connection), S3_ENDPOINT S3_REGION S3_BUCKET S3_ACCESS_KEY S3_SECRET_KEY,
#      BACKUP_KEEP_DAYS (14), BACKUP_REMOTE (optional rclone remote:path, configured via RCLONE_CONFIG_*).
set -eu
STAMP=$(date +%Y%m%d-%H%M%S)
KEEP=${BACKUP_KEEP_DAYS:-14}
B=/backups
mkdir -p "$B/db" "$B/media" "$B/media-changed"

log() { echo "{\"time\":\"$(date -Iseconds)\",\"service\":\"backup\",\"msg\":\"$*\"}"; }

# --- database ---
DUMP="$B/db/nexus-$STAMP.dump"
pg_dump --format=custom --compress=6 --no-owner --file="$DUMP.partial"
pg_restore --list "$DUMP.partial" > /dev/null   # fail now if the archive is unreadable
mv "$DUMP.partial" "$DUMP"
log "db dump ok $(basename "$DUMP") $(du -h "$DUMP" | cut -f1)"
find "$B/db" -name 'nexus-*.dump' -mtime +"$KEEP" -print -delete | sed 's/^/rotated /'
find "$B/db" -name '*.partial' -delete

# --- media ---
export RCLONE_CONFIG_NEXUSS3_TYPE=s3
export RCLONE_CONFIG_NEXUSS3_PROVIDER=Other
export RCLONE_CONFIG_NEXUSS3_ENDPOINT="$S3_ENDPOINT"
export RCLONE_CONFIG_NEXUSS3_REGION="${S3_REGION:-us-east-1}"
export RCLONE_CONFIG_NEXUSS3_ACCESS_KEY_ID="$S3_ACCESS_KEY"
export RCLONE_CONFIG_NEXUSS3_SECRET_ACCESS_KEY="$S3_SECRET_KEY"
export RCLONE_CONFIG_NEXUSS3_FORCE_PATH_STYLE=true
rclone sync "nexuss3:$S3_BUCKET" "$B/media" --backup-dir "$B/media-changed/$STAMP" --stats-one-line --stats-log-level NOTICE
log "media sync ok $(du -sh "$B/media" | cut -f1)"
find "$B/media-changed" -mindepth 1 -maxdepth 1 -type d -mtime +"$KEEP" -exec rm -rf {} +

# --- off-site (optional) ---
if [ -n "${BACKUP_REMOTE:-}" ]; then
  rclone copy "$DUMP" "$BACKUP_REMOTE/db/"
  rclone sync "$B/media" "$BACKUP_REMOTE/media" --backup-dir "$BACKUP_REMOTE/media-changed/$STAMP"
  log "off-site copy ok $BACKUP_REMOTE"
fi

date -Iseconds > "$B/last-success"
log "backup complete $STAMP"
