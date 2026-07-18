# Инструкция по деплою на VPS (Beget)

## Шаг 1: Подключиться к серверу через VNC-консоль

1. Откройте панель Beget: https://cp.beget.com
2. Перейдите в "Rightful Razlo" → **Терминал** (VNC консоль)
3. Введите пароль: `cH8&)XzxRp6B`

## Шаг 2: Подготовка сервера

Выполните эти команды в терминале сервера:

```bash
# Обновите систему
apt-get update && apt-get upgrade -y

# Установите Node.js 20+ (если ещё не установлен)
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs npm

# Установите PM2 глобально
npm install -g pm2

# Установите Git
apt-get install -y git

# Создайте директорию для приложения
mkdir -p /opt/crm
cd /opt/crm

# Установите Nginx (если ещё не установлен)
apt-get install -y nginx
systemctl enable nginx
systemctl start nginx
```

## Шаг 3: Загрузите код проекта

**Вариант А: Через Git (если репо публичный)**
```bash
cd /opt/crm
git clone https://github.com/ваш-юзер/ваш-репо.git .
npm ci
npm run build
```

**Вариант Б: Через scp с вашего компьютера (на вашем компьютере в Windows PowerShell)**
```powershell
# Убедитесь, что вы в корне проекта
cd c:\Users\1\Desktop\workspace-files (2)

# Загрузите фронтенд и API на сервер
scp -r dist root@159.194.207.50:/opt/crm/
scp -r api root@159.194.207.50:/opt/crm/
scp server.prod.ts root@159.194.207.50:/opt/crm/
scp ecosystem.config.cjs root@159.194.207.50:/opt/crm/
scp package.json root@159.194.207.50:/opt/crm/
scp package-lock.json root@159.194.207.50:/opt/crm/
```

## Шаг 4: Установите зависимости на сервере

```bash
cd /opt/crm
npm ci --omit=dev
```

## Шаг 5: Создайте файл .env для продакшена

На сервере создайте файл `/opt/crm/.env`:

```bash
cat > /opt/crm/.env << 'EOF'
NODE_ENV=production
PORT=4200
PUBLIC_URL=https://159.194.207.50
CRM_DB_PATH=/opt/crm/crm.db

# Security
INSTALL_SECRET=your-secret-key-here
TENANT_REGISTER_SECRET=your-register-key-here
AUTH_SALT=crm_salt_2024

# Интеграции (оставьте пустыми, если не используете)
TELEGRAM_BOT_TOKEN=
AVITO_API_BASE=https://api.avito.ru
YANDEX_API_KEY=
YANDEX_FOLDER_ID=

# Настройки мультитенантности
TENANT_BASE_DOMAIN=159.194.207.50
DEFAULT_TENANT_SUBDOMAIN=default
DEFAULT_TENANT_NAME=АвтоПлан

# Лимиты загрузок
CRM_UPLOAD_MAX_MB=8
CRM_VIDEO_MAX_MB=24
CRM_DOC_MAX_MB=20

# Мониторинг
METRICS_TOKEN=your-metrics-token

# Polling
AVITO_POLL_ENABLED=false
TELEGRAM_POLLING_IN_APP=true
AVITO_POLL_INTERVAL_SECONDS=120
EOF
```

## Шаг 6: Инициализируйте базу данных

```bash
cd /opt/crm
npm run setup:prod
```

## Шаг 7: Запустите приложение через PM2

```bash
cd /opt/crm
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup
```

Скопируйте команду, которую выведёт `pm2 startup`, и выполните её (она будет примерно такой):
```bash
sudo env PATH=$PATH:/usr/bin /usr/lib/node_modules/pm2/bin/pm2 startup systemd -u root --hp /root
```

## Шаг 8: Настройте Nginx как reverse proxy

Создайте файл конфига Nginx:

```bash
cat > /etc/nginx/sites-available/crm << 'EOF'
upstream crm_backend {
  server localhost:4200;
  keepalive 64;
}

server {
  listen 80;
  listen [::]:80;
  server_name 159.194.207.50;

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

  location /api/webhooks {
    proxy_pass http://crm_backend;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    client_max_body_size 100M;
  }
}
EOF
```

Активируйте конфиг:

```bash
ln -sf /etc/nginx/sites-available/crm /etc/nginx/sites-enabled/crm
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl restart nginx
```

## Шаг 9: Проверьте, что всё работает

```bash
# Статус PM2
pm2 status

# Проверьте логи
pm2 logs crm --lines 50

# Проверьте здоровье приложения
curl http://localhost:4200/api/health

# Проверьте через Nginx
curl http://159.194.207.50/api/health
```

## Шаг 10: Первая регистрация администратора

Откройте в браузере: http://159.194.207.50

Пройдите регистрацию администратора. Позже вы сможете настроить HTTPS через Certbot.

---

## Дополнительно: Настройка HTTPS через Let's Encrypt

```bash
apt-get install -y certbot python3-certbot-nginx
certbot --nginx -d 159.194.207.50
```

## Дополнительно: Ограничение загрузок в Nginx

Если нужно увеличить лимит для видео:

```bash
echo 'client_max_body_size 100M;' >> /etc/nginx/nginx.conf
nginx -t
systemctl restart nginx
```

## Troubleshooting

### Приложение упало
```bash
pm2 logs crm
pm2 restart crm
```

### База данных повреждена
```bash
rm /opt/crm/crm.db
npm run setup:prod
pm2 restart crm
```

### Nginx не подключается к приложению
```bash
curl http://localhost:4200/api/health
ps aux | grep tsx
```
