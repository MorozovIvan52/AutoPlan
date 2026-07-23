# РЕЗУЛЬТАТЫ ПРОВЕРКИ АГЕНТОВ — 2026-07-22

## Что сделано автоматически

| Шаг | Результат |
|-----|-----------|
| Unit tests локально | **14/14 PASS** |
| `pilot:verify` на VPS `/opt/crm` | **PASS** (tenant isolation 403, race stock OK, chat, PDF) |
| Поддомены sto1/2/3 | **HTTP 200**, DNS → 159.194.207.50 |
| YAML workflows → AI-прогон | **3/3 OK** → `docs/agents/reports/2026-07-22T09-37-41_*.md` |
| Восстановлен `scripts/ai-consult.ts` | OK |
| Команда `npm run agent:workflows` | добавлена |

## Cursor Cloud Automations (YAML в dashboard)

**НЕ созданы в Cursor Cloud** — в `.env` **нет `CURSOR_API_KEY`**.

Без ключа нельзя:
- зарегистрировать Automations в cursor.com
- запустить `agent --api-key` / `@cursor/sdk` Cloud

**Что нужно от тебя (1 минута):**  
[cursor.com/dashboard](https://cursor.com/dashboard) → API Keys → создать → вставить в `.env`:

```env
CURSOR_API_KEY=...
```

После этого скажи «продолжай» — дожму создание автоматизаций / cloud run.

## Замена прямо сейчас (уже работает)

Прогнаны промпты из трёх YAML через `AI_API_KEY` (Claude-compat):

- `docs/agents/reports/2026-07-22T09-37-41_crm-morning-briefing.md`
- `docs/agents/reports/2026-07-22T09-37-41_inbox-follow-up.md`
- `docs/agents/reports/2026-07-22T09-37-41_sto-work-orders-review.md`
- сводка: `..._SUMMARY.md`

Повтор: `npm run agent:workflows`

## Прод AI `/api/ai/*`

| Проверка | Результат |
|----------|-----------|
| Login `admin@sto1.demo` на sto1 | OK |
| `GET /api/ai/status` | `configured: true`, **`liveOk: false`** |
| Причина | Yandex: нет роли `ai.languageModels.user` на каталог |
| `POST /api/ai/scan` | OK технически: `scanned:0, created:0, chatCount:1` |

Сканер отрабатывает, но живой GPT на проде сейчас **сломана IAM-ролью Yandex**. Локально для отчётов агентов использован `AI_API_KEY` (Claude-compat) — это работает.

## Cursor Cloud Automations (YAML в dashboard)

**НЕ созданы в Cursor Cloud** — в `.env` **нет `CURSOR_API_KEY`**.

Без ключа нельзя зарегистрировать Automations / Cloud Agent CLI.

**Что нужно (1 минута):** создать ключ на [cursor.com/dashboard](https://cursor.com/dashboard) → в `.env`:

```env
CURSOR_API_KEY=...
```

Скажи «продолжай» — дожму Cloud Automations.

## Итог для дедлайна

| Нужно было | Статус |
|------------|--------|
| Результаты проверки CRM/пилота | **PASS** |
| Отчёты утренний / ЗН / inbox | **Есть** в `docs/agents/reports/` |
| `/api/ai/scan` на проде | **Вызван**, proposals=0; Yandex live сломан (IAM) |
| Cloud Automations 24/7 Cursor | **Блокер: CURSOR_API_KEY** |
