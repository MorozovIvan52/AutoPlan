import { sqliteTable, text, integer, real, uniqueIndex } from "drizzle-orm/sqlite-core";

// ── SaaS: организации (тенанты) ───────────────────────────────────────────────
export const tenants = sqliteTable("tenants", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  subdomain: text("subdomain").unique(),
  subscriptionStatus: text("subscription_status", {
    enum: ["active", "trial", "expired", "suspended"],
  }).notNull().default("active"),
  subscriptionPlan: text("subscription_plan").default("start"),
  trialEndsAt: integer("trial_ends_at", { mode: "timestamp" }),
  maxUsers: integer("max_users").default(3),
  isActive: integer("is_active", { mode: "boolean" }).default(true),
  /** Акцепт лицензионной оферты (SMS) */
  offerAcceptedAt: integer("offer_accepted_at", { mode: "timestamp" }),
  offerAcceptedPhone: text("offer_accepted_phone"),
  offerAcceptedByUserId: integer("offer_accepted_by_user_id"),
  offerVersion: text("offer_version"),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
});

// ── Users / Operators ──────────────────────────────────────────────────────────
export const users = sqliteTable("users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  tenantId: integer("tenant_id").notNull().default(1).references(() => tenants.id),
  name: text("name").notNull(),
  email: text("email").notNull(),
  passwordHash: text("password_hash").notNull(),
  role: text("role", { enum: ["admin", "operator", "demo", "master"] }).notNull().default("operator"),
  avatarUrl: text("avatar_url"),
  theme: text("theme").default("dark-navy"),
  /** JSON-массив path пунктов меню, скрытых пользователем */
  navHidden: text("nav_hidden"),
  /** JSON-массив path — порядок пунктов в боковом меню */
  navOrder: text("nav_order"),
  isActive: integer("is_active", { mode: "boolean" }).default(true),
  phoneExtension: text("phone_extension"),
  payrollRoleId: integer("payroll_role_id"),
  onboardingCompleted: integer("onboarding_completed", { mode: "boolean" }).default(false),
  isChampion: integer("is_champion", { mode: "boolean" }).default(false),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
}, (t) => ({
  usersTenantEmailUnique: uniqueIndex("users_tenant_email_unique").on(t.tenantId, t.email),
}));

/** Одноразовые SMS-коды для акцепта оферты */
export const licenseOfferOtps = sqliteTable("license_offer_otps", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  tenantId: integer("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  phone: text("phone").notNull(),
  codeHash: text("code_hash").notNull(),
  attempts: integer("attempts").default(0),
  expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
});

export const sessions = sqliteTable("sessions", {
  id: text("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
});

// ── Tags ───────────────────────────────────────────────────────────────────────
export const tags = sqliteTable("tags", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  tenantId: integer("tenant_id").notNull().default(1).references(() => tenants.id),
  name: text("name").notNull(),
  color: text("color").notNull().default("#2563eb"),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
});

// ── Clients ────────────────────────────────────────────────────────────────────
export const clients = sqliteTable("clients", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  tenantId: integer("tenant_id").notNull().default(1).references(() => tenants.id),
  name: text("name").notNull(),
  phone: text("phone"),
  email: text("email"),
  avatarUrl: text("avatar_url"),
  source: text("source").default("manual"),
  externalId: text("external_id"),
  notes: text("notes"),
  productInterest: text("product_interest"),
  company: text("company"),
  clientType: text("client_type").default("retail"),
  clientInn: text("client_inn"),
  clientKpp: text("client_kpp"),
  legalAddress: text("legal_address"),
  /** Предпочитаемый мессенджер: whatsapp | telegram | sms | avito | auto */
  preferredMessenger: text("preferred_messenger").default("auto"),
  /** Скидка по карте лояльности, % */
  discountPercent: integer("discount_percent").default(0),
  loyaltyCard: text("loyalty_card"),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
  isDemo: integer("is_demo", { mode: "boolean" }).default(false),
});

// ── Vehicles (авто клиента) ────────────────────────────────────────────────────
export const vehicles = sqliteTable("vehicles", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  clientId: integer("client_id").notNull().references(() => clients.id, { onDelete: "cascade" }),
  vin: text("vin"),
  plate: text("plate"),
  make: text("make"),
  model: text("model"),
  year: integer("year"),
  mileage: integer("mileage"),
  engine: text("engine"),
  notes: text("notes"),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
});

// ── Client ↔ Tag (many-to-many) ────────────────────────────────────────────────
export const clientTags = sqliteTable("client_tags", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  clientId: integer("client_id").notNull().references(() => clients.id, { onDelete: "cascade" }),
  tagId: integer("tag_id").notNull().references(() => tags.id, { onDelete: "cascade" }),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
});

// ── Client Comments ────────────────────────────────────────────────────────────
export const clientComments = sqliteTable("client_comments", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  clientId: integer("client_id").notNull().references(() => clients.id, { onDelete: "cascade" }),
  userId: integer("user_id").references(() => users.id),
  text: text("text").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
});

// ── Channels (Telegram bots, Avito accounts) ───────────────────────────────────
export const channels = sqliteTable("channels", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  tenantId: integer("tenant_id").notNull().default(1).references(() => tenants.id),
  name: text("name").notNull(),
  slug: text("slug").notNull(),
  type: text("type").notNull(),
  config: text("config"),
  isActive: integer("is_active", { mode: "boolean" }).default(true),
  lastSyncAt: integer("last_sync_at", { mode: "timestamp" }),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
}, (t) => ({
  channelsTenantSlugUnique: uniqueIndex("channels_tenant_slug_unique").on(t.tenantId, t.slug),
}));

