# Телеметрия UI: version mismatch и ErrorBoundary

Однодневный чек-лист внедрения. Цель — видеть проблемы до жалоб операторов.

## Стек (уже в репозитории)

| Компонент | Реализация |
|-----------|------------|
| События с клиента | `POST /api/client-errors` |
| Лог | `logs/client-errors.log` (JSON lines) |
| Метрики | `GET /api/metrics` → Prometheus |
| Алерт всплеска | Telegram (`CLIENT_ERROR_TELEGRAM_CHAT_ID`) |
| Health / buildId | `GET /api/health` → `service`, `version`, `buildId` |

---

## Шаг 1. Фронтенд: version mismatch (1–2 ч)

### Сделано в коде

- **Три источника `buildId`:** `meta crm-build-id` (HTML), `__CRM_BUILD_ID__` (бандл), `/api/health` + `/crm-build-id.json`
- **Проверка:** при старте и каждые **45 с** (+ при возврате на вкладку) — `src/lib/app-version-guard.ts`
- **Телеметрия:** событие `version_mismatch` → `src/lib/telemetry.ts`
- **Баннер:** «Обновляем интерфейс…» + «Обновить сейчас» — `src/components/VersionMismatchBanner.tsx` (портал в `#crm-overlays`)
- **Автообновление:** через **45 с** после расхождения (или кнопка раньше)

### Чек-лист внедрения

- [ ] `npm run build` — в `dist/index.html` есть `<meta name="crm-build-id">`
- [ ] `dist/crm-build-id.json` существует
- [ ] `curl /api/health` → `buildId` совпадает с meta
- [ ] После деплоя операторам: Ctrl+F5 или дождаться баннера

### Ручной тест

```bash
# 1. Запомнить buildId
curl -s http://127.0.0.1:4200/api/health | jq .buildId

# 2. В DevTools → Elements изменить content у meta crm-build-id на fake-id
# 3. Через ≤45 с: баннер, запись в logs/client-errors.log, метрика crm_version_mismatch_total
```

---

## Шаг 2. Фронтенд: ErrorBoundary (1 ч)

### Сделано в коде

- Корневой `ErrorBoundary` в `main.tsx`
- Панельные границы в `inbox.tsx` (список / чат / карточка)
- Событие `error_boundary_fallback` с полями: `error`, `component`, `sessionId`, `buildId`, `url`, `lastAction`, stack

### Чек-лист

- [ ] `CLIENT_ERROR_TELEGRAM_CHAT_ID` в `.env` на VPS (опционально)
- [ ] Ошибка в одной панели не роняет всё приложение

### Ручной тест

Временно в `ConversationListItem` (только dev):

```tsx
if (import.meta.env.DEV && conv.id === 1) throw new Error("test boundary");
```

Проверить: fallback UI, событие в логе, `crm_error_boundary_fallback_total`.

---

## Шаг 3. Бэкенд: /api/health (30 мин)

### Ответ

```json
{
  "status": "ok",
  "service": "crm",
  "version": "1.0.0",
  "buildId": "mqozcdqh-1vcddb",
  "uptimeSec": 3600,
  "timestamp": "...",
  "checks": { ... }
}
```

### Чек-лист релиза

```bash
HTML=$(curl -s https://crmavito.online/ | grep -o 'crm-build-id" content="[^"]*"' | cut -d'"' -f3)
API=$(curl -s https://crmavito.online/api/health | jq -r .buildId)
echo "HTML=$HTML API=$API"
test "$HTML" = "$API" && echo OK || echo MISMATCH
```

---

## Шаг 4. Мониторинг и алертинг (1–2 ч)

### Метрики Prometheus

| Метрика | Тип | Описание |
|---------|-----|----------|
| `crm_version_mismatch_total{source,build_id}` | counter | Расхождения версий |
| `crm_error_boundary_fallback_total{component,error}` | counter | Срабатывания границ |
| `crm_error_boundary_recent_5m` | gauge | События за 5 мин (для алерта) |

### Пример правил

См. `scripts/ops/prometheus-alerts.example.yml`

### Telegram без Prometheus

Сервер сам шлёт алерт при **≥15** ErrorBoundary за 5 мин (`api/lib/telemetry-metrics.ts`).

### Чек-лист

- [ ] `METRICS_TOKEN` задан на VPS
- [ ] Prometheus scrape `/api/metrics` (localhost)
- [ ] Правило алерта на `crm_error_boundary_recent_5m > 10`
- [ ] Uptime на `/api/health` (см. MONITORING.md)

---

## Шаг 5. Тестирование (1–2 ч)

```bash
npm run build && npm run start
npm run test:telemetry          # smoke API
```

### Нагрузочный тест ErrorBoundary

```bash
for i in $(seq 1 20); do
  curl -s -X POST http://127.0.0.1:4200/api/client-errors \
    -H "Content-Type: application/json" \
    -d "{\"event\":\"error_boundary_fallback\",\"error\":\"test-$i\",\"component\":\"test\"}" &
done
wait
curl -s http://127.0.0.1:4200/api/metrics | grep error_boundary
```

Ожидание: счётчики растут; при ≥15 — Telegram (если chat id задан).

---

## Шаг 6. Документация и процессы (30 мин)

### Как формируется buildId

1. При `npm run build` Vite-плагин (`vite.config.ts`) генерирует уникальный id
2. Вставляет в HTML meta, JS define `__CRM_BUILD_ID__`, файл `dist/crm-build-id.json`
3. PM2 читает `buildId` из `dist/crm-build-id.json` для `/api/health`

### Интерпретация событий

| event | Значение |
|-------|----------|
| `version_mismatch` | У оператора старый кэш JS/HTML; `source` — что устарело |
| `error_boundary_fallback` | Ошибка рендера React; смотреть `component`, `error` |

### SLA на реакцию (рекомендация)

| Алерт | Реакция |
|-------|---------|
| `crm_up == 0` | 15 мин — восстановить сервис |
| Всплеск ErrorBoundary | 30 мин — проверить лог, откат/горячий фикс |
| version_mismatch | Информирование: Ctrl+F5; при массовости — проверить CDN/кэш nginx |

---

## Связанные файлы

- `src/lib/telemetry.ts`, `src/lib/app-version-guard.ts`
- `src/components/VersionMismatchBanner.tsx`, `ErrorBoundary.tsx`
- `api/routes/client-errors.ts`, `api/lib/telemetry-metrics.ts`
- `docs/ops/MONITORING.md`, `docs/ops/RELIABILITY.md`
