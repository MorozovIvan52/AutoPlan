#!/usr/bin/env bash
# Nginx + .env для demo-поддоменов sto1/sto2/sto3.crmavito.online
set -euo pipefail

BASE_DOMAIN="${TENANT_BASE_DOMAIN:-crmavito.online}"
APP_DIR="${APP_DIR:-/opt/crm}"
SUBS=(sto1 sto2 sto3)

cd "$APP_DIR"

# .env: базовый домен для резолва tenant по Host
if grep -q '^TENANT_BASE_DOMAIN=' .env 2>/dev/null; then
  sed -i "s|^TENANT_BASE_DOMAIN=.*|TENANT_BASE_DOMAIN=${BASE_DOMAIN}|" .env
else
  echo "TENANT_BASE_DOMAIN=${BASE_DOMAIN}" >> .env
fi

SERVER_NAMES="$BASE_DOMAIN www.$BASE_DOMAIN"
for s in "${SUBS[@]}"; do
  SERVER_NAMES="$SERVER_NAMES ${s}.${BASE_DOMAIN}"
done

NGINX="/etc/nginx/sites-available/crm"
SSL_CERT="/etc/letsencrypt/live/${BASE_DOMAIN}/fullchain.pem"
SSL_KEY="/etc/letsencrypt/live/${BASE_DOMAIN}/privkey.pem"

if [[ -f "$SSL_CERT" && -f "$SSL_KEY" ]]; then
  cat > "$NGINX" <<EOF
server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name ${SERVER_NAMES};

    ssl_certificate ${SSL_CERT};
    ssl_certificate_key ${SSL_KEY};
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;

    client_max_body_size 50m;

    location / {
        proxy_pass http://127.0.0.1:4200;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 86400;
    }
}

server {
    listen 80;
    listen [::]:80;
    server_name ${SERVER_NAMES};
    client_max_body_size 50m;
    return 301 https://\$host\$request_uri;
}
EOF
else
  cat > "$NGINX" <<EOF
server {
    listen 80;
    listen [::]:80;
    server_name ${SERVER_NAMES};
    client_max_body_size 50m;

    location / {
        proxy_pass http://127.0.0.1:4200;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 86400;
    }
}
EOF
fi

ln -sf "$NGINX" /etc/nginx/sites-enabled/crm
nginx -t
systemctl reload nginx

echo "OK nginx: ${SERVER_NAMES}"
echo "DNS A-записи (Beget → crmavito.online):"
for s in "${SUBS[@]}"; do
  echo "  ${s}.${BASE_DOMAIN} → $(curl -s ifconfig.me 2>/dev/null || echo VPS_IP)"
done
