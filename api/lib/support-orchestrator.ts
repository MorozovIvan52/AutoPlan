/**
 * Оркестратор мультиагентной поддержки СТО.
 * Классификация → параллельные LLM → merge → эскалация в tasks.
 */
import { db } from "../database";
import * as schema from "../database/schema";
import { eq, desc, and } from "drizzle-orm";
import { llmCompletion, isLlmConfigured } from "./llm";
import { log } from "./logger";
import { forTenant, tenantId, withTenant } from "./tenant-query";
import {
  ORCHESTRATOR_MERGE_PROMPT,
  ESCALATION_CLIENT_NOTE,
  fillPromptTemplate,
  getPrompt,
  type AgentRole,
  type TenantPromptContext,
  isAgentRole,
} from "./agent-prompts";
import { getTenantById } from "./tenant";

const LLM_TIMEOUT_MS = 10_000;
const AGENT_MAX_TOKENS = 256;
export const SUPPORT_BUSY_MESSAGE =
  "Сейчас высокая нагрузка, оператор подключится через 2 минуты";

export type SupportChatInput = {
  clientId: number | null;
  conversationId?: number | null;
  message: string;
  userId?: number | null;
};

export type SupportChatResult = {
  conversationId: number;
  response: string;
  agentsUsed: AgentRole[];
  escalated: boolean;
  taskId?: number;
  busy?: boolean;
};

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("LLM_TIMEOUT")), ms);
    promise.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

/** Классификатор: 1–2 агента по ключевым словам. */
export function classifyAgents(message: string): AgentRole[] {
  const t = message.toLowerCase();
  const specialists: AgentRole[] = [];

  if (/баг|ошибк|не работ|сломал|crm|интеграц|авито|sms|webhook|логин|парол|биллинг|stripe|интерфейс/.test(t)) {
    if (/интерфейс|кнопк|неудобн|ux|ui|дизайн/.test(t)) specialists.push("designer");
    else specialists.push("developer");
  }
  if (/сч[её]т|ндс|акт|сверк|оплат|инн|кпп|закрывающ|бухгалтер|возврат/.test(t)) {
    specialists.push("accountant");
  }
  if (/гарант|претенз|ответственн|срок иск|договор|юрист|закон|потребител|суд/.test(t)) {
    specialists.push("lawyer");
  }
  if (/ремонт|запчаст|акпп|раздатк|диагност|подшипник|масло|срок работ|механик|неисправн|стучит|шум|вибрац/.test(t)) {
    specialists.push("mechanic");
  }

  const unique: AgentRole[] = [...new Set(specialists)];
  if (unique.length === 0) return ["manager"];
  if (unique.length === 1) {
    const only = unique[0]!;
    // лицо СТО + профильный — только если не чистый баг CRM
    if (only === "developer" || only === "designer") return [only];
    return ["manager", only];
  }
  return [unique[0]!, unique[1]!];
}

function needsEscalation(texts: string[]): boolean {
  const joined = texts.join("\n").toLowerCase();
  return (
    joined.includes("требуется человек")
    || joined.includes("баг в коде crm")
    || /баг в коде\s*crm/.test(joined)
  );
}

async function callAgent(
  role: AgentRole,
  userMessage: string,
  history: string,
  tenantCtx: TenantPromptContext,
): Promise<string> {
  const system = getPrompt(role, tenantCtx);
  return withTimeout(
    llmCompletion(
      [
        { role: "system", text: system },
        {
          role: "user",
          text: history
            ? `История диалога:\n${history}\n\nНовое сообщение клиента:\n${userMessage}`
            : userMessage,
        },
      ],
      { temperature: 0.35, maxTokens: AGENT_MAX_TOKENS },
    ),
    LLM_TIMEOUT_MS,
  );
}

async function mergeAnswers(
  userMessage: string,
  opinions: { role: AgentRole; text: string }[],
  tenantCtx: TenantPromptContext,
): Promise<string> {
  const block = opinions.map((o) => `### ${o.role}\n${o.text}`).join("\n\n");
  const system = fillPromptTemplate(ORCHESTRATOR_MERGE_PROMPT, tenantCtx);
  return withTimeout(
    llmCompletion(
      [
        { role: "system", text: system },
        {
          role: "user",
          text: `Сообщение клиента:\n${userMessage}\n\nМнения специалистов:\n${block}`,
        },
      ],
      { temperature: 0.3, maxTokens: 320 },
    ),
    LLM_TIMEOUT_MS,
  );
}

