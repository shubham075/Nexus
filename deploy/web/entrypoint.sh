#!/bin/sh
# Writes the runtime config the web client fetches at startup, then serves the site.
set -eu
: "${NEXUS_API_URL:?set NEXUS_API_URL to the API origin, e.g. https://api.example.com}"
NEXUS_API_URL="${NEXUS_API_URL%/}"
export NEXUS_API_URL
printf '{"apiUrl":"%s"}\n' "$NEXUS_API_URL" > /srv/config.json
exec caddy run --config /etc/caddy/Caddyfile --adapter caddyfile
