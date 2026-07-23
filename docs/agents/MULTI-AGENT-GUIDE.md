# Мультиагентная система CRM «АвтоПлан» — инструкция для новичка

## Главное: как это работает (без магии)

**Агенты — это не роботы на сервере 24/7.** Это **роли в Cursor**, которые ты вызываешь в чате.

```
Ты → @crm-agent-qa + задача
  → агент читает правила + код + (опционально) отчёт с VPS
  → отчёт / план / diff
  → Code Fixer чинит только после твоего «ДА»
```

| Что | Как часто | Кто решает |
|-----|-----------|------------|
| QA тесты | После деплоя, перед показом клиенту | Ты или cron на VPS |
| Code Fixer | Когда QA нашёл баг | Ты подтверждаешь каждый diff |
| Docs | Когда меняется процесс/VPS | Ты просишь |
| Migration | Только когда скажешь «готов к Postgres» | Ты |

**Cloud Automations** (Cursor dashboard) — опционально, по расписанию. Без них агенты **не работают сами** — только когда ты открываешь Cursor.

### Может ли навредить проекту?

| Риск | Защита |
|------|--------|
| Удалит production БД | Запрет SQL DELETE/DROP в правилах |
| Сломает .env | Запрет менять DATABASE_URL |
| Испортит код без спроса | Code Fixer: plan → diff → жди «ДА» |
| Сотрёт demo | seed:clean только sto-1/2/3; QA предупреждает |

---

## Часть 1. Роли (4 агента)

Подробные промпты: `.cursor/agents/01–04-*.md`

### 1. QA Agent
- **Зачем:** прогон как реальный пользователь (3 СТО, ЗН, чат, race).
- **Первым делом:** `npm run agent:qa` или `bash scripts/agents/trigger-qa-agent.sh`

### 2. Code Fixer
- **Зачем:** чинит баги из отчёта QA.
- **Первым делом:** объясняет почему → показывает diff → **ждёт твоё «делай»**

### 3. Docs Writer
- **Зачем:** инструкции VPS, пилот, тексты для продаж.
- **Первым делом:** сверяет docs с `package.json` и pilot-скриптами

### 4. Migration Helper
- **Зачем:** SQLite → Postgres + RLS для 3 СТО в одной БД.
- **Первым делом:** `npm run agent:migration-check` (без destructive)

---

## Часть 2. Расписание на 2 недели

| День | Агент | Задача | Триггер |
|------|-------|--------|---------|
| Д1 | QA | `npm run agent:qa` на VPS после DNS | «DNS sto1/2/3 готов» |
| Д1 | Docs | Обновить PILOT-DEMO-POLYGON (поддомены) | После DNS |
| Д2 | QA | Playwright `e2e/pilot-isolation-webhooks.spec.ts` | Перед показом клиенту |
| Д3 | Code Fixer | Починить баги из отчёта QA | Только если QA = FAIL |
| Д4 | QA | Повторный `pilot:verify` после фиксов | После merge/deploy |
| Д5 | Docs | Скриншоты + текст «3 СТО изолированы» | Перед демо |
| Д6–7 | — | Ручное демо клиентам | — |
| Д8 | QA | Регресс после любых правок | `git pull` на VPS |
| Д9 | Code Fixer | UI/API долги (/zn, crm-settings) | Если в backlog |
| Д10 | Migration | `npm run agent:migration-check` | **Не мигрировать** — только чеклист |
| Д11–12 | QA | Полный smoke всех 3 tenant | Раз в неделю |
| Д13 | Docs | POSTGRES-RLS.md + чеклист | Если планируешь Postgres |
| Д14 | Migration | Миграция | **Только если скажешь «готов к Postgres»** |

**Триггеры (запомни):**
- QA — после каждого `git pull` + `pm2 restart` на VPS
- Code Fixer — если QA нашёл P0/P1
- Docs — если менялся deploy/seed/логины
- Migration — **только по твоей команде**

---

## Часть 3. Структура файлов

