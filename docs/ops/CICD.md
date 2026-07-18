# CI/CD — GitHub Actions

## Workflows

| Файл | Триггер | Действие |
|------|---------|----------|
| `.github/workflows/ci.yml` | PR, push | `npm ci`, typecheck, build |
| `.github/workflows/deploy-production.yml` | push main, manual | deploy на VPS по SSH |

## Секреты репозитория

**Settings → Secrets and variables → Actions**

| Secret | Пример |
|--------|--------|
| `VPS_HOST` | `159.194.207.50` или `crm.example.ru` |
| `VPS_USER` | `root` |
| `VPS_SSH_KEY` | приватный ключ OpenSSH (полное содержимое) |
| `VPS_APP_DIR` | `/opt/crm` |

**Variables** (опционально):

| Variable | Пример |
|----------|--------|
| `PUBLIC_URL` | `https://crm.example.ru` — для smoke test после деплоя |

## Environment `production`

Создайте Environment **production** с optional approval (ручное подтверждение деплоя).

## Подготовка VPS

1. `bash scripts/ops/install-server-stack.sh`
2. Клонировать/загрузить код в `/opt/crm`, `npm ci`, первый `pm2 start`
3. Добавить публичный ключ GitHub Actions в `~/.ssh/authorized_keys`:

```bash
echo "ssh-ed25519 AAAA... github-actions" >> ~/.ssh/authorized_keys
```

## Локальный деплой (альтернатива)

Windows: `npm run deploy:vps` (PowerShell + scp).

## Откат

```bash
ssh root@VPS
cd /opt/crm
# восстановить dist из бэкапа S3 или git checkout предыдущего коммита
pm2 restart crm
```

Рекомендуется тегировать релизы: `git tag v1.0.1 && git push origin v1.0.1`.

## Что не деплоится автоматически

- `.env` на сервере (секреты вручную)
- `crm.db` (данные)
- Изменения только в `docs/` и `knowledge-base/` не триггерят deploy (`paths-ignore`)
