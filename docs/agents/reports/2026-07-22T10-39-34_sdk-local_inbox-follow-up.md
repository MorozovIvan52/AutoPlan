# CRM: follow-up входящих (SDK local)

status=finished
agent=
run=run-eb9c1234-6639-4c28-b5e6-b953e19b9d6d

# Follow-up входящих — АвтоПлан

**Источник:** код `api/lib/ai-scanners.ts`, `api/routes/calls.ts`, `api/routes/tasks.ts`, схема `api/database/schema.ts`; проверка локальной `crm.db` (tenant_id = 1).  
**Важно:** `dealId` в диалогах нет — сделки/ЗН ищутся по `deals.client_id`. Связи `tasks.call_id` в схеме нет; звонок считается «с задачей», если у того же `client_id` есть активная задача, созданная после звонка.

---

## Кратко

- **Диалоги с высоким intent без ответа:** по логике `scanChatOpportunities` / `needsManagerResponse` — **0** (последние «клиентские» сообщения — системные уведомления Авито про API, они отфильтровываются в `isAvitoSystemMessageText`).
- **Звонки за 24 ч без задачи:** **0** (`call_logs` пуста).
- **«Перезвонить» без `dueAt`:** **0**; есть задача #3 «Перезвонить Ивану по колодкам» с `dueAt`, но она просрочена (отдельный кейс).

---

## 1. Диалоги с высоким intent (ремонт, цена, VIN) без ответа

### Критерии (как в коде)

| Параметр | Логика |
|----------|--------|
| «Без ответа» | Последнее **реальное** сообщение клиента (`sender_type = 'client'`, не системное Авито) — см. `needsManagerResponse` в `chat-sla.ts` |
| Intent | `REPAIR_KEYWORDS`, `STRONG_BUY_KEYWORDS`, `WEAK_BUY_KEYWORDS` в `ai-scanners.ts` (ремонт, цена, VIN, запчасти…) |
| В сканер inbox | `scanInboxStage`: `score >= 35`, тип ≠ `follow_up` |

### Результат по `crm.db`

