# Документация AutoService CRM

## Коммерция и SaaS

- [Ключевые фишки для продажи (ЗН → склад → оплата)](./SALES-PITCH-STO-CLOSEOUT.md) — скрипт демо 30 с, лендинг, объявления
- [Модель распространения SaaS](./SAAS-MODEL.md)
- [Коммерческая готовность](./COMMERCIAL-READINESS.md)
- [Юридические документы](./legal/README.md)

## Эксплуатация (DevOps)

| Тема | Документ |
|------|----------|
| Сервер: PM2, Nginx, Certbot, PostgreSQL | [ops/INFRASTRUCTURE.md](./ops/INFRASTRUCTURE.md) |
| Мониторинг и метрики | [ops/MONITORING.md](./ops/MONITORING.md) |
| Надёжность, анти-OOM | [ops/RELIABILITY.md](./ops/RELIABILITY.md) |
| Бэкап в S3 | [ops/BACKUP-S3.md](./ops/BACKUP-S3.md) |
| GitHub Actions CI/CD | [ops/CICD.md](./ops/CICD.md) |

## Администратор

- **[ADMIN-CRM.md](./ADMIN-CRM.md)** — единый справочник всей CRM (модули, API, БД, env, команды)

## Пользователи

- [База знаний](../knowledge-base/README.md) — getting started, FAQ, видео

## Быстрые команды

```bash
# Установка стека на чистый Ubuntu VPS
DOMAIN=crm.example.ru bash scripts/ops/install-server-stack.sh

# Бэкап в S3 (после настройки .env)
bash scripts/ops/backup-to-s3.sh
bash scripts/ops/setup-backup-cron.sh

# Health-check
bash scripts/ops/health-check.sh https://crm.example.ru/api/health
```
