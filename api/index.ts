import { Hono } from "hono";
import { cors } from "hono/cors";
import { db } from "./database";
import * as schema from "./database/schema";
import { auth } from "./routes/auth";
import { clients } from "./routes/clients";
import { tags } from "./routes/tags";
import { conversations } from "./routes/conversations";
import { deals } from "./routes/deals";
import { notifications } from "./routes/notifications";
import { channels } from "./routes/channels";
import { users } from "./routes/users";
import { webhooks } from "./routes/webhooks";
import { analytics } from "./routes/analytics";
import { tasks } from "./routes/tasks";
import { vehicles } from "./routes/vehicles";
import { parts } from "./routes/parts";
import { templates } from "./routes/templates";
import { orders } from "./routes/orders";
import { service } from "./routes/service";
import { ai } from "./routes/ai";
import { broadcasts } from "./routes/broadcasts";
import { calls } from "./routes/calls";
import { telephony } from "./routes/telephony";
import { cdek } from "./routes/cdek";
import { buyouts } from "./routes/buyouts";
import { zzap } from "./routes/zzap";
import { teamChat } from "./routes/team-chat";
import { crmSettingsRoute } from "./routes/crm-settings";
import { avito } from "./routes/avito";
import { teamActivity } from "./routes/team-activity";
import { payroll } from "./routes/payroll";
import { sales } from "./routes/sales";
import { procurement } from "./routes/procurement";
import { stoExtended } from "./routes/sto-extended";
import { stoInventory } from "./routes/sto-inventory";
import { supplierOrders } from "./routes/supplier-orders";
import { integrationsRoute } from "./routes/integrations";
import { clientErrors } from "./routes/client-errors";
import { supportChat } from "./routes/support/chat";
import { docsRoute } from "./routes/docs";
import { onboarding } from "./routes/onboarding";
import { importsRoute } from "./routes/imports";
import { exportRoute } from "./routes/export";
import { publicBooking } from "./routes/public-booking";
import { tenants as tenantsRoute } from "./routes/tenants";
import { adminBilling } from "./routes/admin/billing";
import { adminClients } from "./routes/admin/clients";
import { stripeWebhook } from "./routes/webhooks/stripe";
import { uploads, handleUploadPost, handleUploadGet } from "./routes/uploads";
import { requireAuth, requireAdmin } from "./middleware/auth";
import { resolveTenant, enforceSubscriptionOnMutations } from "./middleware/tenant";
import { enforceLicenseOffer } from "./middleware/license-offer";
import { securityHeaders } from "./middleware/security";
import { csrfProtection } from "./middleware/csrf";
import { requestLog } from "./middleware/request-log";
import { corsOriginHeader } from "./lib/cors-origins";
import { log } from "./lib/logger";
import { licenseOffer } from "./routes/license-offer";
import { CHANNEL_TYPES } from "./lib/channel-config";
import { getPublicUrl } from "./lib/config";
import { hasUsers, runInitialSetup } from "./lib/setup";
import { validatePasswordStrength } from "./lib/password";
import { collectHealth, prometheusMetrics } from "./lib/ops-metrics";
import { isProduction, isPublicDeployment } from "./lib/env";
import { timingSafeEqualText } from "./middleware/security";

