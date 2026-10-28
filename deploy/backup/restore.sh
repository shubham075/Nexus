#!/bin/sh
# Restore the database from a dump and (optionally) the media bucket from the mirror.
#   restore.sh latest|<file in /backups/db> [--with-media] [--yes]
# Stop the API first (docker compose … stop api) so nothing writes during the restore.
# The database is restored with --clean --if-exists: existing objects are dropped and recreated.
set -eu
B=/backups
WHICH=${1:?usage: restore.sh latest|<dump file> [--with-media] [--yes]}
shift
MEDIA=no; YES=no
for a in "$@"; do
  case "$a" in --with-media) MEDIA=yes ;; --yes) YES=yes ;; *) echo "unknown option $a"; exit 2 ;; esac
done

if [ "$WHICH" = latest ]; then
  DUMP=$(ls -1 "$B"/db/nexus-*.dump 2>/dev/null | sort | tail -n 1)
else
  case "$WHICH" in /*) DUMP=$WHICH ;; *) DUMP="$B/db/$WHICH" ;; esac
fi
[ -n "$DUMP" ] && [ -f "$DUMP" ] || { echo "no dump found ($WHICH)"; exit 1; }

echo "Restoring database $PGDATABASE on $PGHOST from $(basename "$DUMP")"
[ "$MEDIA" = yes ] && echo "…and bucket $S3_BUCKET from $B/media"
if [ "$YES" != yes ]; then
  printf 'This OVERWRITES current data. Type "restore" to continue: '
  read -r answer
  [ "$answer" = restore ] || { echo aborted; exit 1; }
fi

pg_restore --clean --if-exists --no-owner --exit-on-error --single-transaction --dbname="$PGDATABASE" "$DUMP"
echo "database restored"

if [ "$MEDIA" = yes ]; then
  export RCLONE_CONFIG_NEXUSS3_TYPE=s3
  export RCLONE_CONFIG_NEXUSS3_PROVIDER=Other
  export RCLONE_CONFIG_NEXUSS3_ENDPOINT="$S3_ENDPOINT"
  export RCLONE_CONFIG_NEXUSS3_REGION="${S3_REGION:-us-east-1}"
  export RCLONE_CONFIG_NEXUSS3_ACCESS_KEY_ID="$S3_ACCESS_KEY"
  export RCLONE_CONFIG_NEXUSS3_SECRET_ACCESS_KEY="$S3_SECRET_KEY"
  export RCLONE_CONFIG_NEXUSS3_FORCE_PATH_STYLE=true
  rclone mkdir "nexuss3:$S3_BUCKET"
  # copy, not sync: never deletes objects that exist in the bucket but not in the mirror.
  rclone copy "$B/media" "nexuss3:$S3_BUCKET" --stats-one-line --stats-log-level NOTICE
  echo "media restored"
fi
echo "done. Start the API again: docker compose … up -d api"