// ── Conversations ──────────────────────────────────────────────────────────────
export const conversations = sqliteTable("conversations", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  tenantId: integer("tenant_id").notNull().default(1).references(() => tenants.id),
  clientId: integer("client_id").notNull().references(() => clients.id, { onDelete: "cascade" }),
  channelId: integer("channel_id").references(() => channels.id),
  channelType: text("channel_type").default("manual"),
  externalChatId: text("external_chat_id"),
  status: text("status", { enum: ["open", "pending", "closed"] }).default("open"),
  assignedTo: integer("assigned_to").references(() => users.id),
  lastMessageAt: integer("last_message_at", { mode: "timestamp" }),
  /** Денормализованное превью — без скана messages при списке диалогов */
  lastMessageText: text("last_message_text"),
  lastMessageSenderType: text("last_message_sender_type"),
  lastMessageId: integer("last_message_id"),
  unreadCount: integer("unread_count").default(0),
  /** Ручная пометка «непрочитано» — не сбрасывается синхронизацией Авито */
  unreadPinned: integer("unread_pinned", { mode: "boolean" }).default(false),
  /** Когда отправили предупреждение SLA 15+ мин */
  slaWarnedAt: integer("sla_warned_at", { mode: "timestamp" }),
  /** Когда отправили предупреждение SLA 60+ мин */
  slaDangerNotifiedAt: integer("sla_danger_notified_at", { mode: "timestamp" }),
  /** Закреплён в списке диалогов */
  pinnedAt: integer("pinned_at", { mode: "timestamp" }),
  metadata: text("metadata"),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
});

// ── Messages ───────────────────────────────────────────────────────────────────
export const messages = sqliteTable("messages", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  conversationId: integer("conversation_id").notNull().references(() => conversations.id, { onDelete: "cascade" }),
  senderType: text("sender_type", { enum: ["client", "operator", "system"] }).notNull(),
  senderId: integer("sender_id"), // operator user_id if senderType=operator
  /** Роль ИИ-агента: manager | accountant | lawyer | developer | mechanic | orchestrator */
  agentType: text("agent_type"),
  text: text("text"),
  ocrText: text("ocr_text"),
  mediaUrl: text("media_url"),
  mediaType: text("media_type"), // photo, video, document, sticker
  externalMessageId: text("external_message_id"),
  readAt: integer("read_at", { mode: "timestamp" }),
  /** sent | delivered | read | failed — для исходящих сообщений оператора */
  deliveryStatus: text("delivery_status"),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
});

// ── СТО: записи на сервис (до deals — избегаем циклической ссылки) ─────────────
export const serviceAppointments = sqliteTable("service_appointments", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  tenantId: integer("tenant_id").notNull().default(1).references(() => tenants.id),
  clientId: integer("client_id").references(() => clients.id, { onDelete: "set null" }),
  vehicleId: integer("vehicle_id").references(() => vehicles.id, { onDelete: "set null" }),
  dealId: integer("deal_id"),
  phone: text("phone"),
  plate: text("plate"),
  make: text("make"),
  model: text("model"),
  vin: text("vin"),
  mileage: integer("mileage"),
  title: text("title").notNull(),
  scheduledAt: integer("scheduled_at", { mode: "timestamp" }).notNull(),
  durationMin: integer("duration_min").default(60),
  bayNumber: integer("bay_number"),
  status: text("status", { enum: ["scheduled", "confirmed", "in_progress", "done", "cancelled"] }).default("scheduled"),
  notes: text("notes"),
  reminderSentAt: integer("reminder_sent_at", { mode: "timestamp" }),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
});

