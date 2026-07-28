#!/usr/bin/env bash
set -Eeuo pipefail

ROOT=/var/www/html/backend-api
APP="$ROOT/app"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
BACKUP="/root/parkswap-web-backup-$STAMP"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

test -d "$APP"
mkdir -p "$BACKUP"
cp -a "$APP/app.css" "$APP/app.js" "$APP/index.html" "$APP/sw.js" "$BACKUP/"

WEB_RAW=https://raw.githubusercontent.com/ParkSwap-app/parkswap-website/main/static/app
for file in app.css app.js index.html sw.js; do
  curl -fsSL "$WEB_RAW/$file" -o "$TMP/$file"
  test -s "$TMP/$file"
done

grep -Fq 'activity-zones' "$TMP/app.js"
grep -Fq 'exploreCoords' "$TMP/app.js"
grep -Fq 'map-legend' "$TMP/index.html"

install -o www-data -g www-data -m 0644 "$TMP/app.css" "$APP/app.css"
install -o www-data -g www-data -m 0644 "$TMP/app.js" "$APP/app.js"
install -o www-data -g www-data -m 0644 "$TMP/index.html" "$APP/index.html"
install -o www-data -g www-data -m 0644 "$TMP/sw.js" "$APP/sw.js"

nginx -t
echo "PARKSWAP_WEB_RELEASE_OK backup=$BACKUP"
