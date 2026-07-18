# Инфраструктура: PostgreSQL, PM2, Nginx, Certbot

## Быстрая установка (Ubuntu 22.04+)

```bash
DOMAIN=crm.example.ru APP_DIR=/opt/crm bash scripts/ops/install-server-stack.sh
```

Скрипт устанавливает: Node 20, PM2, Nginx, Certbot, PostgreSQL, AWS CLI, UFW, logrotate.

## PM2

```bash
cd /opt/crm
npm ci && npm run build && npm run setup:prod
mkdir -p logs
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup systemd -u root --hp /root
```

Конфиг: `ecosystem.config.cjs` — 1 инстанс (SQLite), лимит памяти 1700M, логи в `logs/`.

## Nginx

Файл: `/etc/nginx/sites-available/crm`

- Прокси на `127.0.0.1:4200`
- WebSocket для `/api/ws`
- `client_max_body_size 50m` (видео/файлы)
- `/api/metrics` — только localhost

```bash
nginx -t && systemctl reload nginx
```

## Certbot (SSL)

```bash
certbot --nginx -d crm.example.ru -d www.crm.example.ru
certbot renew --dry-run
```

Автопродление: systemd timer `certbot.timer`.

## PostgreSQL

> **Важно:** текущая версия CRM работает на **SQLite**. PostgreSQL устанавливается для будущей мультитенант-SaaS и смежных сервисов.

```bash
sudo -u postgres psql -c "\l"
```

Параметры по умолчанию из `install-server-stack.sh`:

- БД: `crm`
- Пользователь: `crm`
- URL: `postgresql://crm:ПАРОЛЬ@127.0.0.1:5432/crm`

### Миграция SQLite → PostgreSQL (план)

1. Добавить `drizzle` dialect `postgresql` и `DATABASE_URL`.
2. Экспорт: `sqlite3 crm.db .dump` → конвертация типов.
3. Тест на staging, cutover в окно обслуживания.
4. Отдельный документ — при старте мультитенанта.

## Firewall

```bash
ufw allow OpenSSH
ufw allow 'Nginx Full'
ufw enable
```

Порт **4200** не открывать наружу — только через Nginx.

## Структура на сервере

```
/opt/crm/
  crm.db          # SQLite (бэкапить ежедневно)
  uploads/        # медиа
  data/           # zzap и прочее
  dist/           # фронтенд
  logs/           # PM2
  .env            # секреты (не в git)
```

## Обновление

Ручное: `npm run deploy:vps` (Windows) или GitHub Actions (см. CICD.md).

После обновления:

```bash
npm run setup:prod
pm2 restart crm
curl -s http://127.0.0.1:4200/api/health
```