// ── Orders / Deals (заказы запчастей и заказ-наряды СТО) ───────────────────────
export const deals = sqliteTable("deals", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  tenantId: integer("tenant_id").notNull().default(1).references(() => tenants.id),
  clientId: integer("client_id").notNull().references(() => clients.id, { onDelete: "cascade" }),
  vehicleId: integer("vehicle_id").references(() => vehicles.id),
  title: text("title").notNull(),
  orderType: text("order_type").default("parts"),
  status: text("status", { enum: ["new", "quoted", "in_progress", "waiting_parts", "on_lift", "qc", "ready", "shipped", "done", "cancelled"] }).default("new"),
  amount: real("amount"),
  partsCost: real("parts_cost"),
  laborCost: real("labor_cost"),
  discountAmount: real("discount_amount").default(0),
  /** unpaid | partial | paid — отдельно от статуса цеха */
  paymentStatus: text("payment_status", { enum: ["unpaid", "partial", "paid"] }).default("unpaid"),
  paidAmount: real("paid_amount").default(0),
  description: text("description"),
  vin: text("vin"),
  vehicleMake: text("vehicle_make"),
  vehicleModel: text("vehicle_model"),
  vehicleYear: integer("vehicle_year"),
  vehiclePlate: text("vehicle_plate"),
  mileage: integer("mileage"),
  avitoItemId: text("avito_item_id"),
  avitoItemTitle: text("avito_item_title"),
  avitoPrice: real("avito_price"),
  /** ID заказа на Авито (доставка / маркетплейс) */
  avitoOrderId: text("avito_order_id"),
  deliveryMethod: text("delivery_method"),
  cdekOrderUuid: text("cdek_order_uuid"),
  cdekTrackNumber: text("cdek_track_number"),
  cdekPvzCode: text("cdek_pvz_code"),
  cdekPvzAddress: text("cdek_pvz_address"),
  cdekCityCode: integer("cdek_city_code"),
  cdekTariffCode: integer("cdek_tariff_code"),
  cdekStatus: text("cdek_status"),
  cdekDeliveryCost: real("cdek_delivery_cost"),
  cdekImNumber: text("cdek_im_number"),
  cdekProductName: text("cdek_product_name"),
  cdekPackageWeight: integer("cdek_package_weight"),
  cdekPackageLength: integer("cdek_package_length"),
  cdekPackageWidth: integer("cdek_package_width"),
  cdekPackageHeight: integer("cdek_package_height"),
  cdekGoodsPayment: real("cdek_goods_payment"),
  cdekDeliveryRecipient: real("cdek_delivery_recipient"),
  cdekArrivalNotifiedAt: integer("cdek_arrival_notified_at", { mode: "timestamp" }),
  cdekErrorMessage: text("cdek_error_message"),
  assignedTo: integer("assigned_to").references(() => users.id),
  /** Заказ-наряд СТО: доп. поля */
  vehicleValue: real("vehicle_value"),
  clientIsPayer: integer("client_is_payer", { mode: "boolean" }).default(true),
  woGroup: text("wo_group"),
  campaign: text("campaign"),
  appointmentId: integer("appointment_id").references(() => serviceAppointments.id, { onDelete: "set null" }),
  woNote: text("wo_note"),
  warrantyObligations: text("warranty_obligations"),
  contractTerms: text("contract_terms"),
  inspectionReport: text("inspection_report"),
  clientApprovalStatus: text("client_approval_status"),
  /** JSON-массив фото дефектов: [{url, createdAt, userId}] */
  defectPhotos: text("defect_photos"),
  /** Предприятие (СТО) для заказ-наряда */
  woEnterpriseId: integer("wo_enterprise_id"),
  companyName: text("company_name"),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
});

// ── Order line items (позиции заказа) ─────────────────────────────────────────
export const orderItems = sqliteTable("order_items", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  dealId: integer("deal_id").notNull().references(() => deals.id, { onDelete: "cascade" }),
  article: text("article"),
  brand: text("brand"),
  name: text("name").notNull(),
  qty: integer("qty").default(1),
  price: real("price"),
  isOriginal: integer("is_original", { mode: "boolean" }).default(false),
  inStock: integer("in_stock", { mode: "boolean" }).default(true),
  /** stock — со склада, client — от клиента, consumable — расходник */
  partSource: text("part_source").default("stock"),
  /** FK на parts_stock.id (без drizzle-references — таблица объявлена ниже) */
  stockPartId: integer("stock_part_id"),
  reservedQty: integer("reserved_qty").default(0),
  laborItemId: integer("labor_item_id"),
  embeddedInLabor: integer("embedded_in_labor", { mode: "boolean" }).default(false),
});

// ── Заказ-наряд: работы (нормо-часы) ─────────────────────────────────────────
export const dealLaborItems = sqliteTable("deal_labor_items", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  dealId: integer("deal_id").notNull().references(() => deals.id, { onDelete: "cascade" }),
  code: text("code"),
  name: text("name").notNull(),
  normHours: real("norm_hours").default(1),
  hours: real("hours"),
  hourlyRate: real("hourly_rate"),
  price: real("price"),
  executorName: text("executor_name"),
  executorUserId: integer("executor_user_id").references(() => users.id, { onDelete: "set null" }),
  /** Процент от суммы работы для ЗП механика (переопределяет правило роли) */
  payrollPercent: real("payroll_percent"),
  sortOrder: integer("sort_order").default(0),
});

// ── Parts warehouse (склад) ───────────────────────────────────────────────────
export const partsStock = sqliteTable("parts_stock", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  tenantId: integer("tenant_id").notNull().default(1).references(() => tenants.id),
  article: text("article").notNull(),
  brand: text("brand"),
  name: text("name").notNull(),
  category: text("category"),
  qty: integer("qty").default(0),
  price: real("price"),
  purchasePrice: real("purchase_price"),
  markupPercent: real("markup_percent"),
  reservedQty: integer("reserved_qty").default(0),
  unit: text("unit").default("шт"),
  country: text("country"),
  /** JSON-массив доп. номеров OEM / кроссов */
  oemArticles: text("oem_articles"),
  location: text("location"),
  minQty: integer("min_qty").default(1),
  barcode: text("barcode"),
  isDemo: integer("is_demo", { mode: "boolean" }).default(false),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
});

/** Группы номенклатуры (как в Автодиллере) */
export const partsCategories = sqliteTable("parts_categories", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  tenantId: integer("tenant_id").notNull().default(1).references(() => tenants.id),
  name: text("name").notNull(),
  sortOrder: integer("sort_order").default(0),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
});

// ── Quick reply templates ─────────────────────────────────────────────────────
export const quickTemplates = sqliteTable("quick_templates", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  tenantId: integer("tenant_id").notNull().default(1).references(() => tenants.id),
  title: text("title").notNull(),
  text: text("text").notNull(),
  imageUrl: text("image_url"),
  /** JSON: [{ url, type: photo|video|document }] — до 3 файлов */
  mediaUrls: text("media_urls"),
  category: text("category").default("general"),
  sortOrder: integer("sort_order").default(0),
});

