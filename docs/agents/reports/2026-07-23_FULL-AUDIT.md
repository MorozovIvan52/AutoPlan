# CRM Full Audit Report

- Time: 2026-07-23T08:15:35+00:00
- API: https://crmavito.online
- Playwright: https://crmavito.online
- Pilot tenant: sto-1 (admin@sto1.demo)

## Context
Context written: /tmp/crm-audit-ctx.txt
=== CRM Agent Context 2026-07-23T08:15:35+00:00 ===
ROOT=/opt/crm
NODE=v20.20.2
PUBLIC_URL=not set
DATABASE_URL=not set
PG_RLS=not set
TENANT_BASE=not set

=== Git ===
no git

=== Pilot manifest ===
{
  "password": "PilotDemo2026!",
  "tenants": [
    {
      "slug": "sto-1",
      "id": 6,
      "subdomain": "sto1",
      "users": [
        {
          "role": "master",
          "email": "master@sto1.demo",
          "id": 19
        },
        {
          "role": "admin",
          "email": "admin@sto1.demo",
          "id": 20
        },
        {
          "role": "accountant",
          "email": "accountant@sto1.demo",
          "id": 21
        }
      ],
      "clientId": 5274,
      "conversationId": 5759,
      "deals": {
        "closedId": 615,
        "draftId": 616
      },
      "racePartId": 26,
      "racePartArticle": "PILOT-1-RACE",
      "receiptDocId": 11
    },
    {
      "slug": "sto-2",
      "id": 7,
      "subdomain": "sto2",
      "users": [
        {
          "role": "master",
          "email": "master@sto2.demo",
          "id": 22
        },
        {
          "role": "admin",
          "email": "admin@sto2.demo",
          "id": 23
        },
        {
          "role": "accountant",
          "email": "accountant@sto2.demo",
          "id": 24
        }
      ],
      "clientId": 5275,
      "conversationId": 5760,
      "deals": {
        "closedId": 617,
        "draftId": 618
      },
      "racePartId": 31,
      "racePartArticle": "PILOT-2-RACE",
      "receiptDocId": 12
    },
    {
      "slug": "sto-3",
      "id": 8,
      "subdomain": "sto3",
      "users": [
        {
          "role": "master",
          "email": "master@sto3.demo",
          "id": 25
        },
        {
          "role": "admin",
          "email": "admin@sto3.demo",
          "id": 26
        },
        {
          "role": "accountant",
          "email": "accountant@sto3.demo",
          "id": 27
        }
      ],
      "clientId": 5276,
      "conversationId": 5761,
      "deals": {
        "closedId": 619,
        "draftId": 620
      },
      "racePartId": 36,
      "racePartArticle": "PILOT-3-RACE",
      "receiptDocId": 13
    }
  ]
}
=== Health ===
{"status":"ok"}
=== PM2 (if VPS) ===
crm online uptime 1784794386374

=== Subdomains DNS ===
sto1.crmavito.online -> 159.194.207.50
sto2.crmavito.online -> 159.194.207.50
sto3.crmavito.online -> 159.194.207.50
=== CRM Agent Context 2026-07-23T08:15:35+00:00 ===
ROOT=/opt/crm
NODE=v20.20.2
PUBLIC_URL=not set
DATABASE_URL=not set
PG_RLS=not set
TENANT_BASE=not set

=== Git ===
no git

