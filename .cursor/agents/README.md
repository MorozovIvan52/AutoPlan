# Как пользоваться агентами (30 секунд)

1. Открой **Cursor → Chat**.
2. Введи `@crm-agent-qa` (или другого агента из таблицы).
3. Опиши задачу человеческим языком.
4. **Code Fixer** — всегда жди «ок/делай» перед правками кода.

| Агент | Rule в Cursor | Файл промпта |
|-------|---------------|--------------|
| QA | `@crm-agent-qa` | `.cursor/agents/01-qa-agent.md` |
| Code Fixer | `@crm-agent-code-fixer` | `.cursor/agents/02-code-fixer.md` |
| Docs | `@crm-agent-docs` | `.cursor/agents/03-docs-writer.md` |
| Migration | `@crm-agent-migration` | `.cursor/agents/04-migration-helper.md` |

**Безопасность:** `.cursor/agents/00-SAFETY-RULES.md` — читают все агенты.

**Полная инструкция:** [docs/agents/MULTI-AGENT-GUIDE.md](../../docs/agents/MULTI-AGENT-GUIDE.md)