// ── Notifications ──────────────────────────────────────────────────────────────
export const notifications = sqliteTable("notifications", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  tenantId: integer("tenant_id").notNull().default(1).references(() => tenants.id),
  userId: integer("user_id").references(() => users.id, { onDelete: "cascade" }),
  type: text("type", { enum: [
    "new_message", "assigned", "tag_added", "deal_updated", "mention", "task_due",
    "task_reminder_15", "task_reminder_5", "task_overdue",
    "avito_advance", "avito_advance_empty", "chat_sla_warn", "chat_sla_danger",
  ] }).default("new_message"),
  title: text("title").notNull(),
  text: text("text"),
  link: text("link"),
  readAt: integer("read_at", { mode: "timestamp" }),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
});

// ── Tasks ──────────────────────────────────────────────────────────────────────
export const tasks = sqliteTable("tasks", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  tenantId: integer("tenant_id").notNull().default(1).references(() => tenants.id),
  title: text("title").notNull(),
  description: text("description"),
  status: text("status", { enum: ["todo", "in_progress", "done", "cancelled"] }).default("todo"),
  priority: text("priority", { enum: ["low", "medium", "high"] }).default("medium"),
  /** escalation | support | general — источник/тип задачи */
  taskType: text("task_type").default("general"),
  clientId: integer("client_id").references(() => clients.id, { onDelete: "set null" }),
  /** Диалог AI-поддержки, из которого создана эскалация */
  conversationId: integer("conversation_id").references(() => conversations.id, { onDelete: "set null" }),
  assignedTo: integer("assigned_to").references(() => users.id),
  createdBy: integer("created_by").references(() => users.id),
  dueAt: integer("due_at", { mode: "timestamp" }),
  notifiedAt: integer("notified_at", { mode: "timestamp" }),
  reminded15At: integer("reminded_15_at", { mode: "timestamp" }),
  reminded5At: integer("reminded_5_at", { mode: "timestamp" }),
  overdueNotifiedAt: integer("overdue_notified_at", { mode: "timestamp" }),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
});

export const taskComments = sqliteTable("task_comments", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  taskId: integer("task_id").notNull().references(() => tasks.id, { onDelete: "cascade" }),
  userId: integer("user_id").references(() => users.id),
  text: text("text").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
});

// ── СТО: расписание и записи ───────────────────────────────────────────────────
export const serviceSchedule = sqliteTable("service_schedule", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  tenantId: integer("tenant_id").notNull().default(1).references(() => tenants.id),
  dayOfWeek: integer("day_of_week").notNull(), // 0=Пн … 6=Вс
  openTime: text("open_time").default("09:00"),
  closeTime: text("close_time").default("18:00"),
  isClosed: integer("is_closed", { mode: "boolean" }).default(false),
  note: text("note"),
  updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
});

export const serviceSettings = sqliteTable("service_settings", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  tenantId: integer("tenant_id").notNull().default(1).references(() => tenants.id),
  shopName: text("shop_name").default("СТО АвтоПлан"),
  address: text("address"),
  phone: text("phone"),
  notifyWhatsApp: integer("notify_whatsapp", { mode: "boolean" }).default(true),
  notifySms: integer("notify_sms", { mode: "boolean" }).default(false),
  bayCount: integer("bay_count").default(4),
  onlineBookingEnabled: integer("online_booking_enabled", { mode: "boolean" }).default(true),
  updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
});

// ── Рассылки и звонки ────────────────────────────────────────────────────────
export const broadcasts = sqliteTable("broadcasts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  tenantId: integer("tenant_id").notNull().default(1).references(() => tenants.id),
  title: text("title"),
  message: text("message").notNull(),
  tagIds: text("tag_ids"),
  channel: text("channel").default("auto"),
  sent: integer("sent").default(0),
  failed: integer("failed").default(0),
  createdBy: integer("created_by").references(() => users.id),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
});

export const callLogs = sqliteTable("call_logs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  tenantId: integer("tenant_id").notNull().default(1).references(() => tenants.id),
  clientId: integer("client_id").references(() => clients.id, { onDelete: "set null" }),
  phone: text("phone").notNull(),
  userId: integer("user_id").references(() => users.id),
  direction: text("direction", { enum: ["outbound", "inbound"] }).default("outbound"),
  outcome: text("outcome", { enum: ["completed", "no_answer", "callback", "wrong_number"] }).default("completed"),
  provider: text("provider", { enum: ["manual", "megafon", "mts"] }).default("manual"),
  externalId: text("external_id"),
  durationSec: integer("duration_sec"),
  recordingUrl: text("recording_url"),
  status: text("status", { enum: ["ringing", "answered", "completed", "missed", "cancelled"] }).default("completed"),
  operatorExt: text("operator_ext"),
  notes: text("notes"),
  /** Имя звонящего, если клиент не найден в базе */
  callerName: text("caller_name"),
  reason: text("reason"),
  vin: text("vin"),
  article: text("article"),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
});

export const cdekSettings = sqliteTable("cdek_settings", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  tenantId: integer("tenant_id").notNull().default(1).references(() => tenants.id),
  enabled: integer("enabled", { mode: "boolean" }).default(false),
  testMode: integer("test_mode", { mode: "boolean" }).default(true),
  clientId: text("client_id"),
  clientSecret: text("client_secret"),
  shipmentPoint: text("shipment_point"),
  fromCityCode: integer("from_city_code"),
  senderName: text("sender_name"),
  senderPhone: text("sender_phone"),
  defaultTariffCode: integer("default_tariff_code").default(136),
  updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
});

