# Мониторинг: аптайм, логи, метрики

## Health-check

| Endpoint | Назначение |
|----------|------------|
| `GET /api/health` | JSON: статус, uptime, БД, память, **buildId**, service |
| `GET /api/metrics` | Prometheus text format (+ UI телеметрия) |

Пример:

```bash
curl -s https://crm.ваш-домен.ru/api/health | jq
bash scripts/ops/health-check.sh https://crm.ваш-домен.ru/api/health
```

### Переменные

```env
METRICS_TOKEN=случайная_строка_32_символа
```

Запрос метрик: `Authorization: Bearer TOKEN` или `?token=TOKEN`.  
В Nginx `/api/metrics` ограничен `127.0.0.1` (см. `install-server-stack.sh`).

## Внешний аптайм (Uptime Kuma / Better Stack / Hetrix)

1. Создайте HTTP(s) монитор на `https://домен/api/health`.
2. Интервал: **60 сек**, таймаут: **15 сек**.
3. Ожидаемый ответ: JSON с `"status":"ok"`, HTTP 200.
4. Уведомления: Telegram, email, SMS.

Рекомендуемый второй монитор: главная страница `/login` (проверка фронтенда).

## Логи PM2

```bash
pm2 logs crm --lines 100
pm2 logs crm --err
tail -f /opt/crm/logs/crm-out.log
```

Ротация: `pm2 install pm2-logrotate` (настраивается в `install-server-stack.sh`).

## Метрики Prometheus + Grafana (опционально)

`prometheus.yml` фрагмент:

```yaml
scrape_configs:
  - job_name: crm
    static_configs:
      - targets: ["127.0.0.1:4200"]
    metrics_path: /api/metrics
    bearer_token: "ВАШ_METRICS_TOKEN"
```

Алерты: `crm_up == 0`, `crm_heap_used_bytes` > 1.4e9, `crm_uptime_seconds` сбросился (рестарт), **`crm_error_boundary_recent_5m` > 10** (см. [TELEMETRY.md](./TELEMETRY.md)).

## Алерты в Telegram

Скрипт cron каждые 5 мин:

```bash
*/5 * * * * /opt/crm/scripts/ops/health-check.sh https://127.0.0.1:4200/api/health || curl -s "https://api.telegram.org/bot$TOKEN/sendMessage" -d chat_id=$CHAT -d text="CRM health FAIL"
```

## Дашборд для оператора

- PM2: `pm2 monit`
- Диск: `df -h`, размер `crm.db` в `/api/health`
- Nginx: `/var/log/nginx/access.log`, `error.log`

## Sentry (ошибки + биллинг)

```env
SENTRY_DSN=https://xxx@xxx.ingest.sentry.io/xxx
SENTRY_ENVIRONMENT=production
VITE_SENTRY_DSN=https://xxx@xxx.ingest.sentry.io/xxx
```

Автоматически отправляются:

- `payment_failed` — неудачный платёж Stripe
- `webhook_error` — ошибка обработки Stripe webhook
- `bootstrap_failed` — сбой SaaS bootstrap при старте

В Sentry Dashboard настройте алерты на:

- `billing:payment_failed`
- `billing:webhook_error`
- Spike 5xx на `/api/*`

## Чеклист продакшена

- [ ] Uptime монитор на `/api/health`
- [ ] `SENTRY_DSN` + `VITE_SENTRY_DSN` заданы
- [ ] `METRICS_TOKEN` задан
- [ ] PM2 logrotate включён
- [ ] Алерт при падении PM2 (`pm2 startup` + systemd)
- [ ] Телеметрия UI: см. [TELEMETRY.md](./TELEMETRY.md)
- [ ] Ежедневный бэкап S3 (см. BACKUP-S3.md)
