# Public API — быстрый старт

Цель: предоставить публичную, документированную API-стеку для партнёров и разработчиков.

Структура:

- Overview: аутентификация (API keys), rate limits, версия API
- Endpoints:
  - `GET /api/v1/health` — статус
  - `POST /api/v1/oauth/token` — получение токена (OAuth)
  - `GET /api/v1/tenants/:id` — информация о тенанте
  - `GET /api/v1/clients` — список клиентов
  - `POST /api/v1/messages` — отправка/логирование сообщения
  - Webhooks: `POST /webhooks/events`

План действий:

1. Реализовать OpenAPI (swagger) спецификацию в `docs/openapi.yaml`.
2. Добавить страницу `docs/Public API` с примерами cURL и SDK.
3. Подготовить SDK (Node/TS) и пример интеграции.

Срок: MVP документации — 1 неделя.
