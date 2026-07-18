# Yandex Object Storage — ежедневный бэкап CRM

## Что бэкапится

- `crm.db` (через `sqlite3 .backup` — консистентно при WAL)
- `uploads/` — медиафайлы
- `data/` — прайсы ZZap и др.

Архив: `crm-backup-YYYYMMDD-HHMMSS.tar.gz` → `s3://BUCKET/PREFIX/`.

## Быстрая настройка (продакшн)

### 1. Ключи в Yandex Cloud (один раз, ~3 мин)

1. Откройте [Object Storage](https://console.yandex.cloud/folders/b1g3q7kegdbtqso54ccj/storage) в каталоге `b1g3q7kegdbtqso54ccj`.
2. **Сервисные аккаунты** → создайте `crm-backup`.
3. **Права** на каталог: роль `storage.editor` для `crm-backup`.
4. **Создать статический ключ доступа** → сохраните `Key ID` и `Secret` (показывается один раз).

> `YANDEX_API_KEY` от YandexGPT **не подходит** для Object Storage — нужен именно статический ключ SA.

### 2. Локально: добавьте в `.env` (не коммитить)

```env
YC_S3_ACCESS_KEY_ID=YCAJ...
YC_S3_SECRET_KEY=YCN...
```

### 3. Запуск настройки на VPS

```bash
npm run backup:setup-yandex
```

Скрипт: загрузит `scripts/ops/*`, создаст бакет `crmavito-b1g3q7ke-backups`, сделает тестовый бэкап, поставит cron **03:00 UTC**.

Альтернатива на сервере вручную:

```bash
nano /opt/crm/.env.s3   # см. .env.s3.example
bash /opt/crm/scripts/ops/setup-yandex-backup.sh
```

## Переменные

| Файл | Переменные |
|------|------------|
| `/opt/crm/.env` | `S3_BUCKET`, `S3_PREFIX`, `S3_ENDPOINT`, `BACKUP_RETENTION_DAYS` |
| `/opt/crm/.env.s3` | `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` (секреты, chmod 600) |

```env
S3_BUCKET=crmavito-b1g3q7ke-backups
S3_PREFIX=crmavito/production
S3_ENDPOINT=https://storage.yandexcloud.net
AWS_REGION=ru-central1
BACKUP_RETENTION_DAYS=30
```

## Cron и лог

- Cron: `0 3 * * * /opt/crm/scripts/ops/backup-to-s3.sh >> /var/log/crm-backup.log 2>&1`
- Проверка: `bash /opt/crm/scripts/ops/verify-prod-env.sh`
- Список бэкапов:  
  `aws --endpoint-url https://storage.yandexcloud.net s3 ls s3://crmavito-b1g3q7ke-backups/crmavito/production/`

## Ручной бэкап

```bash
cd /opt/crm && bash scripts/ops/backup-to-s3.sh
```

## Восстановление

```bash
aws --endpoint-url https://storage.yandexcloud.net s3 cp \
  s3://crmavito-b1g3q7ke-backups/crmavito/production/crm-backup-XXXX.tar.gz /tmp/
cd /opt/crm
pm2 stop crm
tar -xzf /tmp/crm-backup-XXXX.tar.gz -C /tmp/restore
cp /tmp/restore/crm.db ./crm.db
rm -rf uploads && cp -a /tmp/restore/uploads ./uploads
pm2 start crm
```

## Мониторинг

- Раз в сутки в S3 должен появляться новый `crm-backup-*.tar.gz`.
- Алерт: в `/var/log/crm-backup.log` нет `backup done` за 25+ часов.

## Шифрование

Включите SSE на бакете в консоли Yandex Cloud (рекомендуется).