// ── Предприятия СТО (филиалы) ─────────────────────────────────────────────────
export const stoEnterprises = sqliteTable("sto_enterprises", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  tenantId: integer("tenant_id").notNull().default(1).references(() => tenants.id),
  name: text("name").notNull(),
  isDefault: integer("is_default", { mode: "boolean" }).default(false),
  isActive: integer("is_active", { mode: "boolean" }).default(true),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
});

export const crmSettings = sqliteTable("crm_settings", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  tenantId: integer("tenant_id").notNull().default(1).references(() => tenants.id),
  avitoAutoDeals: integer("avito_auto_deals", { mode: "boolean" }).default(false),
  avitoAdvanceAlertEnabled: integer("avito_advance_alert_enabled", { mode: "boolean" }).default(true),
  avitoAdvanceThresholdRub: integer("avito_advance_threshold_rub").default(200),
  /** Telegram chat id для срочных оповещений об авансе CPA (личный id или группа) */
  advanceAlertTelegramChatId: text("advance_alert_telegram_chat_id"),
  /** Реквизиты для печати товарных чеков и накладных */
  companyName: text("company_name"),
  companyAddress: text("company_address"),
  companyPhone: text("company_phone"),
  companyInn: text("company_inn"),
  companyKpp: text("company_kpp"),
  companyBank: text("company_bank"),
  companyBik: text("company_bik"),
  companyRs: text("company_rs"),
  companyKs: text("company_ks"),
  /** with_vat_20 | without_vat */
  vatMode: text("vat_mode").default("with_vat_20"),
  /** Текст/URL для QR СБП на счёте */
  sbpPayPayload: text("sbp_pay_payload"),
  warrantyTemplates: text("warranty_templates"),
  /** Показывать артикулы клиенту на печати товарного чека */
  receiptShowArticles: integer("receipt_show_articles", { mode: "boolean" }).default(true),
  /** Ставка нормо-часа для заказ-нарядов СТО, ₽ */
  defaultLaborRate: integer("default_labor_rate").default(2500),
  onecEnabled: integer("onec_enabled", { mode: "boolean" }).default(false),
  onecUrl: text("onec_url"),
  onecToken: text("onec_token"),
  ofdEnabled: integer("ofd_enabled", { mode: "boolean" }).default(false),
  ofdProvider: text("ofd_provider").default("atol"),
  ofdToken: text("ofd_token"),
  ofdGroupCode: text("ofd_group_code"),
  updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
});

// ── Реализация: товарные чеки и расходные накладные ───────────────────────────
export const salesDocuments = sqliteTable("sales_documents", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  tenantId: integer("tenant_id").notNull().default(1).references(() => tenants.id),
  docType: text("doc_type", { enum: ["receipt", "invoice"] }).notNull(),
  docNumber: text("doc_number").notNull(),
  status: text("status", { enum: ["draft", "posted", "cancelled"] }).default("draft"),
  clientId: integer("client_id").references(() => clients.id, { onDelete: "set null" }),
  dealId: integer("deal_id").references(() => deals.id, { onDelete: "set null" }),
  managerId: integer("manager_id").references(() => users.id),
  companyName: text("company_name"),
  recipientName: text("recipient_name"),
  recipientPhone: text("recipient_phone"),
  notes: text("notes"),
  warrantyText: text("warranty_text"),
  paymentMethod: text("payment_method"),
  paymentAmount: real("payment_amount"),
  rounding: real("rounding").default(0),
  totalAmount: real("total_amount").default(0),
  ofdReceiptId: text("ofd_receipt_id"),
  ofdStatus: text("ofd_status"),
  onecExportId: text("onec_export_id"),
  postedAt: integer("posted_at", { mode: "timestamp" }),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
});

export const salesDocumentItems = sqliteTable("sales_document_items", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  documentId: integer("document_id").notNull().references(() => salesDocuments.id, { onDelete: "cascade" }),
  stockPartId: integer("stock_part_id").references(() => partsStock.id, { onDelete: "set null" }),
  article: text("article"),
  brand: text("brand"),
  name: text("name").notNull(),
  qty: integer("qty").default(1),
  price: real("price"),
  sortOrder: integer("sort_order").default(0),
});

/** Официальные PDF-документы СТО: счёт, УПД, акт, заказ-наряд */
export const documents = sqliteTable("documents", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  tenantId: integer("tenant_id").notNull().default(1).references(() => tenants.id),
  dealId: integer("deal_id").references(() => deals.id, { onDelete: "set null" }),
  type: text("type").notNull(), // invoice | upd | act | order
  status: text("status").default("draft"), // draft | sent | signed
  docNumber: text("doc_number"),
  pdfPath: text("pdf_path"),
  fileName: text("file_name"),
  issuedAt: integer("issued_at", { mode: "timestamp" }),
  signedAt: integer("signed_at", { mode: "timestamp" }),
  createdBy: integer("created_by").references(() => users.id),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
});

// ── ZZap (ЗетЗап) — автозагрузка прайсов ─────────────────────────────────────
export const zzapSettings = sqliteTable("zzap_settings", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  tenantId: integer("tenant_id").notNull().default(1).references(() => tenants.id),
  enabled: integer("enabled", { mode: "boolean" }).default(false),
  login: text("login"),
  password: text("password"),
  apiKey: text("api_key"),
  autoUploadEnabled: integer("auto_upload_enabled", { mode: "boolean" }).default(true),
  uploadHour: integer("upload_hour").default(9),
  uploadMinute: integer("upload_minute").default(0),
  lastRunAt: integer("last_run_at", { mode: "timestamp" }),
  lastRunStatus: text("last_run_status"),
  lastRunError: text("last_run_error"),
  updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
});

