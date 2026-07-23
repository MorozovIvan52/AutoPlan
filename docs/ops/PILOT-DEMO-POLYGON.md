# Демо-полигон: 3 СТО для пилота

Три независимых СТО в одной CRM — **sto-1**, **sto-2**, **sto-3**. У каждого свой склад, ЗН, чеки и чаты. Данные изолированы (Postgres RLS + app-layer).

## Что получите после seed

| Объект | На каждый tenant |
|--------|------------------|
| Пользователи | master, admin, accountant (роль в БД: `operator`) |
| Склад | 5 запчастей; `PILOT-N-RACE` — **остаток 1** (race condition) |
| ЗН | 1 × **закрыт** (`done` + оплата + товарный чек); 1 × **в работе** (`in_progress`) |
| Чат | Avito, 5 сообщений (клиент → менеджер → мастер, VIN) |

**Пароль всех demo-учёток:** `PilotDemo2026!` (scrypt, не bcrypt — только через seed-скрипт)

---

## Пошаговая инструкция для VPS (новичок)

### Шаг 1. Зайти на VPS и перейти в папку проекта

```bash
ssh root@твой-ip-vps
cd /opt/crm
```

Если папки `/opt/crm` нет — укажи свой путь, где лежит проект. Главное — быть в корне, где есть `package.json`.

### Шаг 2. Обновить код и установить зависимости

```bash
git pull
npm ci
```

`npm ci` — «чистая» установка без лишних вопросов. Для новичка безопаснее, чем `npm install`.

### Шаг 3. Применить схему БД (если менялась)

```bash
npm run db:push
```

Для **3 СТО в одной Postgres** дополнительно включи RLS:

```bash
export DATABASE_URL="postgresql://user:pass@127.0.0.1:5432/crm"
psql "$DATABASE_URL" -f scripts/setup-postgres-rls.pgsql
export PG_RLS=1
```

Без таблиц и RLS seed не сможет создать изолированные данные.

### Шаг 4. Создать демо-данные (3 СТО)

```bash
npm run pilot:seed:clean
```

Команда:

- удаляет старые demo-tenant `sto-1`, `sto-2`, `sto-3`;
- создаёт 3 тенанта, пользователей, склад, ЗН, чеки, чаты;
- пишет `scripts/pilot-demo-manifest.json` (ID для curl/e2e);
- выводит таблицу логинов в консоль.

Пример вывода:

| Tenant | Email | Role | Password |
|--------|-------|------|----------|
| sto-1 | master@sto1.demo | master | PilotDemo2026! |
| sto-1 | admin@sto1.demo | admin | PilotDemo2026! |
| sto-1 | accountant@sto1.demo | accountant | PilotDemo2026! |
| sto-2 | master@sto2.demo | master | PilotDemo2026! |
| … | … | … | … |

Сохрани эти данные (Notion / Excel) — это demo-учётки для показа клиентам.

### Шаг 5. Запустить CRM и проверить демо

Если CRM через pm2:

```bash
pm2 restart crm
```

Если вручную:

```bash
npm run dev
```

Автопроверка (5 curl-сценариев):

```bash
chmod +x scripts/pilot-demo-verify.sh
npm run pilot:verify
```

Скрипт читает `pilot-demo-manifest.json` и проверяет:

1. Логин мастера sto-1  
2. Получение своих ЗН  
3. Нельзя увидеть чужие ЗН (403/404)  
4. Race condition (склад не уходит в минус)  
5. Чат (≥5 сообщений)  

Успех: **`✅ All pilot tests passed`**

---

## DNS поддоменов (Beget)

После `setup-pilot-subdomains.sh` nginx уже принимает `sto1/sto2/sto3.crmavito.online`.
Осталось добавить **A-записи** в Beget → Домены → `crmavito.online` → DNS:

| Тип | Имя | Значение |
|-----|-----|----------|
| A | `sto1` | `159.194.207.50` |
| A | `sto2` | `159.194.207.50` |
| A | `sto3` | `159.194.207.50` |

