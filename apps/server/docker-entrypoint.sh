#!/bin/sh
# Entrypoint for the Nexus API image.
#   serve    (default) start the API
#   migrate  apply pending Prisma migrations (prisma migrate deploy), then exit
#   seed     seed an EMPTY database with the demo company + first super admin, then exit
#   *        run anything else (e.g. `sh`)
set -e
case "$1" in
  serve)   exec node --enable-source-maps dist/index.js ;;
  migrate) exec ./node_modules/.bin/prisma migrate deploy --schema prisma/schema.prisma ;;
  seed)    exec node --enable-source-maps dist/seed.js ;;
  *)       exec "$@" ;;
esac
