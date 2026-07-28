#!/usr/bin/env bash
set -Eeuo pipefail

ROOT=/var/www/html/backend-api
APP="$ROOT/app"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
BACKUP="/root/parkswap-backup-$STAMP"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

test -d "$APP"
test -f "$ROOT/application/config/routes.php"
mkdir -p "$BACKUP/app" "$BACKUP/backend"
cp -a "$APP/app.css" "$APP/app.js" "$APP/index.html" "$APP/sw.js" "$BACKUP/app/"
cp -a "$ROOT/application/config/routes.php" "$ROOT/application/modules/api_v1/controllers/Parking.php" "$ROOT/application/modules/api_v1/models/Parking_model.php" "$BACKUP/backend/"

WEB_RAW=https://raw.githubusercontent.com/ParkSwap-app/parkswap-website/main/static/app
API_RAW=https://raw.githubusercontent.com/ParkSwap-app/backend-api/master

for file in app.css app.js index.html sw.js; do
  curl -fsSL "$WEB_RAW/$file" -o "$TMP/$file"
  test -s "$TMP/$file"
done

curl -fsSL "$API_RAW/application/modules/api_v1/controllers/Parking.php" -o "$TMP/Parking.php"
curl -fsSL "$API_RAW/application/modules/api_v1/models/Parking_model.php" -o "$TMP/Parking_model.php"

grep -Fq 'activity-zones' "$TMP/app.js"
grep -Fq 'exploreCoords' "$TMP/app.js"
grep -Fq 'activity_zones_get' "$TMP/Parking.php"
grep -Fq 'community_activity_zones' "$TMP/Parking_model.php"
php -l "$TMP/Parking.php" >/dev/null
php -l "$TMP/Parking_model.php" >/dev/null

install -o www-data -g www-data -m 0644 "$TMP/app.css" "$APP/app.css"
install -o www-data -g www-data -m 0644 "$TMP/app.js" "$APP/app.js"
install -o www-data -g www-data -m 0644 "$TMP/index.html" "$APP/index.html"
install -o www-data -g www-data -m 0644 "$TMP/sw.js" "$APP/sw.js"
install -o www-data -g www-data -m 0644 "$TMP/Parking.php" "$ROOT/application/modules/api_v1/controllers/Parking.php"
install -o www-data -g www-data -m 0644 "$TMP/Parking_model.php" "$ROOT/application/modules/api_v1/models/Parking_model.php"

if ! grep -Fq "api/v1/parking/activity-zones" "$ROOT/application/config/routes.php"; then
  printf "\n\$route ['api/v1/parking/activity-zones']['get'] = 'api_v1/parking/activity_zones';\n" >> "$ROOT/application/config/routes.php"
fi

php -l "$ROOT/application/config/routes.php" >/dev/null
php -l "$ROOT/application/modules/api_v1/controllers/Parking.php" >/dev/null
php -l "$ROOT/application/modules/api_v1/models/Parking_model.php" >/dev/null
nginx -t

echo "PARKSWAP_RELEASE_OK backup=$BACKUP"
