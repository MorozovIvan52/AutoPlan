# QA Report — Full Audit Coverage vs Restore (READ-ONLY)

**Статус:** **FAIL** (coverage gaps)  
**Режим:** статический анализ кода, без `agent:full-audit`, без правок, без DB/deploy/commit  
**Контекст:** после overwrite VPS неполной локальной копией восстановлены delivery / zzap / buyouts / assistant / settings (security·alerts·general) / payroll / my-salary; убраны top mobile chip-tabs в Settings

---

## Summary

Текущий e2e (`UI_ROUTES` = 14 страниц, чеклист «14 sidebar») **не совпадает** с реальным меню (`src/lib/nav.ts`, ~22 пункта) и маршрутами (`src/app.tsx`).

Восстановленные модули есть в **NAV + app.tsx + page files**, но **отсутствуют** в `e2e/helpers/pilot-auth.ts` → `UI_ROUTES` / `API_GET_SMOKE`. Полный audit перед оплатой клиента сейчас **ложнозелёный**: не трогает СДЭК, ZZap, выкуп, AI-боты, ЗН-страницу, Деньги, ЗП.

Settings: вкладки `security` / `alerts` / `general` в коде есть; mobile chip-tabs нет; CSS для `.settings-layout` не найден — риск мобильной регрессии.

`docs/ADMIN-CRM.md` описывает страницы, которых **нет** в `src/pages` и `app.tsx` (procurement, gantt, team-activity UI, billing UI, book, zn-edit).

---

## PASS / FAIL gaps

| Область | Вердикт | Детали |
|--------|---------|--------|
| Базовые 14 UI из чеклиста ↔ `UI_ROUTES` | **PASS** | `/`, dashboard, clients, deals, warehouse, sales, tasks, calendar, calls, repairs, team, marketing, analytics, settings |
| NAV / app restored ↔ e2e UI | **FAIL** | Нет: `/assistant`, `/zn`, `/delivery`, `/money` (+секции), `/buyouts`, `/zzap`, `/payroll`, `/my-salary` |
| API restored ↔ `API_GET_SMOKE` | **FAIL** | Нет smoke: cdek, zzap, buyouts, ai, payroll |
| CRM-AUDIT-CHECKLIST актуальность | **FAIL** | «14 страниц» устарело vs NAV |
| ADMIN-CRM ↔ реальные pages/routes | **FAIL (doc drift)** | В доке есть модули без page/route |
| Settings security/alerts/general | **PASS (код)** | Вкладки и контент в `settings.tsx` |
| Settings mobile tabs | **FAIL (регрессия UX)** | Только левый nav 200px, без chip-row / CSS layout |
| Routes без pages | **PASS** для restored | Файлы страниц на месте |
| Pages в NAV без e2e | **FAIL** | см. ниже |
| AdminRoute из ADMIN-CRM | **FAIL (док/код)** | В `app.tsx` только `ProtectedRoute`; `AdminRoute` нет |

---

## Матрица: NAV / app vs checklist vs e2e

| URL | NAV | app.tsx | page file | CRM-AUDIT UI | UI_ROUTES | Примечание |
|-----|-----|---------|-----------|--------------|-----------|------------|
| `/` | ✓ | ✓ | inbox | ✓ | ✓ | |
| `/dashboard` | ✓ | ✓ | ✓ | ✓ | ✓ | |
| `/assistant` | ✓ | ✓ | ✓ | ✗ | ✗ | **restored, gap** |
| `/team` | ✓ | ✓ | ✓ | ✓ | ✓ | |
| `/clients` | ✓ | ✓ | ✓ | ✓ | ✓ | |
| `/deals` | ✓ | ✓ | ✓ | ✓ | ✓ | |
| `/zn`, `/zn/:id` | ✓ | ✓ | zn.tsx | ✗ | ✗ | **gap**; `zn-edit.tsx` в доке — файла нет |
| `/sales` | ✓ | ✓ | ✓ | ✓ | ✓ | |
| `/delivery` | ✓ | ✓ | ✓ | ✗ | ✗ | **restored, gap** |
| `/money`, `/money/:section` | ✓ | ✓ | money.tsx | ✗ | ✗ | **stub UI** (скелет, без API) |
| `/warehouse` | ✓ | ✓ | ✓ | ✓ | ✓ | |
| `/buyouts` | ✓ | ✓ | ✓ | ✗ | ✗ | **restored, gap** |
| `/zzap` | ✓ | ✓ | ✓ | ✗ | ✗ | **restored, gap** |
| `/payroll` | ✓ admin | ✓ | ✓ | ✗ | ✗ | **restored, gap** |
| `/my-salary` | ✓ | ✓ | ✓ | ✗ | ✗ | **restored, gap** |
| `/calendar` | ✓ | ✓ | ✓ | ✓ | ✓ | |
| `/repairs` (+ `/service`) | ✓ | ✓ | ✓ | ✓ | ✓ | `/service` alias есть |
| `/tasks` | ✓ | ✓ | ✓ | ✓ | ✓ | |
| `/calls` | ✓ | ✓ | ✓ | ✓ | ✓ | |
| `/marketing` | ✓ | ✓ | ✓ | ✓ | ✓ | |
| `/analytics` | ✓ admin | ✓ | ✓ | ✓ | ✓ | |
| `/settings` | ✓ | ✓ | ✓ | ✓ | ✓ | tabs OK; mobile risk |
| `/procurement` | ✗ | ✗ | **нет** | ✗ | ✗ | только ADMIN-CRM |
| `/gantt` | ✗ | ✗ | **нет** | ✗ | ✗ | только ADMIN-CRM |
| `/team-activity` | ✗ | ✗ | **нет** | ✗ | ✗ | API есть, UI нет |
| `/admin/billing` | ✗ | ✗ | **нет** | ✗ | ✗ | API route есть |
| `/book` | ✗ | ✗ | **нет** | ✗ | ✗ | public API есть |