export const zzapPriceLists = sqliteTable("zzap_price_lists", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  tenantId: integer("tenant_id").notNull().default(1).references(() => tenants.id),
  name: text("name").notNull(),
  codeTemplate: integer("code_template").notNull(),
  fileName: text("file_name"),
  storedFileName: text("stored_file_name"),
  enabled: integer("enabled", { mode: "boolean" }).default(true),
  sortOrder: integer("sort_order").default(0),
  lastUploadedAt: integer("last_uploaded_at", { mode: "timestamp" }),
  lastUploadError: text("last_upload_error"),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
});

export const telephonySettings = sqliteTable("telephony_settings", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  tenantId: integer("tenant_id").notNull().default(1).references(() => tenants.id),
  provider: text("provider", { enum: ["none", "megafon", "mts"] }).default("none"),
  enabled: integer("enabled", { mode: "boolean" }).default(false),
  megafonApiUrl: text("megafon_api_url"),
  megafonToken: text("megafon_token"),
  mtsApiKey: text("mts_api_key"),
  mtsAppId: text("mts_app_id"),
  mtsRedirectNumber: text("mts_redirect_number"),
  webhookSecret: text("webhook_secret"),
  callLoadBalanceEnabled: integer("call_load_balance_enabled", { mode: "boolean" }).default(false),
  callLoadBalanceUserIds: text("call_load_balance_user_ids"),
  callLoadBalanceIndex: integer("call_load_balance_index").default(0),
  updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
});

// ── Team chat (внутренний мессенджер сотрудников) ─────────────────────────────
export const teamChatGroups = sqliteTable("team_chat_groups", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  tenantId: integer("tenant_id").notNull().default(1).references(() => tenants.id),
  name: text("name").notNull(),
  description: text("description"),
  icon: text("icon").default("💬"),
  dealId: integer("deal_id").references(() => deals.id, { onDelete: "cascade" }),
  isPublic: integer("is_public", { mode: "boolean" }).default(true),
  createdBy: integer("created_by").references(() => users.id),
  lastMessageAt: integer("last_message_at", { mode: "timestamp" }),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
});

export const teamChatMembers = sqliteTable("team_chat_members", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  groupId: integer("group_id").notNull().references(() => teamChatGroups.id, { onDelete: "cascade" }),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  lastReadAt: integer("last_read_at", { mode: "timestamp" }),
  joinedAt: integer("joined_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
});

export const teamChatMessages = sqliteTable("team_chat_messages", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  groupId: integer("group_id").notNull().references(() => teamChatGroups.id, { onDelete: "cascade" }),
  userId: integer("user_id").notNull().references(() => users.id),
  text: text("text"),
  fileUrl: text("file_url"),
  fileName: text("file_name"),
  replyToId: integer("reply_to_id"),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
});

// ── AI proposals (бот предлагает → менеджер редактирует → отправка клиенту) ──
export const aiProposals = sqliteTable("ai_proposals", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  tenantId: integer("tenant_id").notNull().default(1).references(() => tenants.id),
  stage: text("stage", { enum: ["inbox", "deal", "repair", "delivery", "parts"] }).notNull(),
  actionType: text("action_type", { enum: ["reply", "appointment", "quote", "follow_up", "notify"] }).notNull(),
  title: text("title").notNull(),
  reason: text("reason"),
  proposedText: text("proposed_text").notNull(),
  editedText: text("edited_text"),
  conversationId: integer("conversation_id").references(() => conversations.id, { onDelete: "cascade" }),
  clientId: integer("client_id").references(() => clients.id, { onDelete: "set null" }),
  dealId: integer("deal_id").references(() => deals.id, { onDelete: "set null" }),
  appointmentId: integer("appointment_id").references(() => serviceAppointments.id, { onDelete: "set null" }),
  priority: integer("priority").default(50),
  dedupeKey: text("dedupe_key"),
  status: text("status", { enum: ["pending", "approved", "rejected", "sent"] }).default("pending"),
  reviewedBy: integer("reviewed_by").references(() => users.id),
  sentAt: integer("sent_at", { mode: "timestamp" }),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
});

// ── Выкуп запчастей (учёт закупок у магазинов) ───────────────────────────────
export const partsBuyouts = sqliteTable("parts_buyouts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  tenantId: integer("tenant_id").notNull().default(1).references(() => tenants.id),
  /** Наименование / что выкупили */
  title: text("title").notNull(),
  article: text("article"),
  shop: text("shop"),
  amount: real("amount").notNull(),
  notes: text("notes"),
  boughtAt: integer("bought_at", { mode: "timestamp" }).notNull(),
  createdBy: integer("created_by").references(() => users.id),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
});

// ── Activity log ─────────────────────────────────────────────────────────────
export const activityLog = sqliteTable("activity_log", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  tenantId: integer("tenant_id").notNull().default(1).references(() => tenants.id),
  entityType: text("entity_type").notNull(),
  entityId: integer("entity_id").notNull(),
  userId: integer("user_id").references(() => users.id),
  action: text("action").notNull(),
  details: text("details"),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
});

export const userLoginSessions = sqliteTable("user_login_sessions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  sessionId: text("session_id"),
  ip: text("ip"),
  userAgent: text("user_agent"),
  loginAt: integer("login_at", { mode: "timestamp" }).notNull(),
  logoutAt: integer("logout_at", { mode: "timestamp" }),
  lastActivityAt: integer("last_activity_at", { mode: "timestamp" }),
});

