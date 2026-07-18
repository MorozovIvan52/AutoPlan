# AutoService CRM

CRM для **СТО** и **магазинов автозапчастей**: единый inbox, склад, заказы, авто клиентов, интеграция **Авито**.

## Для кого

- Магазин автозапчастей (розница и опт)
- СТО / автосервис
- Продавцы на Авито (запчасти, масла, аксессуары)

## Возможности

| Модуль | Что умеет |
|--------|-----------|
| **Inbox** | Все чаты (Авито, Telegram, WhatsApp, VK) в одном окне |
| **Авито** | Входящие с объявления → автозаказ, цена, ответ через API |
| **Авто клиента** | VIN, марка, модель — автоизвлечение VIN из чата |
| **Заказы** | Запчасти / СТО, воронка до «Отправлен» |
| **Склад** | Артикулы, остатки, цены, ячейки |
| **Быстрые ответы** | Шаблоны: VIN, наличие, оригинал/аналог, запись на СТО |
| **Клиенты** | Теги: Подбор по VIN, Оригинал, Аналог, Авито, Срочно… |
| **Аналитика** | Выручка, заказы с Авито, остатки склада |

## Локальная разработка

```bash
npm install
npm run db:push
npm run setup:prod
npm run dev
```

http://localhost:4200 — при пустой базе откроется **мастер настройки** (свой email и пароль).

Локально через CLI (только dev):
```bash
curl -X POST http://localhost:4200/api/seed -H "Content-Type: application/json" -d "{\"email\":\"admin@crm.local\",\"password\":\"admin123\"}"
```

## Продакшен: CRM всегда онлайн

> **Подробная инструкция для новичка** (куда нажимать, что вводить, примеры):  
> **[DEPLOY-GUIDE.md](./DEPLOY-GUIDE.md)**

Нужен **VPS** (Linux) с Node.js 20+, домен и HTTPS. Рекомендуемые провайдеры: Timeweb, Selectel, Beget VPS.

### 1. Подготовка сервера

```bash
# Ubuntu/Debian
sudo apt update && sudo apt install -y nodejs npm nginx certbot python3-certbot-nginx
sudo npm install -g pm2

# Скопируйте проект на сервер (git clone или scp)
cd /opt/crm
npm ci
cp .env.example .env
nano .env   # PUBLIC_URL=https://crm.ваш-домен.ru
```

### 2. База данных

CRM использует **SQLite** — один файл `crm.db`. Все данные (клиенты, чаты, заказы, записи на ремонт) хранятся в нём.

```bash
npm run db:push      # создать таблицы (первый раз)
npm run setup:prod   # миграции и проверка
npm run build        # собрать фронтенд в dist/
```

Первый админ — откройте `https://crm.ваш-домен.ru` и создайте учётную запись в мастере настройки.

Документ для продажи/внедрения: **[docs/COMMERCIAL-READINESS.md](./docs/COMMERCIAL-READINESS.md)**

**Бэкап** (ежедневно в cron):
```bash
cp /opt/crm/crm.db /opt/backups/crm-$(date +%F).db
```

Опционально вынести базу в отдельную папку:
```env
CRM_DB_PATH=/opt/crm/data/crm.db
```

### 3. Запуск 24/7 через PM2

```bash
npm run build
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup   # автозапуск после перезагрузки сервера
```

Проверка: `pm2 status`, логи: `pm2 logs crm`

> **Важно:** SQLite работает только с **одним** процессом CRM (`instances: 1` в PM2).

### 4. Nginx + HTTPS

```nginx
# /etc/nginx/sites-available/crm
server {
    listen 80;
    server_name crm.ваш-домен.ru;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name crm.ваш-домен.ru;

    ssl_certificate     /etc/letsencrypt/live/crm.ваш-домен.ru/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/crm.ваш-домен.ru/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:4200;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/crm /etc/nginx/sites-enabled/
sudo certbot --nginx -d crm.ваш-домен.ru
sudo nginx -t && sudo systemctl reload nginx
```

### 5. Операторы в работу

1. Войти как админ → **Настройки → Операторы**
2. Добавить каждого оператора (email + пароль, роль «Оператор»)
3. **Настройки → Каналы** — Авито, Telegram, WhatsApp
4. В `.env` указать `PUBLIC_URL=https://crm.ваш-домен.ru`
5. В кабинете Авито — webhook: `https://crm.ваш-домен.ru/api/webhooks/avito/avito_1`

Операторы заходят на `https://crm.ваш-домен.ru` со своими логинами.

### 6. Обновление версии

```bash
cd /opt/crm
git pull   # или загрузить новые файлы
npm ci
npm run setup:prod
npm run build
pm2 restart crm
```

## Подключение Авито (API)

1. [developers.avito.ru](https://developers.avito.ru/) → приложение → **Client ID** + **Client Secret**
2. Узнайте **User ID** аккаунта в Messenger API
3. **Настройки → Каналы → Авито** — вставьте ключи
4. Скопируйте **Webhook URL** (`/api/webhooks/avito/avito_1`)
5. В кабинете Авито укажите этот URL
6. В `.env` для продакшена:
   ```env
   PUBLIC_URL=https://ваш-домен.ru
   ```

При сообщении с объявления CRM автоматически:
- создаёт заказ с названием и ценой товара
- показывает блок «Авито» в чате
- сохраняет VIN из переписки в карточку авто

## Telegram

Настройки → Каналы → Bot Token. Webhook ставится автоматически.

## Стек

React 19 · Vite · Hono · SQLite · Drizzle · WebSocket