=== Pilot manifest ===
{
  "password": "PilotDemo2026!",
  "tenants": [
    {
      "slug": "sto-1",
      "id": 6,
      "subdomain": "sto1",
      "users": [
        {
          "role": "master",
          "email": "master@sto1.demo",
          "id": 19
        },
        {
          "role": "admin",
          "email": "admin@sto1.demo",
          "id": 20
        },
        {
          "role": "accountant",
          "email": "accountant@sto1.demo",
          "id": 21
        }
      ],
      "clientId": 5274,
      "conversationId": 5759,
      "deals": {
        "closedId": 615,
        "draftId": 616
      },
      "racePartId": 26,
      "racePartArticle": "PILOT-1-RACE",
      "receiptDocId": 11
    },
    {
      "slug": "sto-2",
      "id": 7,
      "subdomain": "sto2",
      "users": [
        {
          "role": "master",
          "email": "master@sto2.demo",
          "id": 22
        },
        {
          "role": "admin",
          "email": "admin@sto2.demo",
          "id": 23
        },
        {
          "role": "accountant",
          "email": "accountant@sto2.demo",
          "id": 24
        }
      ],
      "clientId": 5275,
      "conversationId": 5760,
      "deals": {
        "closedId": 617,
        "draftId": 618
      },
      "racePartId": 31,
      "racePartArticle": "PILOT-2-RACE",
      "receiptDocId": 12
    },
    {
      "slug": "sto-3",
      "id": 8,
      "subdomain": "sto3",
      "users": [
        {
          "role": "master",
          "email": "master@sto3.demo",
          "id": 25
        },
        {
          "role": "admin",
          "email": "admin@sto3.demo",
          "id": 26
        },
        {
          "role": "accountant",
          "email": "accountant@sto3.demo",
          "id": 27
        }
      ],
      "clientId": 5276,
      "conversationId": 5761,
      "deals": {
        "closedId": 619,
        "draftId": 620
      },
      "racePartId": 36,
      "racePartArticle": "PILOT-3-RACE",
      "receiptDocId": 13
    }
  ]
}
=== Health ===
{"status":"ok"}
=== PM2 (if VPS) ===
crm online uptime 1784794386374

=== Subdomains DNS ===
sto1.crmavito.online -> 159.194.207.50
sto2.crmavito.online -> 159.194.207.50
sto3.crmavito.online -> 159.194.207.50