**Доказательства:** `src/lib/nav.ts:20-43`, `src/app.tsx:94-124`, `e2e/helpers/pilot-auth.ts:68-110`, `docs/agents/CRM-AUDIT-CHECKLIST.md:39-55`, `docs/ADMIN-CRM.md:24-53`.

---

## MISSING from `UI_ROUTES` (предложить добавить)

```ts
// e2e/helpers/pilot-auth.ts — дополнение UI_ROUTES
{ path: "/assistant", name: "AI-боты" },
{ path: "/zn", name: "ЗН" },
{ path: "/delivery", name: "Доставка" },
{ path: "/money", name: "Деньги" },
{ path: "/money/cash-orders", name: "ПКО / РКО" },
{ path: "/money/bank-statements", name: "Банковские выписки" },
{ path: "/money/cashflow-report", name: "Отчёт ДДС" },
{ path: "/money/bank-import", name: "Загрузка выписок" },
{ path: "/money/charts", name: "Графики ДДС" },
{ path: "/money/client-advances", name: "Авансы клиентов" },
{ path: "/money/supplier-advances", name: "Аванс поставщику" },
{ path: "/buyouts", name: "Выкуп" },
{ path: "/zzap", name: "ZZap" },
{ path: "/payroll", name: "Расчёт ЗП" },        // PILOT_LOGIN=admin
{ path: "/my-salary", name: "Моя зарплата" },
{ path: "/service", name: "Запись (alias)" }, // опционально
```

Минимальный must-have после restore (без money-секций):  
`/assistant`, `/zn`, `/delivery`, `/buyouts`, `/zzap`, `/payroll`, `/my-salary`, `/money`.

---

## MISSING from `API_GET_SMOKE`

```ts
// e2e/helpers/pilot-auth.ts — дополнение API_GET_SMOKE
"/api/cdek/status",
"/api/cdek/settings",
"/api/cdek/shipments",
"/api/zzap/status",
"/api/zzap/settings",
"/api/zzap/lists",
"/api/buyouts",
"/api/buyouts/summary",
"/api/ai/status",
"/api/ai/proposals",
"/api/ai/chat-opportunities",
"/api/payroll/my",
"/api/payroll/roles",          // admin → 200; operator → 403 (отдельный assert)
"/api/payroll/calculations",   // admin
"/api/broadcasts",             // опционально (marketing)
```

Источник вызовов UI:  
`delivery.tsx` → `/api/cdek/*`, `zzap.tsx` → `/api/zzap/*`, `buyouts.tsx` → `/api/buyouts*`, `assistant.tsx` → `/api/ai/*`, `payroll.tsx` / `my-salary.tsx` → `/api/payroll/*`.

---

## P0 / P1 риски (гипотезы + evidence)

### P0

| ID | Гипотеза | Evidence | Почему P0 |
|----|----------|----------|-----------|
| **P0-1** | Full audit не ловит поломку restored-модулей на VPS | `UI_ROUTES`/`API_GET_SMOKE` без delivery/zzap/buyouts/assistant/payroll; чеклист всё ещё «14 страниц» | Pre-billing «зелёный» при мёртвых страницах/API |
| **P0-2** | На VPS после overwrite/restore возможен mismatch bundle ↔ routes (VersionMismatchBanner есть, но e2e не бьёт restored URLs) | `app.tsx` импортирует restored pages; e2e их не открывает | Клиент кликает «Доставка/ZZap/Выкуп» — blank/login/500 без сигнала audit |

*P0 подтверждается только прогоном `PILOT_AUDIT=1` на VPS с расширенным списком — сейчас это **риск покрытия**, не runtime-баг.*

### P1

