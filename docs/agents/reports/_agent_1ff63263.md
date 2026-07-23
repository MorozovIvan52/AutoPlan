# Docs drift audit — после restore модулей

Сверка: `src/lib/nav.ts`, `src/app.tsx`, `src/pages/*`, `src/pages/settings.tsx` (12 вкладок), `e2e/helpers/pilot-auth.ts` (`UI_ROUTES`). Файлы **не менял** — только предложения.

---

## Устаревшие строки в `docs/ADMIN-CRM.md`

| Место | Сейчас в docs | Реальность |
|-------|---------------|------------|
| §2 Заказ-наряды | `zn.tsx`, **`zn-edit.tsx`** | Только `src/pages/zn.tsx` (+ `/zn`, `/zn/:id` в `app.tsx`) |
| §2 Проценка | `/procurement` → `procurement.tsx` | UI-страницы/роута **нет**; API `api/routes/procurement.ts` есть |
| §2 Ганта | `/gantt` → `gantt.tsx` | Файла и роута **нет** |
| §2 Активность | `/team-activity` → `team-activity.tsx` | UI **нет**; API есть |
| §2 Биллинг SaaS | `/admin/billing` → `admin/BillingPage.tsx` | Frontend-страницы **нет**; только API |
| §2 Публичная запись | `/book` → `book.tsx` | UI **нет**; API `/api/public` |
| §2 целиком | Нет строки про **Деньги** | Есть: `/money`, `/money/:section`, `money.tsx`, flyout в `nav.ts` |
| §3 | «`AdminRoute` в `src/app.tsx`» | `AdminRoute` **нет**; `adminOnly` фильтруется в `Sidebar` по `NAV` |
| §2 сноска | «Меню: `Sidebar.tsx`» | Источник пунктов — **`src/lib/nav.ts`** (+ Sidebar) |
| §4 API | Нет `/orders` | ЗН labor/items идут через `api/routes/orders.ts` (e2e audit это использует) |
| §4 / настройки | Нет описания вкладок Settings | 12 вкладок в `settings.tsx` (см. ниже) |

**Restore-модули в §2 в целом есть** (`/assistant`, `/zn`, `/sales`, `/delivery`, `/buyouts`, `/zzap`, `/payroll`, `/my-salary`) — главный пробел после restore: **`/money`**.

---

## Пробелы в `docs/agents/CRM-AUDIT-CHECKLIST.md`

Матрица: «**14 страниц sidebar**» и таблица UI — совпадают с устаревшим `UI_ROUTES` в `e2e/helpers/pilot-auth.ts`, **не** с текущим `NAV` / `app.tsx`.

**Нет в чеклисте UI (есть в nav + app после restore):**

- `/assistant` — AI-боты  
- `/zn`, `/zn/:id` — ЗН (в матрице есть API-сценарий, в таблице UI — нет)  
- `/delivery` — Доставка  
- `/money` (+ секции: cash-orders, bank-statements, cashflow-report, bank-import, charts, client-advances, supplier-advances)  
- `/buyouts` — Выкуп  
- `/zzap` — ZZap  
- `/payroll` — Расчёт ЗП (admin)  
- `/my-salary` — Моя зарплата  

**Нет проверки вкладок Настроек** (восстановлены / актуальны в коде):

`themes` · `security` · `alerts` · `tags` · `templates` · `users` · `channels` · `general` · `telephony` · `cdek` · `ai` · `sales`

**Слабо покрыто API smoke** (чеклист ссылается на e2e): нет `/api/cdek`, `/api/zzap`, `/api/buyouts`, `/api/payroll`, `/api/ai/*` — при том что UI этих модулей снова в меню.

---

## Предлагаемые правки docs (bullet list)

### `docs/ADMIN-CRM.md` §2

- Добавить строку: **Деньги** | `/money`, `/money/:section` | `src/pages/money.tsx` | все (подменю: `MONEY_PRIMARY` / `MONEY_RELATED` в `nav.ts`).
- ЗН: убрать `zn-edit.tsx` → только `zn.tsx`.
- Пометить как «API only / нет UI» или вынести: `/procurement`, `/gantt`, `/team-activity`, `/admin/billing`, `/book` — либо удалить из таблицы UI.
- Сноску: «Маршруты: `app.tsx`. Меню: `nav.ts` → `Sidebar.tsx`».
- §3: заменить `AdminRoute` на «скрытие `adminOnly` в Sidebar; route-guard в app пока общий `ProtectedRoute`».
- Опционально новый мини-§: **Настройки — вкладки** (12 шт. с русскими лейблами из `TAB_LABELS`).
- §4: добавить **Заказы ЗН** | `/orders` | `api/routes/orders.ts`; для Money — явно «UI scaffold, отдельного `/api/money` нет».

### `docs/agents/CRM-AUDIT-CHECKLIST.md`

- Матрица #3: «14 страниц» → «все маршруты из `UI_ROUTES` / NAV (~22+)».
- Дописать строки UI: assistant, zn, delivery, money (+ ключевые секции), buyouts, zzap, payroll, my-salary.
- Добавить блок **Settings tabs** (12 вкладок) — хотя бы smoke click / visible content.
- Синхронизировать с `e2e/helpers/pilot-auth.ts` `UI_ROUTES` (иначе чеклист «auto» врёт).
- Опционально расширить матрицу API: cdek / zzap / buyouts / payroll / ai proposals.

### Не коммитить / не править без отдельной задачи

- Сами `UI_ROUTES` / e2e — это код, не docs; в этом аудите только отметить drift.
- Demo-пароли в safety-файлах — не трогать в ADMIN.

---

## Вердикт

| Документ | После restore |
|----------|----------------|
| `ADMIN-CRM.md` | Restore-страницы в основном отражены; **критично нет `/money`**; мусор по несуществующим UI (`gantt`, `zn-edit`, `book`, `BillingPage`, `AdminRoute`). |
| `CRM-AUDIT-CHECKLIST.md` | **Сильно отстаёт**: чеклист всё ещё на старых 14 страницах; restore-модули и вкладки settings в UI-таблице отсутствуют. |

Рекомендация: сначала патч чеклиста + `UI_ROUTES`, затем зачистка §2 ADMIN-CRM. Код и git не трогал.