```
.cursor/agents/
  00-SAFETY-RULES.md      ← общие запреты
  01-qa-agent.md
  02-code-fixer.md
  03-docs-writer.md
  04-migration-helper.md
  README.md

.cursor/rules/
  crm-agent-qa.mdc        ← @crm-agent-qa
  crm-agent-code-fixer.mdc
  crm-agent-docs.mdc
  crm-agent-migration.mdc

scripts/agents/
  collect-context.sh      ← снимок для любого агента
  trigger-qa-agent.sh     ← полный QA-прогон
  trigger-migration-check.sh

docs/agents/
  MULTI-AGENT-GUIDE.md    ← этот файл
```

**Как не «забыть» demo-полигон:** в каждом промпте есть sto-1/2/3 и `pilot-demo-manifest.json`. После seed обновляется манифест — агенты читают его через `collect-context.sh`.

---

## Часть 4. Команды (скопируй)

### Локально или на VPS

```bash
# Контекст для вставки в Cursor
bash scripts/agents/collect-context.sh

# Полный QA-отчёт
npm run agent:qa

# Pre-flight Postgres (без миграции)
npm run agent:migration-check

# Demo (если нужно пересоздать)
npm run pilot:seed:clean
npm run pilot:verify
```

### На VPS после DNS поддоменов

```bash
cd /opt/crm
git pull
bash scripts/agents/trigger-qa-agent.sh
# скопируй вывод → Cursor @crm-agent-qa
```

SSL для поддоменов (один раз после DNS):

```bash
certbot --nginx -d crmavito.online -d www.crmavito.online \
  -d sto1.crmavito.online -d sto2.crmavito.online -d sto3.crmavito.online
```

---

## Часть 5. Правила безопасности (в начале каждого агента)

См. `.cursor/agents/00-SAFETY-RULES.md`:

1. Нет SQL DELETE/DROP без «ДА»
2. Не менять `.env` / `DATABASE_URL`
3. Demo только sto-1/2/3
4. Diff → согласование → правка
5. Commit только по твоей просьбе

---

## Часть 6. Пример диалога

### Ты (QA)

> @crm-agent-qa  
> На VPS после DNS прогони проверки. master@sto1.demo должен видеть 2 ЗН. sto-2 — 403.

### QA Agent

```markdown
## Статус: FAIL
## Прогон
- pilot:verify: sto1 HTTPS timeout (SSL на поддомене)
- API через x-tenant-slug: 2 ZN OK, isolation 403 OK

## Баги
| P | Проблема | Решение |
|---|----------|---------|
| P1 | sto1.crmavito.online без SSL | certbot --nginx -d sto1... |

## Code Fixer
Не нужен — инфра. Docs: добавить certbot в PILOT-DEMO-POLYGON.
```

### Ты (Docs)

> @crm-agent-docs добавь шаг certbot для sto1/2/3

### Docs Writer

→ готовый markdown-блок (ты вставляешь в docs)

### Ты (Code Fixer) — если был баг в коде

> @crm-agent-code-fixer QA: master видит 0 ЗН из-за LICENSE_OFFER. Предложи fix.

### Code Fixer

```markdown
### Почему
API блокирует запросы до акцепта оферты.

### План
1. В pilot-demo-polygon.ts выставить offer_accepted_at при seed
2. npm run pilot:seed:clean на VPS

### Diff preview
(фрагмент insertPilotTenant)

### Риски
Только demo-tenant.

**Подтвердите «делай» — применю.**
```

### Ты

> делай

→ агент правит → `npm run pilot:verify` → ✅

---

## Полный аудит перед billing

```bash
npm run agent:full-audit          # всё: API + UI + ЗН + typecheck
npm run test:e2e:audit            # только Playwright audit
```

Чеклист: [CRM-AUDIT-CHECKLIST.md](CRM-AUDIT-CHECKLIST.md)

---

```
1. bash scripts/agents/trigger-qa-agent.sh     → отчёт
2. @crm-agent-qa + вставить отчёт            → список багов
3. @crm-agent-code-fixer + баг P0/P1         → план + diff
4. Ты: «делай»                               → правки
5. npm run agent:qa                          → повтор
6. @crm-agent-docs                           → обновить инструкции
```

**Агенты не заменяют тебя** — они ускоряют тесты и правки, но **решение всегда за тобой**.