Проверка (через 15–60 мин):

```bash
getent hosts sto1.crmavito.online
bash scripts/pilot-subdomain-check.sh
```

SSL для поддоменов (после DNS):

```bash
certbot --nginx -d crmavito.online -d www.crmavito.online \
  -d sto1.crmavito.online -d sto2.crmavito.online -d sto3.crmavito.online
```

---

1. Открой домен CRM (например `https://crmavito.online`).
2. Войди как мастер СТО-1:
   - Email: `master@sto1.demo`
   - Пароль: `PilotDemo2026!`
3. Увидишь только данные sto-1: склад (5 позиций), 2 ЗН, чат с VIN.
4. Подставь в URL ID чужого ЗН из `pilot-demo-manifest.json` (tenant sto-2) — получишь **403** или **404**. Это изоляция tenant.

---

## Логины (справочник)

| Tenant | Slug | Email | Роль в UI | Пароль |
|--------|------|-------|-----------|--------|
| Пилот СТО 1 | `sto-1` | master@sto1.demo | мастер | `PilotDemo2026!` |
| | | admin@sto1.demo | админ | то же |
| | | accountant@sto1.demo | бухгалтер | то же |
| Пилот СТО 2 | `sto-2` | master@sto2.demo | … | … |
| Пилот СТО 3 | `sto-3` | master@sto3.demo | … | … |

Поддомены (если `TENANT_BASE_DOMAIN`): `sto1.`, `sto2.`, `sto3.`

---

## Важные нюансы

| Тема | Как в CRM «АвтоПлан» |
|------|----------------------|
| Auth | Cookie `session`, **не** `Authorization: Bearer` |
| Tenant | Заголовок `x-tenant-slug: sto-1` обязателен в curl |
| Пароли | Только demo; в проде — свои |
| Бухгалтер | Роль `operator` в БД, email `accountant@stoN.demo` |
| Статусы ЗН | `done` (закрыт) / `in_progress` (в работе) |
| SQLite | Seed работает локально; для 3 СТО на VPS — **Postgres + RLS** |

---

## SQL-проверка (пощупать базу)

```bash
psql "$DATABASE_URL" -f scripts/pilot-demo-polygon.pgsql
```

Покажет: tenant, users, склад, ЗН, чеки, сообщения.

---

## Очистка после пилота

```bash
npm run pilot:seed:clean
```

Удаляет **только** `sto-1`, `sto-2`, `sto-3`. Остальные tenant не трогает.

---

## Если что-то пошло не так

| Проблема | Решение |
|----------|---------|
| `pilot:seed` — ошибка БД | Проверь `DATABASE_URL` в `.env` |
| `pilot:verify` — RLS | `psql "$DATABASE_URL" -f scripts/setup-postgres-rls.pgsql`, `export PG_RLS=1` |
| Нет данных в UI | Заголовок `x-tenant-slug` / выбери tenant при логине |
| bcrypt/scrypt | Не меняй seed — пароли через `hashPassword` (scrypt) |
| verify падает на race | CRM должна быть запущена; проверь `CRM_BASE_URL` (по умолчанию `http://127.0.0.1:4200`) |

---

## npm-команды

```bash
npm run pilot:seed          # создать (если sto-1/2/3 ещё нет)
npm run pilot:seed:clean    # удалить и создать заново
npm run pilot:verify        # 5 curl-тестов
```

---

## План на 1 день (показ клиенту)

1. Развернуть demo на VPS по шагам 1–5.  
2. Скриншоты: мастер видит только свои ЗН; чат VIN; товарный чек.  
3. Видео 30–60 сек: «3 СТО в одной CRM, данные не смешиваются».  
4. Показ: «У каждого СТО свой склад, заказы, чаты. Данные не пересекаются».

---

## E2E (Playwright, опционально)

```bash
npm run test:e2e -- e2e/zn-close-payment.spec.ts e2e/pilot-isolation-webhooks.spec.ts
```