const app = new Hono()
  .basePath("/api")
  .use(securityHeaders)
  .use(requestLog)
  .use(cors({ origin: corsOriginHeader, credentials: true }))
  .use(csrfProtection)
  .use("*", resolveTenant)
  .use("*", enforceSubscriptionOnMutations)
  .use("*", enforceLicenseOffer)
  .get("/health", async (c) => {
    if (isPublicDeployment()) {
      return c.json({ status: "ok" }, 200);
    }
    const health = await collectHealth();
    return c.json(health, health.status === "ok" ? 200 : 503);
  })
  .get("/metrics", async (c) => {
    const token = process.env.METRICS_TOKEN?.trim();
    if (isProduction() && !token) {
      return c.text("Metrics disabled", 503);
    }
    if (token) {
      const auth = c.req.header("Authorization") || "";
      const provided = auth.startsWith("Bearer ") ? auth.slice(7) : (c.req.query("token") || "");
      if (!provided || !timingSafeEqualText(provided, token)) return c.text("Unauthorized", 401);
    }
    return c.text(await prometheusMetrics(), 200, { "Content-Type": "text/plain; charset=utf-8" });
  })

  .post("/uploads", requireAuth, handleUploadPost)
  .get("/uploads/:filename", requireAuth, handleUploadGet)

  .route("/auth", auth)
  .route("/license-offer", licenseOffer)
  .route("/public", publicBooking)
  .route("/tenants", tenantsRoute)
  .route("/admin/billing", adminBilling)
  .route("/admin/clients", adminClients)
  .route("/webhooks/stripe", stripeWebhook)
  .route("/clients", clients)
  .route("/tags", tags)
  .route("/conversations", conversations)
  .route("/deals", deals)
  .route("/notifications", notifications)
  .route("/channels", channels)
  .route("/users", users)
  .route("/webhooks", webhooks)
  .route("/analytics", analytics)
  .route("/tasks", tasks)
  .route("/vehicles", vehicles)
  .route("/parts", parts)
  .route("/templates", templates)
  .route("/orders", orders)
  .route("/service", service)
  .route("/ai", ai)
  .route("/support", supportChat)
  .route("/docs", docsRoute)
  .route("/broadcasts", broadcasts)
  .route("/calls", calls)
  .route("/telephony", telephony)
  .route("/cdek", cdek)
  .route("/buyouts", buyouts)
  .route("/zzap", zzap)
  .route("/team-chat", teamChat)
  .route("/crm/settings", crmSettingsRoute)
  .route("/avito", avito)
  .route("/team-activity", teamActivity)
  .route("/payroll", payroll)
  .route("/sales", sales)
  .route("/procurement", procurement)
  .route("/sto", stoExtended)
  .route("/sto/inventory", stoInventory)
  .route("/supplier-orders", supplierOrders)
  .route("/integrations", integrationsRoute)
  .route("/onboarding", onboarding)
  .route("/imports", importsRoute)
  .route("/export", exportRoute)
  .route("/client-errors", clientErrors)
  .route("/uploads", uploads)

  .get("/integrations/types", (c) => c.json({ types: CHANNEL_TYPES, publicUrl: getPublicUrl(), product: "CRM АвтоПлан" }, 200))

  // CLI seed (только пустая БД; в продакшене задайте INSTALL_SECRET)
  .post("/seed", async (c) => {
    if (await hasUsers()) return c.json({ error: "Already seeded" }, 400);

    const body = await c.req.json().catch(() => ({})) as {
      email?: string; password?: string; name?: string; installKey?: string;
    };

    const isProd = isProduction();
    const installKey = process.env.INSTALL_SECRET?.trim();
    if (isProd && !installKey) {
      return c.json({ error: "Используйте мастер настройки на экране входа (/api/auth/setup)" }, 403);
    }
    if (installKey) {
      const provided = c.req.header("x-install-key") || body.installKey || "";
      if (!provided || !timingSafeEqualText(provided, installKey)) return c.json({ error: "Forbidden" }, 403);
    }

    const email = (body.email || "admin@crm.local").trim().toLowerCase();
    const password = body.password || "";
    if (!password) return c.json({ error: "Укажите password в теле запроса" }, 400);
    const pwErr = validatePasswordStrength(password, email);
    if (pwErr) return c.json({ error: pwErr }, 400);

    await runInitialSetup({ email, password, name: body.name || "Admin" });
    return c.json({ ok: true, message: "CRM инициализирована. Войдите с указанным email и паролем." }, 200);
  })

  .post("/seed-auto", requireAuth, requireAdmin, async (c) => {
    const [tpl] = await db.select().from(schema.quickTemplates).limit(1);
    if (!tpl) {
      await db.insert(schema.quickTemplates).values([
        { title: "Приветствие", text: "Здравствуйте, {имя}! Чем могу помочь?", category: "general", sortOrder: 0 },
        { title: "Запрос VIN", text: "Здравствуйте! Для точного подбора запчасти пришлите VIN (17 символов) или марку/модель/год и объём двигателя.", category: "parts", sortOrder: 1 },
        { title: "В наличии", text: "Запчасть есть в наличии. Можете забрать сегодня или оформим доставку — как удобнее?", category: "parts", sortOrder: 2 },
        { title: "Оригинал и аналог", text: "Подготовил варианты: оригинал и качественный аналог. Напишите, какой вариант выбираете.", category: "parts", sortOrder: 3 },
        { title: "КП по Авито", text: "По объявлению «{товар}» — цена {цена} ₽. Уточните VIN для проверки применяемости.", category: "parts", sortOrder: 4 },
        { title: "Запись на СТО", text: "Можем записать на диагностику/ремонт. Укажите удобную дату и время.", category: "service", sortOrder: 5 },
        { title: "Ожидайте", text: "Сейчас уточню наличие и цену, отвечу в течение 15–30 минут.", category: "general", sortOrder: 6 },
        { title: "Самовывоз", text: "Самовывоз: адрес и время работы отправлю после подтверждения заказа.", category: "delivery", sortOrder: 7 },
        { title: "СДЭК", text: "Доставка СДЭК: укажите город и пункт выдачи, рассчитаю стоимость.", category: "delivery", sortOrder: 8 },
        { title: "Оплата", text: "Итого: ___ ₽. Оплата переводом/по реквизитам. Отправлю после подтверждения.", category: "general", sortOrder: 9 },
      ]);
    }
    const [part] = await db.select().from(schema.partsStock).limit(1);
    if (!part) {
      await db.insert(schema.partsStock).values([
        { article: "BP1234", brand: "Bosch", name: "Колодки тормозные передние", category: "Тормоза", qty: 12, price: 3200, location: "A-12" },
        { article: "OC90", brand: "Mahle", name: "Фильтр масляный", category: "Фильтры", qty: 45, price: 450, location: "B-03" },
      ]);
    }
    return c.json({ ok: true, message: "Демо-данные автобизнеса добавлены" }, 200);
  })
  .onError((err, c) => {
    const requestId = c.get("requestId") as string | undefined;
    log.error({ requestId, err: err.message }, "unhandled");
    return c.json({ error: "Internal server error", requestId }, 500);
  });

export type AppType = typeof app;
export default app;