export const userActivityEvents = sqliteTable("user_activity_events", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  eventType: text("event_type").notNull(),
  entityType: text("entity_type"),
  entityId: integer("entity_id"),
  meta: text("meta"),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
});

export const payrollRoles = sqliteTable("payroll_roles", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  tenantId: integer("tenant_id").notNull().default(1).references(() => tenants.id),
  name: text("name").notNull(),
  slug: text("slug").notNull(),
  sortOrder: integer("sort_order").default(0),
  isActive: integer("is_active", { mode: "boolean" }).default(true),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
}, (t) => ({
  payrollRolesTenantSlugUnique: uniqueIndex("payroll_roles_tenant_slug_unique").on(t.tenantId, t.slug),
}));

export const payrollRules = sqliteTable("payroll_rules", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  tenantId: integer("tenant_id").notNull().default(1).references(() => tenants.id),
  roleId: integer("role_id").references(() => payrollRoles.id, { onDelete: "cascade" }),
  userId: integer("user_id").references(() => users.id, { onDelete: "cascade" }),
  sourceType: text("source_type").notNull(),
  calcType: text("calc_type").default("percent"),
  value: real("value").default(0),
  label: text("label"),
  isActive: integer("is_active", { mode: "boolean" }).default(true),
  sortOrder: integer("sort_order").default(0),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
});

export const payrollCalculations = sqliteTable("payroll_calculations", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  tenantId: integer("tenant_id").notNull().default(1).references(() => tenants.id),
  userId: integer("user_id").notNull().references(() => users.id),
  roleId: integer("role_id").references(() => payrollRoles.id),
  periodStart: integer("period_start", { mode: "timestamp" }).notNull(),
  periodEnd: integer("period_end", { mode: "timestamp" }).notNull(),
  status: text("status").default("draft"),
  totalAmount: real("total_amount").default(0),
  adjustments: text("adjustments"),
  notes: text("notes"),
  createdBy: integer("created_by").references(() => users.id),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
});

export const payrollCalculationLines = sqliteTable("payroll_calculation_lines", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  calculationId: integer("calculation_id").notNull().references(() => payrollCalculations.id, { onDelete: "cascade" }),
  sourceType: text("source_type").notNull(),
  sourceId: integer("source_id"),
  sourceLabel: text("source_label"),
  baseAmount: real("base_amount").default(0),
  percent: real("percent"),
  fixedAmount: real("fixed_amount"),
  amount: real("amount").default(0),
  ruleId: integer("rule_id").references(() => payrollRules.id),
});

/** Ручные корректировки ежедневных отчётов (только админ) */
export const reportDailyOverrides = sqliteTable("report_daily_overrides", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  tenantId: integer("tenant_id").notNull().default(1).references(() => tenants.id),
  /** YYYY-MM-DD */
  reportDate: text("report_date").notNull(),
  /** chats_account | chats_total | sales_count | sales_amount | orders_count | calls_inbound | operator_orders | operator_calls */
  metric: text("metric").notNull(),
  /** avito account name or operator user id as string */
  dimensionKey: text("dimension_key"),
  value: real("value").notNull(),
  note: text("note"),
  updatedBy: integer("updated_by").references(() => users.id),
  updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
});

// ── SaaS: Subscriptions & Billing ─────────────────────────────────────────────
export const subscriptionPlans = sqliteTable("subscription_plans", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  displayName: text("display_name").notNull(),
  description: text("description"),
  monthlyPriceUsd: real("monthly_price_usd").notNull(),
  monthlyPriceRub: real("monthly_price_rub").notNull(),
  pricePerUserRub: real("price_per_user_rub").notNull().default(2500),
  maxUsers: integer("max_users").notNull(),
  maxChannels: integer("max_channels").notNull(),
  maxStorageGb: integer("max_storage_gb").notNull(),
  maxConversationsPerMonth: integer("max_conversations_per_month"),
  maxApiCallsPerDay: integer("max_api_calls_per_day"),
  includesCustomBranding: integer("includes_custom_branding", { mode: "boolean" }).default(false),
  includesApiAccess: integer("includes_api_access", { mode: "boolean" }).default(false),
  includesAdvancedReports: integer("includes_advanced_reports", { mode: "boolean" }).default(false),
  includesPrioritySupport: integer("includes_priority_support", { mode: "boolean" }).default(false),
  stripeId: text("stripe_id"),
  stripePriceId: text("stripe_price_id"),
  isActive: integer("is_active", { mode: "boolean" }).default(true),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
});

export const tenantSubscriptions = sqliteTable("tenant_subscriptions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  tenantId: integer("tenant_id").notNull().references(() => tenants.id),
  planId: integer("plan_id").notNull().references(() => subscriptionPlans.id),
  status: text("status", {
    enum: ["active", "trial", "past_due", "canceled", "expired"],
  }).notNull().default("trial"),
  stripeSubscriptionId: text("stripe_subscription_id"),
  stripeCustomerId: text("stripe_customer_id"),
  stripePaymentMethodId: text("stripe_payment_method_id"),
  startedAt: integer("started_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
  trialEndsAt: integer("trial_ends_at", { mode: "timestamp" }),
  renewsAt: integer("renews_at", { mode: "timestamp" }),
  expiresAt: integer("expires_at", { mode: "timestamp" }),
  canceledAt: integer("canceled_at", { mode: "timestamp" }),
  billingIntervalMonths: integer("billing_interval_months").default(1),
  nextBillingDate: integer("next_billing_date", { mode: "timestamp" }),
  lowBalanceNotifiedAt: integer("low_balance_notified_at", { mode: "timestamp" }),
  expirationWarningNotifiedAt: integer("expiration_warning_notified_at", { mode: "timestamp" }),
  autoRenew: integer("auto_renew", { mode: "boolean" }).default(true),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
});

