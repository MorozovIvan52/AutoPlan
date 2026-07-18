# Чеклист перед сдачей CRM клиенту

Используйте этот список **за день до** и **в день** передачи системы другому автосервису.

## Честно о «всех багах»

100% автоматического обнаружения любых багов не существует. Мы закрываем риски так:

| Уровень | Что делает |
|--------|------------|
| **Профилактика** | Исправление в коде (как `conv-preview.ts` — не перезаписывать превью старым сообщением) |
| **Авто-лечение** | Каждые 30 мин `conv-preview-reconcile` чинит рассинхрон превью; при старте — `unread-reconcile` |
| **Мониторинг** | `/api/health` → `status: degraded` если `previewDesync > 0`; Prometheus `crm_preview_desync` |
| **Аудит** | `npm run fix:demo` → починка + `npm run audit:prod` |
| **E2E** | Playwright inbox-stability в CI |
| **Клиент** | `POST /api/client-errors` — ошибки React в БД |

## Kvatronet (crmavito.online) — перед демо завтра

На VPS из `/opt/crm`:

```bash
cd /opt/crm
npm run fix:demo          # клиенты, системные SMS, превью, unread, аудит
npm run audit:prod        # строгий чеклист (должен exit 0)
curl -s https://crmavito.online/api/health | jq .
```

Ожидаемый health: `"status":"ok"`, `"previewDesync":0`.

После деплоя локальных правок:

```powershell
npm run deploy:vps
npm run vps:run -- "cd /opt/crm && npm run fix:demo && npm run audit:prod"
```

## Новый клиент (отдельный VPS, пустая база)

1. `npm run pack:client` → zip без `crm.db` и `.env`
2. На сервере клиента: `.env` из `scripts/templates/client-env.example`
3. `npm run setup:prod` — админ, каналы из env
4. Avito: `npx tsx scripts/setup-avito-webhooks.ts`
5. `npm run audit:prod` — все зелёное
6. Оператор: Ctrl+F5, тестовое сообщение с Avito → видно в inbox за &lt;2 мин (webhook) или до `AVITO_POLL_INTERVAL_SECONDS`

Не копировать `crm.db` Kvatronet на инстанс клиента.

## Что проверяет `audit:prod`

- API health (HTTPS `PUBLIC_URL`)
- Токены Avito по всем активным каналам
- `webhookSecret` на каждом Avito-канале
- Рассинхрон превью диалогов (= «SMS есть в чате, в списке не видно»)
- Корзинные клиенты Avito, системные SMS, шаблоны, пользователи
- `PUBLIC_URL` https, webhook secrets на Avito

## Если audit падает

| Проблема | Команда |
|----------|---------|
| Рассинхрон превью | `npm run repair:previews` |
| Системные SMS как client | `npx tsx scripts/repair-avito-system-sender.ts` |
| Корзинные клиенты | `npx tsx scripts/repair-avito-clients.ts` |
| Непрочитанные | `npm run fix:demo` |
| Нет webhook secret | `.env` + `setup-avito-webhooks.ts` + `pm2 restart crm` |

## Алерт в Telegram

При рассинхроне превью после авто-ремонта остаётся &gt;0 — раз в час уходит сообщение в Telegram (если настроен `ADVANCE_ALERT_TELEGRAM_*`).

## Ручной smoke-test (5 минут)

1. Вход в CRM, inbox открывается без ошибок в консоли
2. Отправить тест с Avito → ответ из CRM → видно на Avito
3. Список диалогов: последнее сообщение совпадает с чатом
4. Настройки → каналы: все активные зелёные
5. Печать/заказ-наряд — если нужен клиенту, проверить отдельно (UI печати может быть в backlog)
