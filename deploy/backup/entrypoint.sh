#!/bin/sh
# cron (default): run backup.sh on BACKUP_CRON. Anything else is executed as-is (backup.sh, restore.sh, sh).
set -e
if [ "$1" = "cron" ]; then
  # crond starts jobs with an empty environment, so hand the container env to the job.
  export -p > /etc/backup.env
  echo "${BACKUP_CRON:-30 2 * * *} . /etc/backup.env && /usr/local/bin/backup.sh > /proc/1/fd/1 2>&1" > /etc/crontabs/root
  echo "backup: schedule '${BACKUP_CRON:-30 2 * * *}' (TZ=${TZ:-UTC}), keep ${BACKUP_KEEP_DAYS:-14} days"
  exec crond -f -l 8
fi
exec "$@"
