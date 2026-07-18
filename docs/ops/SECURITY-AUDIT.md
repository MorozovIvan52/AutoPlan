# Аудит безопасности бэкенда AutoCRM

Дата: 2026-06-22 (обновлено)  
Область: API, сервер, аутентификация, webhooks, загрузки, WebSocket, UI безопасности.

## Резюме

| Уровень | Найдено | Статус |
|---------|---------|--------|
| Критический | 5 | ✅ Исправлено |
| Высокий | 6 | ✅ Исправлено |
| Средний | 4 | ✅ Исправлено |
| Низкий | 3 | ✅ Документировано / nginx example |

## Реализованные меры

### Аутентификация и пароли
- **scrypt** с per-user salt, миграция legacy SHA-256 при входе
- Политика паролей: 10 символов в проде (8 локально), буква + цифра, не совпадает с email
- `GET /api/auth/password-policy` — для UI
- `POST /api/auth/change-password` — смена пароля, отзыв чужих сессий
- `POST /api/auth/logout-all` / `logout-others`
- Ротация session id при каждом login
- Rate limit: login, setup
- `INSTALL_SECRET` обязателен для setup в проде (+ поле в UI)

### Сессии
- WebSocket только с валидной cookie `session`
- `cleanupExpiredSessions()` — cron каждый час (`startSessionCleanup`)
- `revokeUserSessions` при смене пароля админом / деактивации

### Webhooks
- Telegram / VK / generic: `webhookSecret` (в проде обязателен для generic)
- Avito: `webhookSecret` обязателен в проде
- WhatsApp: **X-Hub-Signature-256** через `appSecret` в конфиге канала
- Megafon / MTS: `webhookSecret` обязателен в проде
- `timingSafeEqual` для всех секретов

### Данные и инфраструктура
- Uploads только для авторизованных
- CORS allowlist
- `/api/metrics` — токен обязателен в проде
- Health не раскрывает путь к БД в проде
- ZZap public URL — опциональный `ZZAP_PUBLIC_TOKEN`
- Security headers (HSTS в проде)

### UI
- Настройки → **Безопасность**: смена пароля, выход на других устройствах
- Login/setup: политика паролей, ключ установки
- Каналы: App Secret (WhatsApp), webhook secret (Telegram/Avito)

## Обязательно на VPS (`/opt/crm/.env`)

```env
NODE_ENV=production
PUBLIC_URL=https://crmavito.online
INSTALL_SECRET=<32+ случайных символов>
METRICS_TOKEN=<32+ случайных символов>
TRUST_PROXY=1
ZZAP_PUBLIC_TOKEN=<если ZZap external URL>
```

### После деплоя — каналы

| Канал | Поле в настройках канала |
|-------|--------------------------|
| Telegram | `webhookSecret` = `secret_token` в setWebhook |
| Avito | `webhookSecret` |
| WhatsApp | `appSecret` (Meta App Secret) или `webhookSecret` |
| VK | Secret Callback API |
| Телефония | `webhookSecret` в настройках телефонии |

## nginx (опционально)

Пример rate limit: [`scripts/nginx-security.example.conf`](../../scripts/nginx-security.example.conf)

## Проверка

```bash
curl -i -N -H "Connection: Upgrade" -H "Upgrade: websocket" https://crmavito.online/api/ws
# → 401

curl -I https://crmavito.online/api/uploads/test.jpg
# → 401

curl -I https://crmavito.online/api/metrics
# → 503 без METRICS_TOKEN

curl -s https://crmavito.online/api/health | jq .checks.database.path
# → null (в проде)
```

## Не в scope (будущее)

- TOTP 2FA
- Argon2 вместо scrypt (scrypt достаточен для текущего масштаба)
- PostgreSQL + row-level security для SaaS

## Ключевые файлы

`api/lib/password.ts`, `api/lib/session.ts`, `api/lib/whatsapp-signature.ts`, `api/routes/auth.ts`, `api/routes/webhooks.ts`, `api/services/session-cleanup.ts`, `src/pages/settings.tsx`, `src/pages/login.tsx`
