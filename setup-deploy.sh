#!/bin/bash
# Автоматический деплой CRM на VPS Beget
# Запустите в /opt/crm: bash setup-deploy.sh

set -e

echo "=========================================="
echo "CRM Deployment Script"
echo "=========================================="

# Обновление системы
echo "[1/10] Обновление системы..."
apt-get update -qq
apt-get upgrade -y -qq

# Node.js
echo "[2/10] Проверка Node.js..."
if ! command -v node &> /dev/null; then
  echo "Устанавливаю Node.js 20..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi
echo "Node: $(node --version)"
echo "npm: $(npm --version)"

# PM2
echo "[3/10] Устанавливаю PM2..."
npm install -g pm2 --silent

# Git
echo "[4/10] Устанавливаю Git..."
apt-get install -y git -qq

# Nginx
echo "[5/10] Устанавливаю Nginx..."
if ! command -v nginx &> /dev/null; then
  apt-get install -y nginx -qq
  systemctl enable nginx
  systemctl start nginx
fi

# Зависимости Node
echo "[6/10] Установка npm зависимостей..."
npm ci --omit=dev --silent

# .env файл
echo "[7/10] Создание .env..."
cat > .env << 'ENVEOF'
NODE_ENV=production
PORT=4200
PUBLIC_URL=https://159.194.207.50
CRM_DB_PATH=/opt/crm/crm.db

INSTALL_SECRET=crm_install_$(date +%s)
TENANT_REGISTER_SECRET=crm_register_$(date +%s)
AUTH_SALT=crm_salt_2024

TENANT_BASE_DOMAIN=159.194.207.50
DEFAULT_TENANT_SUBDOMAIN=default
DEFAULT_TENANT_NAME=АвтоПлан

CRM_UPLOAD_MAX_MB=8
CRM_VIDEO_MAX_MB=24
CRM_DOC_MAX_MB=20

AVITO_POLL_ENABLED=false
TELEGRAM_POLLING_IN_APP=true
AVITO_POLL_INTERVAL_SECONDS=120

METRICS_TOKEN=metrics_$(date +%s)
ENVEOF

echo "✓ .env создан"

# База данных
echo "[8/10] Инициализация БД..."
npm run setup:prod

# PM2 конфиг
echo "[9/10] Запуск приложения через PM2..."
pm2 delete crm 2>/dev/null || true
pm2 start ecosystem.config.cjs
pm2 save

# Nginx конфиг
echo "[10/10] Настройка Nginx..."
cat > /etc/nginx/sites-available/crm << 'NGINXEOF'
upstream crm_backend {
  server localhost:4200;
  keepalive 64;
}

server {
  listen 80;
  listen [::]:80;
  server_name _;

  client_max_body_size 100M;

  location / {
    proxy_pass http://crm_backend;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_buffering off;
    proxy_request_buffering off;
    proxy_read_timeout 86400;
    proxy_send_timeout 86400;
  }
}
NGINXEOF

rm -f /etc/nginx/sites-enabled/default
ln -sf /etc/nginx/sites-available/crm /etc/nginx/sites-enabled/crm
nginx -t
systemctl restart nginx

echo ""
echo "=========================================="
echo "✓ Деплой завершён!"
echo "=========================================="
echo ""
echo "Приложение доступно: http://159.194.207.50"
echo ""
echo "Полезные команды:"
echo "  pm2 status          — статус приложения"
echo "  pm2 logs crm        — логи приложения"
echo "  pm2 restart crm     — перезапуск"
echo ""
echo "Следующие шаги:"
echo "  1. Откройте http://159.194.207.50 в браузере"
echo "  2. Создайте администратора"
echo "  3. (Опционально) Настройте HTTPS: certbot --nginx -d 159.194.207.50"
echo ""
