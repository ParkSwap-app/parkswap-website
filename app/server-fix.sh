#!/usr/bin/env bash
set -euo pipefail

nginx_config=/etc/nginx/sites-enabled/default
snippet=/etc/nginx/snippets/parkswap-api.conf
stamp=$(date +%Y%m%d-%H%M%S)
backup_dir=/var/backups/parkswap-api-routing-$stamp

mkdir -p "$backup_dir"
cp "$nginx_config" "$backup_dir/default"

cat > "$snippet" <<'NGINX'
location ^~ /api/ {
    if ($request_method = OPTIONS) {
        add_header Access-Control-Allow-Origin "https://parkswap.com" always;
        add_header Access-Control-Allow-Methods "GET, POST, OPTIONS" always;
        add_header Access-Control-Allow-Headers "Content-Type, Authorization, Device-Type, Device-Id, Device-Token, Timezone, Language" always;
        add_header Access-Control-Max-Age 86400 always;
        return 204;
    }

    include fastcgi_params;
    fastcgi_param SCRIPT_FILENAME /var/www/html/backend-api/index.php;
    fastcgi_param SCRIPT_NAME /index.php;
    fastcgi_param PATH_INFO $uri;
    fastcgi_param REQUEST_URI $request_uri;
    fastcgi_param HTTP_HOST $host;
    fastcgi_pass unix:/run/php/php7.4-fpm.sock;

    add_header Access-Control-Allow-Origin "https://parkswap.com" always;
    add_header Access-Control-Allow-Methods "GET, POST, OPTIONS" always;
    add_header Access-Control-Allow-Headers "Content-Type, Authorization, Device-Type, Device-Id, Device-Token, Timezone, Language" always;
    add_header Vary "Origin" always;
}
NGINX

python3 - "$nginx_config" <<'PY'
from pathlib import Path
import sys

path = Path(sys.argv[1])
text = path.read_text()
text = text.replace("server_name parkswap.com;", "server_name parkswap.com old.parkswap.com;")
text = text.replace("/etc/letsencrypt/live/parkswap.com", "/etc/letsencrypt/live/old.parkswap.com")
include = "\tinclude /etc/nginx/snippets/parkswap-api.conf;\n\n"
if include.strip() not in text:
    marker = "\tlocation / {"
    if marker not in text:
        raise SystemExit("Could not find the ParkSwap HTTPS location block")
    text = text.replace(marker, include + marker, 1)
path.write_text(text)
PY

nginx -t
systemctl reload nginx
systemctl is-active --quiet nginx
echo "parkswap-api-ready"
