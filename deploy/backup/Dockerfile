# Backup sidecar: pg_dump/pg_restore (same major as the server) + rclone for S3, run by busybox crond.
FROM postgres:16-alpine
RUN apk add --no-cache rclone tzdata
COPY backup.sh restore.sh entrypoint.sh /usr/local/bin/
RUN chmod 755 /usr/local/bin/backup.sh /usr/local/bin/restore.sh /usr/local/bin/entrypoint.sh
ENTRYPOINT ["entrypoint.sh"]
CMD ["cron"]
