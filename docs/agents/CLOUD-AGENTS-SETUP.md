# Cloud Agents для CRM АвтоПлан — инструкция для новичка

Как подключить **Cursor Cloud Agents**, чтобы они регулярно анализировали CRM, давали подсказки менеджерам и помогали ставить задачи.

---

## Что это и зачем

| Инструмент | Где живёт | Задача |
|------------|-----------|--------|
| **AI-боты в CRM** (`/assistant`) | Ваш сервер | Сканирует чаты/сделки, предлагает ответы клиентам |
| **Cloud Agent** | Cursor (облако) | Читает код + логику CRM, пишет отчёты, чеклисты задач |
| **Automation** | Cursor Automations | Запускает агента по расписанию или webhook |

Cloud Agent **не заменяет** встроенный `/api/ai/scan` — они дополняют друг друга:
- `/api/ai/scan` — быстрые **предложения ответов** в чат (Yandex GPT).
- Cloud Agent — **стратегический разбор**: просрочки, воронка, ЗН, склад, что поручить команде.

---

## Шаг 0. Что должно быть готово

- [ ] Репозиторий CRM в GitHub/GitLab (Cloud Agent клонирует репо).
- [ ] Работающий CRM (`npm run dev` или прод на VPS).
- [ ] Аккаунт Cursor с доступом к **Cloud Agents** ([dashboard](https://cursor.com/dashboard?tab=cloud-agents)).
- [ ] (Рекомендуется) Yandex GPT в `.env` для `/assistant` — см. `/api/ai/status`.

---

## Шаг 1. API-ключ Cursor

1. Откройте [cursor.com/dashboard](https://cursor.com/dashboard) → **Integrations** / **API Keys**.
2. Создайте ключ → скопируйте один раз.
3. Локально в `.env` (файл **не коммитить**):

```env
CURSOR_API_KEY=ваш_ключ_здесь
```

4. На VPS для cron-скриптов — тот же ключ в `/etc/crm/.env` или secrets менеджера.

---

## Шаг 2. Правила в репозитории (уже добавлены)

В проекте лежат файлы, которые Cursor подхватывает автоматически:

| Файл | Назначение |
|------|------------|
| `AGENTS.md` | Карта агентов и связь с API |
| `.cursor/rules/crm-cloud-analyst.mdc` | Как анализировать CRM, формат отчёта |
| `.cursor/rules/fix-ide-errors.mdc` | Чинить ошибки IDE сразу |

**Ничего настраивать не нужно** — закоммитьте эти файлы в main, Cloud Agent увидит их при клонировании.

---

## Шаг 3. Создать первую автоматизацию (утренний брифинг)

### 3.1 Откройте Automations

Cursor → **Agents** → **Automations** → **New automation**.

Или: [cursor.com/automations](https://cursor.com/automations) (если доступно в вашем плане).

### 3.2 Триггер

- Тип: **On a schedule**
- Расписание: `0 8 * * 1-5` (будни в 8:00 по времени сервера Cursor; уточните часовой пояс в UI).

### 3.3 Репозиторий

- **Repository**: этот репозиторий (`crm-platform` / ваш fork).
- **Branch**: `main` (или ваша рабочая ветка).

### 3.4 Инструкция агенту (скопируйте в поле Prompt)

```text
Ты — CRM Cloud Analyst для автосервиса АвтоПлан.

Прочитай AGENTS.md и .cursor/rules/crm-cloud-analyst.mdc.

Проанализируй код и опиши, что менеджеру СТО проверить СЕГОДНЯ:
1. Входящие без ответа (api/lib/ai-scanners.ts, chat-sla.ts)
2. Заказ-наряды без движения > 2 дней (deals, orderType=service)
3. Записи на сервис на сегодня (service_appointments)
4. Склад: позиции с qty=0 при активных ЗН (parts_stock, stock-reserve)
5. Задачи просроченные (api/routes/tasks.ts overdue-summary)

Формат ответа:
## Срочно сегодня (таблица)
## Задачи для постановки в CRM (title, роль, срок)
## Что запустить в UI: /assistant → Сканировать

Не выдумывай данные — если нужны живые цифры, укажи какой API endpoint вызвать на проде.
```

### 3.5 Модель и Cloud

- Модель: **Composer** или **Claude** (по тарифу).
- **Cloud compute**: включить в [Cloud Agents dashboard](https://cursor.com/dashboard?tab=cloud-agents).

### 3.6 Куда слать результат (опционально)

- **Slack** — канал `#crm-daily` (подключите Slack в Integrations).
- Или только email/история запусков в Cursor.

Сохраните автоматизацию и нажмите **Test run**.

---

## Шаг 4. Готовые шаблоны workflow

В папке `docs/agents/workflows/` три YAML-шаблона:

| Файл | Расписание | Смысл |
|------|------------|-------|
| `crm-morning-briefing.yaml` | Пн–Пт 8:00 | Утренний брифинг |
| `sto-work-orders-review.yaml` | Каждые 4 часа | Контроль заказ-нарядов |
| `inbox-follow-up.yaml` | Каждый час | Входящие и follow-up |

Как использовать:
1. Откройте файл в редакторе.
2. В Automations → **Import** / вставьте содержимое (или перенесите поля вручную по таблице в файле).
3. Укажите свой репозиторий и Slack-канал.

---

## Шаг 5. Встроенный AI в CRM (без Cloud)

Это работает **сразу** на вашем сервере:

1. Настройте `.env`:
   ```env
   YANDEX_API_KEY=...
   YANDEX_FOLDER_ID=...
   ```
2. Войдите в CRM как админ → **AI-боты** (`/assistant`).
3. Нажмите **«Сканировать CRM»** — вызовется `POST /api/ai/scan`.
4. Появятся карточки-предложения: ответ клиенту, запись, follow-up.
5. Менеджер **редактирует → одобряет** — текст уходит в чат.

Для автоматизации на сервере (cron):

```bash
# Пример: раз в час сканировать (нужна cookie/токен сессии админа — лучше через UI или будущий API key)
curl -X POST https://ваш-домен.ru/api/ai/scan \
  -H "Cookie: session=..." \
  -H "Content-Type: application/json"
```

> Полноценный cron через API-ключ тенанта — в roadmap; пока удобнее Cloud Agent + ручное «Сканировать» утром.

---

## Шаг 6. Как агент «ставит задачи»

Сейчас три уровня:

### Уровень A — Рекомендации в отчёте (сразу)

Cloud Agent пишет таблицу «поставьте задачу X менеджеру Y до Z» — менеджер вносит в **Задачи** (`/tasks`).

### Уровень B — AI proposals (автоматически)

`POST /api/ai/scan` создаёт записи в `ai_proposals` — видны в `/assistant`, не в общем списке задач.

### Уровень C — Webhook (для продвинутых)

Шаблон `inbox-follow-up.yaml` может дергать webhook вашего CRM (когда добавите endpoint `POST /api/agent/tasks` с `AGENT_WEBHOOK_SECRET`).

Пока используйте **A + B**.

---

## Шаг 7. Чеклист «всё работает»

- [ ] Test run автоматизации завершился без ошибки.
- [ ] В отчёте есть разделы «Срочно» и «Задачи».
- [ ] `/assistant` → Сканировать → `created > 0` (если есть данные в CRM).
- [ ] `/api/ai/status` → `configured: true` (если нужен Yandex).
- [ ] Правила `.cursor/rules/` в ветке, которую читает Cloud Agent.

---

## Частые ошибки

| Проблема | Решение |
|----------|---------|
| Agent не видит репо | Проверьте доступ GitHub в Cursor Integrations |
| Пустой отчёт | Укажите в prompt конкретные пути (`api/lib/ai-scanners.ts`) |
| Нет Cloud compute | Включите в dashboard → Cloud Agents |
| AI-боты пустые | Проверьте `YANDEX_API_KEY` и `YANDEX_FOLDER_ID` |
| Ошибки SQL в IDE | Используйте `*.pgsql`, не `*.sql` для PostgreSQL |

---

## Следующие шаги (по желанию)

1. Slack-канал `#sto-alerts` для утреннего брифинга.
2. Второй агент — только заказ-наряды (`sto-work-orders-review.yaml`).
3. API-ключ тенанта для `POST /api/ai/scan` без UI (cron на VPS).
4. Webhook создания задач из отчёта агента.

Вопросы по настройке — откройте чат в Cursor с `@AGENTS.md` и попросите помочь с конкретной автоматизацией.
