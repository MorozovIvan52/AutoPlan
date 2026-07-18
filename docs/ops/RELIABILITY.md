# Надёжность CRM — как не допустить падений

Краткий чеклист после инцидентов (OOM, пустой экран, перегрузка).

## Почему падала раньше

| Причина | Что сделано |
|---------|-------------|
| `AVITO_POLL_INTERVAL_SECONDS=8` в `.env` | PM2/ecosystem: **120 с**, лимит чатов за цикл |
| Telegram polling каждую секунду | `TELEGRAM_POLLING_IN_APP=false` |
| Node без лимита памяти | `NODE_OPTIONS=--max-old-space-size=1536`, PM2 `max_memory_restart: 1700M` |
| Ошибка во фронте (ChatPanel) | Исправлена + деплой через CI |
| Нет мониторинга | `/api/health`, `/api/metrics` |

## 1. Зафиксировать настройки на VPS

**В `/opt/crm/.env` обязательно:**

```env
AVITO_POLL_INTERVAL_SECONDS=120
TELEGRAM_POLLING_IN_APP=false
AVITO_POLL_MAX_RECENT=40
```

> `.env` **перебивает** `ecosystem.config.cjs`. Если в `.env` снова поставить `8` — CRM снова ляжет.

Проверка:

```bash
bash /opt/crm/scripts/ops/verify-prod-env.sh
```

После правок: `pm2 restart crm --update-env`

## 2. PM2 — автоперезапуск

```bash
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup    # один раз
```

- `autorestart: true` — упал → поднялся
- `max_memory_restart: 1700M` — мягкий рестарт до OOM
- **Никогда** `instances > 1` с SQLite

## 3. Swap на сервере (страховка от OOM)

```bash
fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab
```

## 4. Мониторинг с алертом

1. **Uptime Kuma** (бесплатно, можно на том же VPS): монитор `https://crmavito.online/api/health` каждые 60 с.
2. Telegram-уведомление при 2–3 падениях подряд.
3. Раз в неделю: `pm2 logs crm --err --lines 50`

## 5. Ежедневный бэкап (Yandex Object Storage)

На VPS уже установлены `awscli`, скрипты в `/opt/crm/scripts/ops/`.

**Осталось один раз:** статический ключ SA → `.env` локально (`YC_S3_*`) → `npm run backup:setup-yandex`.

Подробно: [BACKUP-S3.md](./BACKUP-S3.md)

```bash
bash /opt/crm/scripts/ops/verify-prod-env.sh   # проверит cron и ключи
```

## 6. Деплой только через проверку

- Локально: `npm run build` перед выкладкой
- GitHub Actions: `.github/workflows/ci.yml` на каждый push
- Прод: `deploy-production.yml` или `npm run deploy:vps`
- После деплоя: `curl https://домен/api/health` и открыть `/login`

## 7. Не делать на проде

- ❌ `AVITO_POLL_INTERVAL_SECONDS` меньше 60
- ❌ Включать Telegram long polling без необходимости
- ❌ Запускать второй `npm run dev` / второй PM2 `crm`
- ❌ Редактировать `crm.db` вручную при работающем сервере
- ❌ Деплоить без `npm run setup:prod`

## 8. Если снова «висит»

```bash
ssh root@VPS
pm2 status
pm2 logs crm --lines 30 --err
free -h
curl -s http://127.0.0.1:4200/api/health
bash /opt/crm/scripts/ops/verify-prod-env.sh
pm2 restart crm --update-env
```

## 9. План на рост (SaaS)

- PostgreSQL вместо SQLite при >1 инстансе
- Отдельный worker для Avito poll (не в web-процессе)
- Redis + очередь для тяжёлых задач (OCR, рассылки)

См. также: [MONITORING.md](./MONITORING.md), [TELEMETRY.md](./TELEMETRY.md), [BACKUP-S3.md](./BACKUP-S3.md), [CICD.md](./CICD.md)

## 10. Стабильность UI (insertBefore / «Ошибка интерфейса»)

### Для операторов

1. **Ctrl+F5** — жёсткое обновление после деплоя (сброс кэша JS).
2. **Отключите автоперевод** страницы (Яндекс.Браузер, Google Translate) — он ломает DOM React.
3. Если снова «Ошибка интерфейса»:
   - нажмите **Повторить** в панели (список / чат) или обновите страницу;
   - **F12 → Console** — скопируйте текст ошибки и время, отправьте администратору.

### Что сделано в коде

- Порталы (модалки, уведомления, тосты, входящий звонок) — в `#crm-overlays`, не в `#root`.
- При живом WebSocket HTTP-polling **выключен**; при обрыве — 15 с.
- Ошибки React → `POST /api/client-errors` → `logs/client-errors.log` + Prometheus.
- Расхождение buildId → баннер + автообновление (см. [TELEMETRY.md](./TELEMETRY.md)).
- E2E-тест `e2e/inbox-stability.spec.ts` в CI ловит регрессию `insertBefore`.

### Для разработчика

```bash
npm run e2e:user          # тестовый пользователь (e2e@crm.local)
npm run test:e2e          # локально: сервер на :4200 должен быть запущен
```

Проверка порталов: `rg createPortal src` — все вызовы через `getPortalRoot()`.

Опционально в `.env`:

```env
CLIENT_ERROR_TELEGRAM_CHAT_ID=   # алерт в Telegram при insertBefore (раз в 10 мин)
```

## 11. «Сообщение в чате есть, в списке диалогов — старое»

**Причина:** рассинхрон `conversations.last_message_*` с реальным последним сообщением (poll перезаписывал превью старым).

**Профилактика в коде:** `api/lib/conv-preview.ts` — обновлять превью только если сообщение новее.

**Авто-лечение:** каждые 30 мин `conv-preview-reconcile` + метрика в `/api/health` (`previewDesync`, `status: degraded`).

**Перед сдачей клиенту:** [PRE-HANDOVER.md](./PRE-HANDOVER.md)

```bash
npm run repair:previews   # разовая починка
npm run audit:prod        # строгий аудит (exit 0 = ок)
npm run fix:demo          # полный цикл починки + аудит
```
