# Выкладка CRM на Beget VPS — crmavito.online

Ваши данные:
- **VPS IP:** `159.194.207.50`
- **SSH:** `root@159.194.207.50`
- **Домен:** `crmavito.online`
- **DNS:** ns1.beget.com / ns2.beget.com (управление в Beget, не в Reg.ru)

---

## Шаг 1. DNS — самое важное

Сейчас домен указывает на **старый хостинг** `37.140.192.74`, а не на VPS.
Пока это не исправите, сайт не заработает.

1. Войдите в **панель Beget** → **Домены** → `crmavito.online`
2. Откройте **DNS-записи** / **Управление зоной**
3. Удалите записи, которые ведут на `37.140.192.74`
4. Добавьте:

| Тип | Имя | Значение |
|-----|-----|----------|
| **A** | `@` | `159.194.207.50` |
| **A** | `www` | `159.194.207.50` |

5. Подождите **15–60 минут**

Проверка (PowerShell):
```powershell
nslookup crmavito.online
```
Должен показать **159.194.207.50**, не 37.140.192.74.

---

## Шаг 2. Подготовить архив на компьютере

В PowerShell в папке проекта:

```powershell
cd "C:\Users\1\Desktop\workspace-files (2)"
npm run build
powershell -File scripts\package-for-upload.ps1
```

Появится файл **`crm-upload.zip`**.

> Если нужны ваши клиенты и чаты — перед упаковкой остановите локальный сервер
> и убедитесь, что в папке есть только `crm.db` (без `crm.db-wal`).

---

## SSH без пароля (один раз) — для деплоя с ПК

На вашем компьютере уже создан ключ `~/.ssh/crm_vps_ed25519` и алиас **`crm-vps`**.

1. В `.env` укажите пароль root VPS:
   ```
   VPS_SSH_HOST=159.194.207.50
   VPS_SSH_USER=root
   VPS_SSH_PASSWORD=пароль_из_Beget_Облако_VPS
   ```
   Пароль: Beget → **Облако** → VPS → **Реквизиты доступа** (не пароль панели).

2. Установите ключ на сервер:
   ```powershell
   npm run ssh:setup
   ```

3. Проверка:
   ```powershell
   ssh crm-vps "hostname"
   ```

4. Деплой обновлений одной командой:
   ```powershell
   npm run deploy:vps
   ```
   (соберёт `dist`, зальёт `dist` + `api`, перезапустит PM2)

---

## Шаг 3. Загрузить на VPS

### Вариант А — WinSCP

1. Скачайте [WinSCP](https://winscp.net/)
2. Подключение **SFTP** (для VPS):
   - **Протокол:** SFTP
   - **Хост:** `159.194.207.50`
   - **Порт:** `22`
   - **Пользователь:** `root`
   - **Пароль:** из панели Beget → **Облако** → VPS → «Реквизиты доступа»

   > Если WinSCP пишет *«сервер готов к FTP, но не SFTP»* — используйте **FTP**:
   > - **Протокол:** FTP
   > - **Порт:** `21`
   > - **Шифрование:** «Явный FTP через TLS» (если не пускает — «Без шифрования»)
   > - **Пользователь / пароль:** те же `root` + пароль VPS
   >
   > FTP только для **загрузки файла**. Команды `unzip` и деплой — в **Терминале Beget** (вариант Б).

3. Создайте папку `/opt/crm` (или `/root/crm` при FTP)
4. Загрузите `crm-upload.zip`
5. В панели Beget откройте **Терминал (VNC)** или SSH:

```bash
cd /opt/crm
apt install -y unzip
unzip -o crm-upload.zip
```

### Вариант Б — Файловый менеджер Beget (если WinSCP не подключается)

FTP на VPS часто **не работает** — это нормально. Используйте загрузку через браузер:

1. Beget → **Облако** → ваш VPS
2. Иконка **Файловый менеджер** (Sprut.io)
3. Если просит ключ — **Настройки сервера** → разрешить доступ файловому менеджеру
4. Перейдите в `/opt/crm` (создайте папку) или `/root`
5. **Загрузить** → выберите `crm-upload.zip` с компьютера
6. Откройте **Терминал** на той же странице VPS:

```bash
mkdir -p /opt/crm
mv /root/crm-upload.zip /opt/crm/ 2>/dev/null || true
cd /opt/crm
apt install -y unzip
unzip -o crm-upload.zip
```

7. Далее — команды из шага 4.

### Вариант В — Проверка SFTP (если хотите WinSCP)

Сначала проверьте пароль в PowerShell:

```powershell
ssh root@159.194.207.50
```

Пароль — **только** из Beget → Облако → VPS → **Реквизиты доступа** (не пароль входа в панель `hurley62`).

В WinSCP обязательно:
- **SFTP**, порт **22** (не FTP и не 21)
- пользователь **root**

Если SFTP снова не пускает — используйте вариант Б (файловый менеджер).

---

## Шаг 4. Установка на сервере

В SSH на VPS:

```bash
cd /opt/crm
chmod +x scripts/deploy-beget-vps.sh
bash scripts/deploy-beget-vps.sh
```

Скрипт установит Node.js, Nginx, PM2, соберёт CRM и запустит её.

---

## Шаг 5. HTTPS (SSL)

После того как DNS указывает на VPS:

```bash
certbot --nginx -d crmavito.online -d www.crmavito.online
```

- Введите email
- Согласитесь с условиями
- Выберите **редирект на HTTPS** (вариант 2)

---

## Шаг 6. Первый вход

1. Откройте **https://crmavito.online**
2. Если база пустая:
   ```bash
   curl -X POST http://localhost:4200/api/seed
   ```
3. Логин: `admin@crm.local` / `admin123` — **сразу смените пароль**

---

## Шаг 7. Авито webhook

В `.env` на сервере:
```env
PUBLIC_URL=https://crmavito.online
```

В кабинете Авито для каждого аккаунта:
```
https://crmavito.online/api/webhooks/avito/avito_1
https://crmavito.online/api/webhooks/avito/avito_2
...
```

Или настройте ключи в **Настройки → Каналы**.

---

## Проверка что всё работает

```bash
pm2 status          # crm = online
pm2 logs crm        # без ошибок
curl http://localhost:4200/api/health   # {"status":"ok"}
```

В браузере: `https://crmavito.online` — страница входа.

---

## Обновление после изменений

На компьютере снова `package-for-upload.ps1`, загрузите на VPS, затем:

```bash
cd /opt/crm
unzip -o crm-upload.zip
npm ci
npm run setup:prod
npm run build
pm2 restart crm
```

---

## Частые проблемы

| Симптом | Решение |
|---------|---------|
| Белый экран | Не сделали `npm run build` — в index.html должен быть `/assets/...js`, не `/src/main.tsx` |
| 404 на /api/health | PM2 не запущен: `pm2 start ecosystem.config.cjs` |
| Домен открывает заглушку Reg.ru | DNS ещё на 37.140.192.74 — исправьте A-запись в Beget |
| WinSCP: «Доступ не разрешён» | Неверный пароль root. Не путать с паролем панели `hurley62`. Сброс: Облако → VPS → **Сброс пароля** → письмо на email → **перезагрузить VPS** |
| Авито не шлёт сообщения | Нужен HTTPS и `PUBLIC_URL=https://crmavito.online` |

---

## Безопасность

- **Смените пароли** панели Beget и root VPS после настройки
- Не публикуйте `.env` и `crm.db` в открытый доступ
- Делайте бэкап: `cp /opt/crm/crm.db /opt/backups/crm-$(date +%F).db`
