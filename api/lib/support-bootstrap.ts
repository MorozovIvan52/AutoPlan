/**
 * Bootstrap колонок для мультиагентной поддержки.
 */
import { sqlExec, tableColumns, usePostgres } from "../database/raw-sql";

async function hasColumn(table: string, column: string): Promise<boolean> {
  const cols = await tableColumns(table);
  return cols.some((c) => c.name === column);
}

export async function ensureSupportAgentSchema(): Promise<void> {
  if (!(await hasColumn("messages", "agent_type"))) {
    await sqlExec("ALTER TABLE messages ADD COLUMN agent_type TEXT");
  }
  if (!(await hasColumn("tasks", "task_type"))) {
    await sqlExec("ALTER TABLE tasks ADD COLUMN task_type TEXT DEFAULT 'general'");
  }
  if (!(await hasColumn("tasks", "conversation_id"))) {
    await sqlExec("ALTER TABLE tasks ADD COLUMN conversation_id INTEGER");
  }

  if (!usePostgres()) {
    await sqlExec("CREATE INDEX IF NOT EXISTS idx_messages_agent_type ON messages(agent_type)");
    await sqlExec("CREATE INDEX IF NOT EXISTS idx_tasks_task_type ON tasks(task_type)");
    await sqlExec("CREATE INDEX IF NOT EXISTS idx_conversations_channel_support ON conversations(channel_type, tenant_id)");
  }
}