**Список пуст.** Открытые диалоги с `last_message_sender_type = 'client'` — в основном текст «Перейдите на подписку с API мессенджера…» (#3641, #3643, #3640 и др.) — **не требуют ответа менеджера** по SLA.

### Как получить живой список

**API (рекомендуется — повторяет сканер):**

```http
GET /api/ai/chat-opportunities?period=today&limit=150
Authorization: Bearer <token>
```

Фильтр в ответе: `opportunityType` ∈ `repair_intent`, `quote_request`, `hot_lead`, `no_reply` и `score >= 35`.

**SQL (SQLite, tenant_id подставьте свой):**

```sql
SELECT
  c.id            AS conversation_id,
  c.client_id,
  c.unread_count,
  c.last_message_at,
  m.text          AS last_message,
  cl.name         AS client_name
FROM conversations c
JOIN clients cl ON cl.id = c.client_id
JOIN messages m ON m.id = (
  SELECT id FROM messages
  WHERE conversation_id = c.id
  ORDER BY created_at DESC LIMIT 1
)
WHERE c.tenant_id = 1
  AND c.status = 'open'
  AND m.sender_type = 'client'
  AND m.text NOT LIKE '%Перейдите на подписку с API%'
  AND (
    lower(m.text) GLOB '*ремонт*' OR lower(m.text) GLOB '*диагност*'
    OR lower(m.text) GLOB '*цена*' OR lower(m.text) GLOB '*стоим*'
    OR lower(m.text) GLOB '*vin*'   OR lower(m.text) GLOB '*запчаст*'
    OR lower(m.text) GLOB '*сколько*'
  )
ORDER BY c.last_message_at DESC;
```

**dealId:** `SELECT id FROM deals WHERE client_id = ? AND status NOT IN ('done','cancelled')`.

### Шаблон строки (когда появятся записи)

| Поле | Значение |
|------|----------|
| `conversationId` / `clientId` / `dealId` | из выборки |
| **Текст ответа** | По `buildReplyDraft`: *«Здравствуйте, {имя}! Уточню наличие и цену. Пришлите VIN (17 символов) или марку/модель/год — подберём точнее.»* (ремонт: *«…можем записать на диагностику…»*) |
| **Задача** | `title`: «Ответить: {clientName} (#{conversationId})» · `dueAt`: +2 ч · `priority`: **high** (score ≥ 62 / hot_lead) или **medium** («normal» в CRM) |

---

## 2. Звонки за последние 24 ч без связанной задачи

### Критерии (схема `call_logs`)

- Поля: `id`, `client_id`, `phone`, `direction`, `outcome`, `duration_sec`, `reason`, `vin`, `created_at`.
- Задача «связана», если после `call_logs.created_at` есть `tasks` с тем же `client_id` и `status IN ('todo','in_progress')`.  
  При сохранении карточки звонка задача создаётся опционально (`PATCH /api/calls/:id/card`, `createTask: true`) — см. `call-card.ts`.

### Результат по `crm.db`

**Список пуст** — записей в `call_logs` нет (ни за 24 ч, ни всего).

### Запрос

**API:**

```http
GET /api/calls
Authorization: Bearer <token>
```

Дальше вручную или скриптом: для каждого звонка с `createdAt >= now()-24h` проверить `GET /api/tasks?status=todo` по `clientId`.

**SQL:**

```sql
SELECT
  cl.id         AS call_id,
  cl.client_id,
  cl.phone,
  cl.direction,
  cl.outcome,
  cl.duration_sec,
  cl.reason,
  cl.vin,
  cl.created_at,
  c.name        AS client_name
FROM call_logs cl
LEFT JOIN clients c ON c.id = cl.client_id
WHERE cl.tenant_id = 1
  AND cl.created_at >= (strftime('%s','now') * 1000 - 86400000)
  AND (
    cl.client_id IS NULL
    OR NOT EXISTS (
      SELECT 1 FROM tasks t
      WHERE t.tenant_id = cl.tenant_id
        AND t.client_id = cl.client_id
        AND t.created_at >= cl.created_at
        AND t.status IN ('todo', 'in_progress')
    )
  )
ORDER BY cl.created_at DESC;
```

**dealId:** только через клиента: `SELECT id FROM deals WHERE client_id = ? AND status NOT IN ('done','cancelled')`.

### Шаблон строки

| Поле | Значение |
|------|----------|
| `callId` / `clientId` / `dealId` | из выборки |
| **Текст** | *«{Имя}, добрый день! По итогам разговора уточняю: {reason / vin / артикул из карточки}. Удобно сейчас обсудить?»* |
| **Задача** | `title`: «Перезвонить {clientName} после звонка #{callId}» · `dueAt`: +3 ч · `priority`: **high** (`duration_sec > 30` или `outcome = 'callback'`), иначе **medium** |

---

## 3. Follow-up «перезвонить» без `dueAt` в tasks

### Критерии (схема `tasks`)

- Нет поля `type` для callback — ищем по **title**: `%ерезвон%`, `%Звонок:%` (как в `call-card.ts`: «Перезвонить …»).
- `status IN ('todo', 'in_progress')` и **`due_at IS NULL`**.
- Приоритеты в CRM: `low` | `medium` | `high` (не `normal`).

### Результат по `crm.db`

**Список пуст** — задач «перезвонить» без срока нет.

**Смежный кейс (не попадает в пункт 3):**

| taskId | clientId | title | dueAt | priority |
|--------|----------|-------|-------|----------|
| **3** | **3237** | Перезвонить Ивану по колодкам | есть, просрочен | high |

### Запрос

**API:**

```http
GET /api/tasks?status=todo
Authorization: Bearer <token>
```

Фильтр: `title` содержит «перезвон» / «Звонок» и `dueAt === null`.

**SQL:**

```sql
SELECT
  t.id          AS task_id,
  t.client_id,
  t.title,
  t.priority,
  t.status,
  t.created_at,
  t.assigned_to
FROM tasks t
WHERE t.tenant_id = 1
  AND t.status IN ('todo', 'in_progress')
  AND t.due_at IS NULL
  AND (
    t.title LIKE '%ерезвон%'
    OR t.title LIKE '%Звонок:%'
    OR t.title LIKE '%звонок%'
  )
ORDER BY t.created_at ASC;
```

**dealId:** `SELECT id FROM deals WHERE client_id = t.client_id AND status NOT IN ('done','cancelled') LIMIT 1`.

### Шаблон строки

| Поле | Значение |
|------|----------|
| `taskId` / `clientId` / `dealId` | из выборки |
| **Текст клиенту** | *«{Имя}, договаривались перезвонить по {тема из title}. Уточню детали и предложу варианты — удобно сейчас или назначим время?»* |
| **Задача (мета)** | `title`: «Перезвонить {клиент} — {тема}» · `dueAt`: сегодня до 18:00 или +1 ч · `priority`: **medium**; если просрочка > 24 ч → **high** |

---

## Срочно сегодня (из локальной БД)

| Что | Кому | Действие |
|-----|------|----------|
| Задача **#3** «Перезвонить Ивану по колодкам», clientId **3237**, priority **high**, просрочена | Менеджер | Перезвонить или закрыть с комментарием |
| ~30 диалогов с системным текстом Авитo про API | — | Не SLA; проверить интеграцию Авито |
| Inbox hot intent без ответа | — | **0** по сканеру |

---

## AI-предложения

Встроенный сканер прогоняет `scanInboxStage`, `scanDealStage`, `scanRepairStage`, `scanDeliveryStage`, `scanPartsStage` и пишет черновики в `ai_proposals`.

**Запустите `POST /api/ai/scan` или `/assistant` → «Сканировать».**

```http
POST /api/ai/scan
Authorization: Bearer <token>
```

Ответ: `{ scanned, created, chatCount, stages: ["inbox","deal","repair","delivery","parts"] }`.  
Для inbox без SQL: одобрите pending-предложения на `/assistant` (поля `conversationId`, `clientId`, `proposedText`, `priority`).