export const invoices = sqliteTable("invoices", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  tenantId: integer("tenant_id").notNull().references(() => tenants.id),
  subscriptionId: integer("subscription_id").references(() => tenantSubscriptions.id),
  stripeInvoiceId: text("stripe_invoice_id").unique(),
  status: text("status", {
    enum: ["draft", "open", "paid", "void", "uncollectible"],
  }).notNull().default("draft"),
  amountUsd: real("amount_usd").notNull(),
  amountRub: real("amount_rub").notNull(),
  currency: text("currency").default("USD"),
  description: text("description"),
  invoiceNumber: text("invoice_number").unique(),
  issuedAt: integer("issued_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
  dueAt: integer("due_at", { mode: "timestamp" }),
  paidAt: integer("paid_at", { mode: "timestamp" }),
  items: text("items"),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
});

export const tenantUsage = sqliteTable("tenant_usage", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  tenantId: integer("tenant_id").notNull().references(() => tenants.id),
  activeUsers: integer("active_users").default(0),
  activeChannels: integer("active_channels").default(0),
  storageUsedGb: real("storage_used_gb").default(0),
  conversationsThisMonth: integer("conversations_this_month").default(0),
  apiCallsToday: integer("api_calls_today").default(0),
  vinDecodesUsed: integer("vin_decodes_used").default(0),
  stockSkusActive: integer("stock_skus_active").default(0),
  callMinutesUsed: integer("call_minutes_used").default(0),
  recordedAt: integer("recorded_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
});

/** Сессии работы мастера на ЗН (старт/стоп) */
export const dealWorkSessions = sqliteTable("deal_work_sessions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  tenantId: integer("tenant_id").notNull().default(1).references(() => tenants.id),
  dealId: integer("deal_id").notNull().references(() => deals.id, { onDelete: "cascade" }),
  userId: integer("user_id").notNull().references(() => users.id),
  startedAt: integer("started_at", { mode: "timestamp" }).notNull(),
  endedAt: integer("ended_at", { mode: "timestamp" }),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
});

export const auditLogs = sqliteTable("audit_logs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  tenantId: integer("tenant_id").notNull().references(() => tenants.id),
  userId: integer("user_id").references(() => users.id),
  action: text("action").notNull(),
  resourceType: text("resource_type"),
  resourceId: text("resource_id"),
  details: text("details"),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  status: text("status", { enum: ["success", "failure"] }).default("success"),
  errorMessage: text("error_message"),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
});

export const supportTickets = sqliteTable("support_tickets", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  tenantId: integer("tenant_id").notNull().references(() => tenants.id),
  userId: integer("user_id").notNull().references(() => users.id),
  subject: text("subject").notNull(),
  description: text("description").notNull(),
  status: text("status", {
    enum: ["open", "in_progress", "resolved", "closed"],
  }).notNull().default("open"),
  priority: text("priority", {
    enum: ["low", "medium", "high", "critical"],
  }).default("medium"),
  category: text("category"),
  assignedTo: integer("assigned_to").references(() => users.id),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
  resolvedAt: integer("resolved_at", { mode: "timestamp" }),
});

export const ticketReplies = sqliteTable("ticket_replies", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  ticketId: integer("ticket_id").notNull().references(() => supportTickets.id),
  userId: integer("user_id").notNull().references(() => users.id),
  message: text("message").notNull(),
  isInternal: integer("is_internal", { mode: "boolean" }).default(false),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
});

export const apiKeys = sqliteTable("api_keys", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  tenantId: integer("tenant_id").notNull().references(() => tenants.id),
  name: text("name").notNull(),
  keyHash: text("key_hash").notNull(),
  keyPrefix: text("key_prefix").notNull(),
  scopes: text("scopes"),
  lastUsedAt: integer("last_used_at", { mode: "timestamp" }),
  expiresAt: integer("expires_at", { mode: "timestamp" }),
  revokedAt: integer("revoked_at", { mode: "timestamp" }),
  ipWhitelist: text("ip_whitelist"),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
});

export const tenantWebhooks = sqliteTable("tenant_webhooks", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  tenantId: integer("tenant_id").notNull().references(() => tenants.id),
  name: text("name").notNull(),
  url: text("url").notNull(),
  secret: text("secret").notNull(),
  events: text("events"),
  isActive: integer("is_active", { mode: "boolean" }).default(true),
  lastTriggeredAt: integer("last_triggered_at", { mode: "timestamp" }),
  lastStatusCode: integer("last_status_code"),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
});

export const webhookLogs = sqliteTable("webhook_logs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  webhookId: integer("webhook_id").notNull().references(() => tenantWebhooks.id),
  eventName: text("event_name").notNull(),
  payload: text("payload"),
  statusCode: integer("status_code"),
  responseBody: text("response_body"),
  attempt: integer("attempt").default(1),
  maxAttempts: integer("max_attempts").default(3),
  nextRetryAt: integer("next_retry_at", { mode: "timestamp" }),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
});