## pilot:verify (API smoke)
=== 1. Мастер sto-1: только свои ЗН ===
{"user":{"id":19,"tenantId":6,"name":"Мастер СТО-1","email":"master@sto1.demo","role":"master","avatarUrl":null,"theme":"dark-navy","navHidden":null,"navOrder":null,"isActive":true,"phoneExte
count 2
OK: >=2 service deals for sto-1
=== 2. Утечка tenant: master sto-1 + header sto-2 → 403 ===
OK: HTTP 403
=== 3. Race condition: два close на draft ЗН с qty=1 ===
{"user":{"id":20,"tenantId":6,"name":"Админ СТО-1","email":"admin@sto1.demo","role":"admin","avatarUrl":null,"theme":"dark-navy","navHidden":null,"navOrder":null,"isActive":true,"phoneExtensio
{"deal":{"id":616,"status":"done","paymentStatus":"paid","paidAmount":4500,"amount":4500},"doc":{"id":0,"docNumber":"","status":"posted","totalAmount":4500,"paymentAmount":4500},"debt":0,"stock":{"deducted":0,"skippedNoStockPartId":0},"reservesReleased":0,"idempotent":true}{"deal":{"id":616,"status":"done","paymentStatus":"paid","paidAmount":4500,"amount":4500},"doc":{"id":0,"docNumber":"","status":"posted","totalAmount":4500,"paymentAmount":4500},"debt":0,"stock":{"deducted":0,"skippedNoStockPartId":0},"reservesReleased":0,"idempotent":true}qty after race 0
OK: stock not negative
=== 4. Печать / PDF по ЗН (order doc) ===
OK: docs/generate responded
=== 5. Чат: последние сообщения ===
messages 5
OK: >=5 messages
✅ All pilot tests passed
✅ PASS: pilot:verify (API smoke)

## typecheck

> crm-platform@1.0.0 typecheck
> tsc --noEmit

api/lib/avito-cpa-monitor.ts(308,18): error TS2367: This comparison appears to be unintentional because the types '"low" | "empty" | "ok" | "unknown"' and '"error"' have no overlap.
api/lib/avito-poll.ts(7,32): error TS2307: Cannot find module './messaging' or its corresponding type declarations.
api/lib/avito-poll.ts(8,27): error TS2307: Cannot find module './ws' or its corresponding type declarations.
server.ts(62,19): error TS2345: Argument of type 'WebSocket' is not assignable to parameter of type 'WsClient'.
  Property 'userId' is missing in type 'WebSocket' but required in type 'WsClient'.
server.ts(63,43): error TS2345: Argument of type 'WebSocket' is not assignable to parameter of type 'WsClient'.
  Property 'userId' is missing in type 'WebSocket' but required in type 'WsClient'.
src/components/ClientPanel.tsx(164,24): error TS2339: Property 'client' does not exist on type '{}'.
src/components/ClientPanel.tsx(165,36): error TS2339: Property 'tags' does not exist on type '{}'.
src/pages/analytics.tsx(1,1662): error TS2339: Property 'overview' does not exist on type '{}'.
src/pages/analytics.tsx(1,1710): error TS2339: Property 'bySource' does not exist on type '{}'.
src/pages/analytics.tsx(1,1758): error TS2339: Property 'byStatus' does not exist on type '{}'.
src/pages/analytics.tsx(1,1808): error TS2339: Property 'byOperator' does not exist on type '{}'.
src/pages/clients.tsx(1,1878): error TS2339: Property 'clients' does not exist on type '{}'.
src/pages/clients.tsx(1,1925): error TS2339: Property 'tags' does not exist on type '{}'.
src/pages/dashboard.tsx(1,522): error TS2339: Property 'overview' does not exist on type '{}'.
src/pages/dashboard.tsx(1,563): error TS2339: Property 'bySource' does not exist on type '{}'.
src/pages/settings.tsx(503,33): error TS2339: Property 'tags' does not exist on type '{}'.
src/pages/settings.tsx(504,35): error TS2339: Property 'users' does not exist on type '{}'.
src/pages/settings.tsx(505,41): error TS2339: Property 'channels' does not exist on type '{}'.
src/pages/settings.tsx(506,43): error TS2339: Property 'templates' does not exist on type '{}'.
src/pages/settings.tsx(1096,36): error TS2339: Property 'users' does not exist on type '{}'.
src/pages/settings.tsx(1112,38): error TS2339: Property 'users' does not exist on type '{}'.
❌ FAIL: typecheck (exit 2)

## unit tests

> crm-platform@1.0.0 test:unit
> node --import tsx --test api/lib/close-deal-with-payment.test.ts api/lib/password.test.ts api/lib/tenant-limits.test.ts api/lib/tenant-context.test.ts api/middleware/security.test.ts

TAP version 13
# Subtest: paymentStatusOf: unpaid / partial / paid
ok 1 - paymentStatusOf: unpaid / partial / paid
  ---
  duration_ms: 3.683976
  ...
# Subtest: dealDebt never negative
ok 2 - dealDebt never negative
  ---
  duration_ms: 0.413616
  ...
# Subtest: round2
ok 3 - round2
  ---
  duration_ms: 0.293469
  ...
# Subtest: scrypt hash verifies and does not need rehash
ok 4 - scrypt hash verifies and does not need rehash
  ---
  duration_ms: 332.452514
  ...
# Subtest: legacy SHA-256 fails closed without AUTH_SALT
ok 5 - legacy SHA-256 fails closed without AUTH_SALT
  ---
  duration_ms: 5.309854
  ...
# Subtest: legacy SHA-256 verifies with AUTH_SALT and needs rehash
ok 6 - legacy SHA-256 verifies with AUTH_SALT and needs rehash
  ---
  duration_ms: 1.8133
  ...
# Subtest: getTenantId throws without context (no silent fallback to 1)
ok 7 - getTenantId throws without context (no silent fallback to 1)
  ---
  duration_ms: 2.108463
  ...
# Subtest: getTenantId returns ALS value inside runWithTenant
ok 8 - getTenantId returns ALS value inside runWithTenant
  ---
  duration_ms: 0.795803
  ...
# Subtest: start plan has a small user limit
ok 9 - start plan has a small user limit
  ---
  duration_ms: 1.148623
  ...
# Subtest: business plan allows more users
ok 10 - business plan allows more users
  ---
  duration_ms: 0.22385
  ...
# Subtest: quota check blocks when the limit is reached
ok 11 - quota check blocks when the limit is reached
  ---
  duration_ms: 0.20829
  ...
# Subtest: clientIp uses socket when TRUST_PROXY is off
ok 12 - clientIp uses socket when TRUST_PROXY is off
  ---
  duration_ms: 1.296261
  ...
# Subtest: clientIp ignores spoofed XFF without trusted proxy peer
ok 13 - clientIp ignores spoofed XFF without trusted proxy peer
  ---
  duration_ms: 0.310823
  ...
# Subtest: clientIp parses XFF when peer is trusted proxy
ok 14 - clientIp parses XFF when peer is trusted proxy
  ---
  duration_ms: 0.328536
  ...
1..14
# tests 14
# suites 0
# pass 14
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 1177.180781
✅ PASS: unit tests

## Playwright full-crm-audit (UI + API + ЗН)

Running 10 tests using 1 worker

  ✘   1 [chromium] › e2e/full-crm-audit.spec.ts:38:3 › Full CRM Audit › 01 — все страницы UI открываются без падения (4ms)
  -   2 [chromium] › e2e/full-crm-audit.spec.ts:65:3 › Full CRM Audit › 02 — все основные GET API отвечают 200
  -   3 [chromium] › e2e/full-crm-audit.spec.ts:80:3 › Full CRM Audit › 03 — ЗН: создать → работа → запчасть → close-with-payment
  -   4 [chromium] › e2e/full-crm-audit.spec.ts:141:3 › Full CRM Audit › 04 — чат: сообщения demo-диалога
  -   5 [chromium] › e2e/full-crm-audit.spec.ts:169:3 › Full CRM Audit › 05 — склад: список и race-запчасть не в минусе
  -   6 [chromium] › e2e/full-crm-audit.spec.ts:184:3 › Full CRM Audit › 06 — товарный чек / sales
  -   7 [chromium] › e2e/full-crm-audit.spec.ts:195:3 › Full CRM Audit › 07 — изоляция tenant (pilot only)
  -   8 [chromium] › e2e/full-crm-audit.spec.ts:212:3 › Full CRM Audit › 08 — UI: страница заказов открывает список ЗН
  -   9 [chromium] › e2e/full-crm-audit.spec.ts:220:3 › Full CRM Audit › 09 — UI: склад открывается
  -  10 [chromium] › e2e/full-crm-audit.spec.ts:226:3 › Full CRM Audit › 10 — UI: продажи / чеки


  1) [chromium] › e2e/full-crm-audit.spec.ts:38:3 › Full CRM Audit › 01 — все страницы UI открываются без падения 

    Error: browserType.launch: Target page, context or browser has been closed
    Browser logs:

    <launching> /root/.cache/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-linux64/chrome-headless-shell --disable-field-trial-config --disable-background-networking --disable-background-timer-throttling --disable-backgrounding-occluded-windows --disable-back-forward-cache --disable-breakpad --disable-client-side-phishing-detection --disable-component-extensions-with-background-pages --disable-component-update --no-default-browser-check --disable-default-apps --disable-dev-shm-usage --disable-edgeupdater --disable-extensions --disable-features=AvoidUnnecessaryBeforeUnloadCheckSync,BoundaryEventDispatchTracksNodeRemoval,DestroyProfileOnBrowserClose,DialMediaRouteProvider,GlobalMediaControls,HttpsUpgrades,LensOverlay,MediaRouter,PaintHolding,ThirdPartyStoragePartitioning,Translate,AutoDeElevate,RenderDocument,OptimizationHints,msForceBrowserSignIn,msEdgeUpdateLaunchServicesPreferredVersion --enable-features=CDPScreenshotNewSurface --allow-pre-commit-input --disable-hang-monitor --disable-ipc-flooding-protection --disable-popup-blocking --disable-prompt-on-repost --disable-renderer-backgrounding --force-color-profile=srgb --metrics-recording-only --no-first-run --password-store=basic --use-mock-keychain --no-service-autorun --export-tagged-pdf --disable-search-engine-choice-screen --unsafely-disable-devtools-self-xss-warnings --edge-skip-compat-layer-relaunch --disable-infobars --disable-search-engine-choice-screen --disable-sync --enable-unsafe-swiftshader --headless --hide-scrollbars --mute-audio --blink-settings=primaryHoverType=2,availableHoverTypes=2,primaryPointerType=4,availablePointerTypes=4 --no-sandbox --user-data-dir=/tmp/playwright_chromiumdev_profile-aYsIna --remote-debugging-pipe --no-startup-window
    <launched> pid=345945
    [pid=345945][err] /root/.cache/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-linux64/chrome-headless-shell: error while loading shared libraries: libatk-1.0.so.0: cannot open shared object file: No such file or directory
    Call log:
      - <launching> /root/.cache/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-linux64/chrome-headless-shell --disable-field-trial-config --disable-background-networking --disable-background-timer-throttling --disable-backgrounding-occluded-windows --disable-back-forward-cache --disable-breakpad --disable-client-side-phishing-detection --disable-component-extensions-with-background-pages --disable-component-update --no-default-browser-check --disable-default-apps --disable-dev-shm-usage --disable-edgeupdater --disable-extensions --disable-features=AvoidUnnecessaryBeforeUnloadCheckSync,BoundaryEventDispatchTracksNodeRemoval,DestroyProfileOnBrowserClose,DialMediaRouteProvider,GlobalMediaControls,HttpsUpgrades,LensOverlay,MediaRouter,PaintHolding,ThirdPartyStoragePartitioning,Translate,AutoDeElevate,RenderDocument,OptimizationHints,msForceBrowserSignIn,msEdgeUpdateLaunchServicesPreferredVersion --enable-features=CDPScreenshotNewSurface --allow-pre-commit-input --disable-hang-monitor --disable-ipc-flooding-protection --disable-popup-blocking --disable-prompt-on-repost --disable-renderer-backgrounding --force-color-profile=srgb --metrics-recording-only --no-first-run --password-store=basic --use-mock-keychain --no-service-autorun --export-tagged-pdf --disable-search-engine-choice-screen --unsafely-disable-devtools-self-xss-warnings --edge-skip-compat-layer-relaunch --disable-infobars --disable-search-engine-choice-screen --disable-sync --enable-unsafe-swiftshader --headless --hide-scrollbars --mute-audio --blink-settings=primaryHoverType=2,availableHoverTypes=2,primaryPointerType=4,availablePointerTypes=4 --no-sandbox --user-data-dir=/tmp/playwright_chromiumdev_profile-aYsIna --remote-debugging-pipe --no-startup-window
      - <launched> pid=345945
      - [pid=345945][err] /root/.cache/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-linux64/chrome-headless-shell: error while loading shared libraries: libatk-1.0.so.0: cannot open shared object file: No such file or directory
      - [pid=345945] <gracefully close start>
      - [pid=345945] <kill>
      - [pid=345945] <will force kill>
      - [pid=345945] exception while trying to kill process: Error: kill ESRCH
      - [pid=345945] <process did exit: exitCode=127, signal=null>
      - [pid=345945] starting temporary directories cleanup
      - [pid=345945] finished temporary directories cleanup
      - [pid=345945] <gracefully close end>


    Error Context: test-results/full-crm-audit-Full-CRM-Au-d2d1a--UI-открываются-без-падения-chromium/error-context.md

  1 failed
    [chromium] › e2e/full-crm-audit.spec.ts:38:3 › Full CRM Audit › 01 — все страницы UI открываются без падения 
  9 did not run
❌ FAIL: Playwright full-crm-audit (UI + API + ЗН) (exit 1)

---
## Summary
- PASS: 2
- FAIL: 2

❌ **FULL CRM AUDIT FAILED** — передай отчёт @crm-agent-qa → @crm-agent-code-fixer