async function loadHistory(conversationId: number): Promise<string> {
  const rows = await db.select().from(schema.messages)
    .where(eq(schema.messages.conversationId, conversationId))
    .orderBy(desc(schema.messages.createdAt))
    .limit(12);
  return rows
    .reverse()
    .map((m) => {
      const who = m.agentType || m.senderType;
      return `${who}: ${(m.text || "").slice(0, 400)}`;
    })
    .join("\n");
}

async function ensureSupportConversation(opts: {
  clientId: number | null;
  conversationId?: number | null;
}): Promise<{ id: number; clientId: number }> {
  const tid = tenantId();

  if (opts.conversationId) {
    const [conv] = await db.select().from(schema.conversations)
      .where(withTenant(schema.conversations, eq(schema.conversations.id, opts.conversationId)));
    if (!conv) throw Object.assign(new Error("Диалог не найден"), { status: 404 });
    return { id: conv.id, clientId: conv.clientId };
  }

  let clientId = opts.clientId;
  if (clientId) {
    const [cl] = await db.select().from(schema.clients)
      .where(withTenant(schema.clients, eq(schema.clients.id, clientId)));
    if (!cl) throw Object.assign(new Error("Клиент не найден"), { status: 404 });
  } else {
    const [created] = await db.insert(schema.clients).values({
      tenantId: tid,
      name: "Клиент AI-поддержки",
      source: "support_ai",
      notes: "Автосоздан оркестратором /api/support/chat",
    }).returning();
    clientId = created.id;
  }

  const [conv] = await db.insert(schema.conversations).values({
    tenantId: tid,
    clientId,
    channelType: "support_ai",
    status: "open",
    lastMessageAt: new Date(),
    lastMessageText: "",
    lastMessageSenderType: "client",
  }).returning();

  return { id: conv.id, clientId };
}

async function insertMessage(opts: {
  conversationId: number;
  senderType: "client" | "operator" | "system";
  text: string;
  agentType?: string | null;
  senderId?: number | null;
}) {
  const [row] = await db.insert(schema.messages).values({
    conversationId: opts.conversationId,
    senderType: opts.senderType,
    senderId: opts.senderId ?? null,
    agentType: opts.agentType ?? null,
    text: opts.text,
  }).returning();

  await db.update(schema.conversations).set({
    lastMessageAt: new Date(),
    lastMessageText: opts.text.slice(0, 240),
    lastMessageSenderType: opts.senderType,
    lastMessageId: row.id,
  }).where(and(
    forTenant(schema.conversations),
    eq(schema.conversations.id, opts.conversationId),
  ));

  return row;
}

async function createEscalationTask(opts: {
  conversationId: number;
  clientId: number;
  message: string;
  agentsUsed: AgentRole[];
  userId?: number | null;
}): Promise<number> {
  const [task] = await db.insert(schema.tasks).values({
    tenantId: tenantId(),
    title: `Эскалация AI-поддержки #${opts.conversationId}`,
    description: [
      `Клиент: ${opts.message.slice(0, 500)}`,
      `Агенты: ${opts.agentsUsed.join(", ")}`,
      `Диалог: / (conversationId=${opts.conversationId})`,
    ].join("\n"),
    status: "todo",
    priority: "high",
    taskType: "escalation",
    clientId: opts.clientId,
    conversationId: opts.conversationId,
    createdBy: opts.userId ?? null,
  }).returning();
  return task.id;
}

