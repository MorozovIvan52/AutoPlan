# Чеклист полного аудита CRM (перед оплатой клиента)

Запуск одной командой:

```bash
npm run agent:full-audit
```

На VPS (demo tenant, полный доступ к sto-1):

```bash
cd /opt/crm
PLAYWRIGHT_BASE_URL=https://crmavito.online \
PLAYWRIGHT_SKIP_WEBSERVER=1 \
PILOT_AUDIT=1 \
npm run agent:full-audit
```

---

## Матрица проверок

| # | Модуль | Что проверяем | Как |
|---|--------|---------------|-----|
| 1 | Auth | Логин demo admin/master | Playwright + pilot:verify |
| 2 | Tenant | sto-1 не видит sto-2 | curl 403 |
| 3 | UI | все маршруты NAV (~22+) | Playwright goto |
| 4 | API | 20+ GET эндпоинтов | Playwright request |
| 5 | ЗН | создать → работа → запчасть → оплата | API close-with-payment |
| 6 | Склад | остатки, race qty ≥ 0 | API parts |
| 7 | Чат | сообщения VIN | API messages |
| 8 | Sales | список чеков | API /sales |
| 9 | Export | CSV clients/ZN/stock | API export |
| 10 | STO | day-board, owner-dashboard | API sto/* |

---

## UI — все кнопки/страницы

| Страница | URL | Статус |
|----------|-----|--------|
| Входящие | `/` | auto |
| Дашборд | `/dashboard` | auto |
| AI-боты | `/assistant` | auto |
| Клиенты | `/clients` | auto |
| Заказы | `/deals` | auto |
| ЗН | `/zn` | auto |
| Реализация | `/sales` | auto |
| Доставка | `/delivery` | auto |
| Деньги | `/money` | auto |
| Склад | `/warehouse` | auto |
| Выкуп | `/buyouts` | auto |
| ZZap | `/zzap` | auto |
| Расчёт ЗП | `/payroll` | auto |
| Моя зарплата | `/my-salary` | auto |
| Задачи | `/tasks` | auto |
| Календарь | `/calendar` | auto |
| Звонки | `/calls` | auto |
| Запись | `/repairs` | auto |
| Команда | `/team` | auto |
| Маркетинг | `/marketing` | auto |
| Аналитика | `/analytics` | auto |
| Настройки | `/settings` | auto |

«auto» = проверяется в `e2e/full-crm-audit.spec.ts` test 01 (`UI_ROUTES` в `e2e/helpers/pilot-auth.ts`).

Настройки — вкладки: themes, security, alerts, tags, templates, users, channels, general, telephony, cdek, ai, sales.

---

## Если FAIL

1. Открой отчёт: `/tmp/crm-full-audit-report.md`
2. Cursor: `@crm-agent-qa` + вставь отчёт
3. `@crm-agent-code-fixer` + баг → **жди «делай»**
4. `npm run agent:full-audit` снова

---

## Полный доступ агентов

| Разрешено | Запрещено |
|-----------|-----------|
| Demo sto-1/2/3 | Production tenant клиентов |
| pilot:seed:clean | DELETE SQL на prod |
| Playwright + curl | Менять .env без «ДА» |
| Создавать тестовые ЗН в demo | force push git |

Code Fixer **всегда согласует** правки рабочего кода.