| ID | Гипотеза | Evidence | Проверка |
|----|----------|----------|----------|
| **P1-1** Settings mobile | Убраны top chip-tabs; остался sidebar `width: 200` без `.settings-layout` CSS / `@media` | `settings.tsx:508-528`; grep `settings-layout` в `styles.css` — пусто | Viewport ≤768: вкладки обрезаны / контент сжат |
| **P1-2** Payroll URL без AdminRoute | Route = `ProtectedRoute`; nav скрывает только пункт | `app.tsx:114`, `Sidebar.tsx:48`, `payroll.tsx:46` (`enabled: isAdmin`) | Operator → `/payroll`: пустой/битый UI (API admin 403 — ок, UX — нет) |
| **P1-3** Money — каркас без бэка | Скелет, disabled controls, «Нет документов» | `money.tsx` (нет `apiFetch`); CSS money есть | Не путать с prod-фичей; e2e должен ждать skeleton, не данные |
| **P1-4** Doc drift ADMIN-CRM | `/procurement`, `/gantt`, `/team-activity`, `/admin/billing`, `/book`, `zn-edit` — нет pages | `ADMIN-CRM.md:38-53` vs `src/pages/*` (26 файлов) | Не слать клиенту как готовые модули |
| **P1-5** Settings tabs после restore | security/alerts/general должны работать end-to-end | Tabs в `ALL_TABS`; alerts→`NotificationSettings`; security→смена пароля; general→`/api/crm/settings` | Ручной/Playwright: переключить 3 вкладки, нет blank |
| **P1-6** ЗН dual path | `/deals` и `/zn` оба в NAV | `nav.ts` deals+zn; `zn.tsx` → `/api/deals` | Путаница UX; audit должен открывать оба |

---

## Settings после restore (фокус)

| Проверка | Статус в коде | Риск |
|----------|---------------|------|
| Tab `security` | Есть (`settings.tsx:40,532+`) | Нужен smoke UI |
| Tab `alerts` | Есть → `<NotificationSettings />` | Нужен smoke UI |
| Tab `general` | Есть (admin + non-admin ветки) | Нужен smoke UI |
| Mobile chip tabs | Удалены намеренно | **P1-1** mobile nav |
| Responsive CSS layout | Классы без стилей | **P1-1** |

Рекомендуемый Playwright (settings deep, не только goto):

```ts
await page.goto("/settings");
for (const label of ["Безопасность", "Оповещения", "Общее"]) {
  await page.getByRole("button", { name: new RegExp(label, "i") }).click();
  await expect(page.locator(".settings-layout__content")).not.toBeEmpty();
}
// mobile
await page.setViewportSize({ width: 390, height: 844 });
await page.goto("/settings");
// assert: вкладки кликабельны / не overflow hidden без доступа
```

---

## Recommended next checks

1. **Расширить** `UI_ROUTES` + `API_GET_SMOKE` (списки выше) — тривиальный gap в test-list; Code Fixer / QA по согласованию.  
2. Прогон VPS:
   ```bash
   PLAYWRIGHT_BASE_URL=https://crmavito.online \
   PLAYWRIGHT_SKIP_WEBSERVER=1 PILOT_AUDIT=1 \
   PILOT_TENANT_SLUG=sto-1 PILOT_LOGIN=admin@sto1.demo \
   npm run agent:full-audit
   ```
3. Ручной smoke restored: `/delivery`, `/zzap`, `/buyouts`, `/assistant` (Scan), `/payroll`, `/my-salary`, `/zn`, `/settings` → security/alerts/general.  
4. Mobile `/settings` @ 390px — подтвердить P1-1.  
5. Operator: `/payroll` прямым URL — подтвердить P1-2.  
6. Обновить `CRM-AUDIT-CHECKLIST.md` («14» → актуальный NAV) и подчистить ADMIN-CRM (убрать/пометить отсутствующие pages).  
7. Не считать Money готовым модулем до появления API.  
8. Не делать DB migrate / commit / deploy в рамках этого QA.

---

## Рекомендации Code Fixer (только после «делай»)

1. `e2e/helpers/pilot-auth.ts` — добавить UI/API списки.  
2. Опционально: `AdminRoute` для `/payroll` (и analytics уже adminOnly в nav).  
3. Settings mobile: либо вернуть chip-row, либо CSS `.settings-layout` (горизонтальный scroll tabs).  
4. Синхронизировать ADMIN-CRM / CRM-AUDIT-CHECKLIST с `nav.ts` + `app.tsx`.

---

## Прогон

| Команда | Результат |
|---------|-----------|
| `npm run agent:full-audit` | **Не запускался** (static coverage report) |
| SQL / migrate / commit / deploy | **Не выполнялись** (safety) |

**Итог для родителя:** покрытие e2e **неполное** относительно restored NAV; статус pre-billing audit по текущему чеклисту — **недостаточен (FAIL gaps)**.