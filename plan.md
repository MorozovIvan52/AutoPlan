# CRM Web Platform — Unified Inbox + Client Management

## Что строим

Полноценная CRM-система в браузере, которая заменяет Telegram как рабочий инструмент.
Все входящие сообщения (Telegram-боты, Авито x5 аккаунтов, другие каналы) приходят в один интерфейс.
Операторы работают только через сайт — никакого Telegram на стороне команды.

---

## Стек

- **Frontend:** React 19 + Vite + Tailwind CSS 4 + Wouter
- **Backend:** Hono API (Bun) + Drizzle ORM + Turso (SQLite)
- **Real-time:** WebSocket (через Hono) — для живых чатов и уведомлений
- **Интеграции:** Telegram Bot API (webhooks), Авито API (если доступно) или ручной импорт

---

## База данных (схема)

| Таблица | Поля |
|---|---|
| `users` | id, name, email, password_hash, role (admin/operator), theme, created_at |
| `clients` | id, name, phone, avatar_url, source (telegram/avito/manual), external_id, created_at |
| `client_tags` | id, client_id, tag_id |
| `tags` | id, name, color, created_at |
| `client_comments` | id, client_id, user_id, text, created_at |
| `conversations` | id, client_id, channel (telegram/avito_1..5/manual), status (open/pending/closed), assigned_to, created_at |
| `messages` | id, conversation_id, sender_type (client/operator), text, media_url, read_at, created_at |
| `deals` | id, client_id, title, status (new/in_progress/done/cancelled), amount, created_at |
| `notifications` | id, user_id, text, type, read_at, created_at |

---

## API Routes (`/api/*`)

### Auth
- `POST /api/auth/login` — логин оператора
- `POST /api/auth/logout`
- `GET /api/auth/me`

### Клиенты
- `GET /api/clients` — список с фильтрами (тег, статус, поиск)
- `POST /api/clients` — создать вручную
- `GET /api/clients/:id` — карточка клиента
- `PATCH /api/clients/:id` — обновить (имя, телефон)
- `DELETE /api/clients/:id`

### Теги
- `GET /api/tags` — все теги
- `POST /api/tags` — создать тег
- `DELETE /api/tags/:id`
- `POST /api/clients/:id/tags` — назначить тег
- `DELETE /api/clients/:id/tags/:tagId`

### Комментарии
- `GET /api/clients/:id/comments`
- `POST /api/clients/:id/comments`

### Диалоги и сообщения
- `GET /api/conversations` — все диалоги (с фильтром по каналу, статусу, оператору)
- `GET /api/conversations/:id/messages`
- `POST /api/conversations/:id/messages` — отправить ответ
- `PATCH /api/conversations/:id` — сменить статус, назначить оператора

### Сделки
- `GET /api/clients/:id/deals`
- `POST /api/clients/:id/deals`
- `PATCH /api/deals/:id`

### Уведомления
- `GET /api/notifications`
- `PATCH /api/notifications/:id/read`

### Webhooks (входящие)
- `POST /api/webhooks/telegram/:botToken` — Telegram Bot webhook
- `POST /api/webhooks/avito/:accountId` — Авито webhook (аккаунты 1-5)

### WebSocket
- `GET /api/ws` — real-time соединение для чатов и уведомлений

---

## Страницы / UI

### 1. Авторизация (`/login`)
- Логин + пароль, роли: admin / operator

### 2. Главный Inbox (`/`) — центральный экран
- **Левая панель:** список диалогов с фильтрами (все / мои / без оператора)
  - Фильтр по каналу (Telegram, Авито 1-5, ручной)
  - Фильтр по статусу (открыт / в ожидании / закрыт)
  - Поиск по имени/номеру
  - Теги-бейджи на каждом диалоге
- **Центральная панель:** чат (как в Telegram)
  - История сообщений
  - Поле ввода + отправка
  - Индикатор канала (иконка Telegram / Авито)
- **Правая панель:** карточка клиента
  - Имя, телефон, источник
  - Теги (добавить/удалить) — визуальные цветные бейджи
  - Комментарии оператора
  - Сделки/заказы
  - История всех диалогов с клиентом

### 3. Клиенты (`/clients`)
- Таблица + карточки, фильтрация по тегам
- Быстрый просмотр карточки в слайдере

### 4. Аналитика (`/analytics`)
- Кол-во новых клиентов, диалогов, закрытых сделок
- График активности по каналам
- Нагрузка на операторов

### 5. Настройки (`/settings`)
- Управление операторами (создать, дать роль)
- Управление тегами (создать, выбрать цвет)
- Подключение каналов (вставить токен Telegram-бота, настроить Авито)
- **Темы интерфейса** — выбор из нескольких тем (тёмно-синяя, тёмная, светлая, Telegram-серая, кастомный акцент)

---

## Теги из коробки

| Тег | Цвет |
|---|---|
| Важно | Красный |
| Доставка | Оранжевый |
| VIP | Золотой |
| Новый клиент | Зелёный |
| Ждёт ответа | Жёлтый |
| Спорный | Фиолетовый |
| Постоянный | Синий |
| Стоп-лист | Серый |

---

## Интеграции

### Telegram (приоритет 1)
- Подключение через Bot Token
- Webhook → `/api/webhooks/telegram/:botToken`
- Поддержка нескольких ботов одновременно
- Отправка ответа через `sendMessage` API

### Авито (5 аккаунтов)
- Авито OAuth2 API (если аккаунт подтверждён как бизнес)
- Polling / webhook для входящих сообщений
- Каждый аккаунт отображается как отдельный канал

### Ручной канал
- Создать диалог вручную с привязкой к номеру телефона

---

## Дизайн

- **По умолчанию:** тёмно-синяя тема (`#0f1629` фон, `#1e3a5f` боковая панель, `#2563eb` акцент)
- **Шрифт:** Poppins (заголовки) + Inter (текст)
- **Компоновка:** три колонки (sidebar, chat, client panel) — как в Telegram Web
- **Переключатель тем:** 5 пресетов, сохраняются в профиле пользователя

---

## Этапы реализации

1. `app_init` — инициализация проекта `/home/user/crm-platform`
2. Написать `design.md`
3. Схема БД + `db:push`
4. Все API routes
5. Страница Login
6. Главный Inbox (3 колонки) — ключевой экран
7. Карточка клиента (теги, комментарии, сделки)
8. WebSocket real-time
9. Webhooks Telegram
10. Страница Клиенты
11. Страница Аналитика
12. Страница Настройки (темы, теги, операторы, каналы)
13. Авито интеграция (базовая)
14. `bun run build` — проверка сборки
15. Deliver

---

## Проверка результата

- [ ] Можно залогиниться как admin и operator
- [ ] Telegram webhook принимает сообщения → появляется в Inbox
- [ ] Отправить ответ клиенту через интерфейс
- [ ] Добавить тег, комментарий, номер телефона к клиенту
- [ ] Переключить тему интерфейса
- [ ] Real-time: новое сообщение появляется без перезагрузки
