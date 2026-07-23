# Статус продолжения — 2026-07-22 12:52

## CURSOR_API_KEY
В `.env` добавлена пустая строка `CURSOR_API_KEY=` — **значение всё ещё пустое**.
Пока ключ не вставлен, Cursor Cloud Automations / `npm run agent:cloud-briefing` не запустятся.

Где взять: https://cursor.com/dashboard → API Keys → Create.

## Сделано без Cursor Cloud (уже на проде)
| Шаг | Результат |
|-----|-----------|
| AI_* (Claude) залиты на VPS `/opt/crm/.env` | OK |
| Задеплоены `api/lib/llm.ts` + `api/routes/ai.ts` | OK |
| `pm2 restart crm` | OK |
| `GET /api/ai/status` на sto1 | **configured:true, provider:openai-compat, model:claude-opus-4-8** |
| `POST /api/ai/scan` | OK (`created:0` — мало триггеров в demo) |

## Команды после вставки ключа
```bash
npm run agent:cloud-briefing
npm run agent:workflows
```
