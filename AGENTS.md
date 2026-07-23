# Cloud Agents для CRM АвтоПлан

Этот репозиторий настроен для **Cursor Cloud Agents** — фоновых ИИ-агентов, которые анализируют CRM, дают подсказки и помогают ставить задачи.

## Быстрый старт (5 шагов)

1. **API-ключ Cursor** — [cursor.com/dashboard](https://cursor.com/dashboard) → API Keys → создать ключ → сохранить в `.env` как `CURSOR_API_KEY` (только локально, не в git).

2. **Cloud Agents** — [cursor.com/dashboard?tab=cloud-agents](https://cursor.com/dashboard?tab=cloud-agents) → включить Cloud compute для автоматизаций.

3. **Правила в репозитории** — уже есть:
   - `docs/ADMIN-CRM.md` — полная карта CRM для администратора
   - `.cursor/rules/crm-admin.mdc` — правило AI для admin-задач
   - `.cursor/rules/crm-cloud-analyst.mdc` — как анализировать CRM
   - `.cursor/rules/fix-ide-errors.mdc` — чинить ошибки IDE сразу

4. **Шаблоны автоматизаций** — `docs/agents/workflows/*.yaml` → скопировать в Cursor Automations (см. [CLOUD-AGENTS-SETUP.md](docs/agents/CLOUD-AGENTS-SETUP.md)).

5. **Встроенный AI в CRM** — страница **AI-боты** (`/assistant`), кнопка «Сканировать» → `POST /api/ai/scan` → предложения в `ai_proposals`.

## Три агента «из коробки»

| Агент | Когда | Что делает |
|-------|-------|------------|
| **Утренний брифинг** | Пн–Пт 8:00 | Просроченные задачи, чаты без ответа, ЗН без движения |
| **Контроль ЗН** | Каждые 4 ч | Статусы цеха, запчасти, напоминания клиентам |
| **Follow-up входящих** | Каждый час | Горячие лиды, звонки без задачи |

Шаблоны: `docs/agents/workflows/`.

## Связь с кодом CRM

```
Cloud Agent (расписание)
    → читает репозиторий + AGENTS.md + rules
    → опционально: curl POST /api/ai/scan (с сессией админа)
    → отчёт в Slack / задачи в /tasks (вручную или через webhook)

Встроенные сканеры (без Cloud)
    → POST /api/ai/scan
    → ai_proposals → менеджер одобряет в /assistant
```

## Документация для новичка

- **4 агента разработки (QA, Code Fixer, Docs, Migration):** **[docs/agents/MULTI-AGENT-GUIDE.md](docs/agents/MULTI-AGENT-GUIDE.md)** — промпты в `.cursor/agents/`, вызов через `@crm-agent-qa` и т.д.
- **Умная техподдержка в CRM** (чат справа внизу, мультиагенты): **[docs/agents/SUPPORT-AGENTS-NOVICE.md](docs/agents/SUPPORT-AGENTS-NOVICE.md)**
- **Cursor Cloud Agents** (расписание, брифинги): **[docs/agents/CLOUD-AGENTS-SETUP.md](docs/agents/CLOUD-AGENTS-SETUP.md)**

## Переменные окружения

| Переменная | Назначение |
|------------|------------|
| `CURSOR_API_KEY` | Cloud Agents / SDK (вне git) |
| `AI_BASE_URL`, `AI_API_KEY`, `AI_MODEL` | Claude/OpenAI-compat для `/api/ai/*` и `npm run ai:consult` (приоритет над Yandex) |
| `YANDEX_API_KEY`, `YANDEX_FOLDER_ID` | Fallback GPT + Vision OCR |
| `AGENT_WEBHOOK_SECRET` | (опционально) защита webhook для автоматизаций |