export async function runSupportOrchestrator(input: SupportChatInput): Promise<SupportChatResult> {
  const started = Date.now();
  const message = input.message.trim();
  if (!message) throw Object.assign(new Error("Пустое сообщение"), { status: 400 });

  const tid = tenantId();
  const tenant = await getTenantById(tid);
  const tenantCtx: TenantPromptContext = {
    tenantName: tenant?.name || "Автосервис",
    tenantPlan: tenant?.subscriptionPlan || "start",
  };

  const conv = await ensureSupportConversation({
    clientId: input.clientId,
    conversationId: input.conversationId,
  });

  await insertMessage({
    conversationId: conv.id,
    senderType: "client",
    text: message,
  });

  if (!isLlmConfigured()) {
    const fallback =
      `${ESCALATION_CLIENT_NOTE} (AI не настроен: нужны AI_API_KEY+AI_BASE_URL или YANDEX_*).`;
    await insertMessage({
      conversationId: conv.id,
      senderType: "system",
      agentType: "orchestrator",
      text: fallback,
    });
    const taskId = await createEscalationTask({
      conversationId: conv.id,
      clientId: conv.clientId,
      message,
      agentsUsed: ["manager"],
      userId: input.userId,
    });
    return {
      conversationId: conv.id,
      response: fallback,
      agentsUsed: ["manager"],
      escalated: true,
      taskId,
      busy: false,
    };
  }

  const agents = classifyAgents(message);
  const history = await loadHistory(conv.id);

  log.info(
    { tenantId: tid, conversationId: conv.id, agentsUsed: agents },
    "support orchestrator start",
  );

  let opinions: { role: AgentRole; text: string }[];
  try {
    opinions = await Promise.all(
      agents.map(async (role) => {
        try {
          const text = (await callAgent(role, message, history, tenantCtx)).slice(0, 1000);
          await insertMessage({
            conversationId: conv.id,
            senderType: "system",
            agentType: role,
            text,
          });
          return { role, text };
        } catch (e) {
          const err = e instanceof Error ? e.message : String(e);
          log.warn({ role, err, conversationId: conv.id }, "support agent failed");
          if (err === "LLM_TIMEOUT" || /timeout|abort/i.test(err)) {
            throw Object.assign(new Error("LLM_TIMEOUT"), { status: 503 });
          }
          const stub = `Специалист ${role} временно недоступен.`;
          await insertMessage({
            conversationId: conv.id,
            senderType: "system",
            agentType: role,
            text: stub,
          });
          return { role, text: stub };
        }
      }),
    );
  } catch (e) {
    if (e instanceof Error && e.message === "LLM_TIMEOUT") {
      await insertMessage({
        conversationId: conv.id,
        senderType: "system",
        agentType: "orchestrator",
        text: SUPPORT_BUSY_MESSAGE,
      });
      const taskId = await createEscalationTask({
        conversationId: conv.id,
        clientId: conv.clientId,
        message,
        agentsUsed: agents,
        userId: input.userId,
      });
      log.info(
        { tenantId: tid, conversationId: conv.id, agentsUsed: agents, durationMs: Date.now() - started },
        "support orchestrator busy",
      );
      return {
        conversationId: conv.id,
        response: SUPPORT_BUSY_MESSAGE,
        agentsUsed: agents,
        escalated: true,
        taskId,
        busy: true,
      };
    }
    throw e;
  }

  let response: string;
  try {
    response = (await mergeAnswers(message, opinions, tenantCtx)).slice(0, 1000);
  } catch {
    response = opinions.map((o) => o.text).join("\n\n").slice(0, 1000);
    if (opinions.every((o) => /недоступен/i.test(o.text))) {
      response = SUPPORT_BUSY_MESSAGE;
    }
  }

  const escalate = needsEscalation([response, ...opinions.map((o) => o.text)])
    || response === SUPPORT_BUSY_MESSAGE
    || /претенз|баг в коде crm/.test(message.toLowerCase());

  if (escalate && response !== SUPPORT_BUSY_MESSAGE && !response.includes("15 минут")) {
    response = `${response.trim()}\n\n${ESCALATION_CLIENT_NOTE}`;
  }

  await insertMessage({
    conversationId: conv.id,
    senderType: "system",
    agentType: "orchestrator",
    text: response,
  });

  let taskId: number | undefined;
  if (escalate) {
    taskId = await createEscalationTask({
      conversationId: conv.id,
      clientId: conv.clientId,
      message,
      agentsUsed: agents,
      userId: input.userId,
    });
  }

  log.info(
    {
      tenantId: tid,
      conversationId: conv.id,
      agentsUsed: agents,
      escalated: escalate,
      durationMs: Date.now() - started,
    },
    "support orchestrator done",
  );

  return {
    conversationId: conv.id,
    response,
    agentsUsed: agents,
    escalated: escalate,
    taskId,
    busy: response === SUPPORT_BUSY_MESSAGE,
  };
}

/** Для тестов / отладки */
export function parseAgentsFromHint(raw: unknown): AgentRole[] | null {
  if (!Array.isArray(raw)) return null;
  const roles = raw.filter((x): x is string => typeof x === "string").filter(isAgentRole);
  return roles.length ? roles : null;
}
