# 🚀 Быстрый старт деплоя на VPS Beget

## Вариант 1: Автоматический деплой (рекомендуется)

### На вашем компьютере (Windows PowerShell):

```powershell
# Перейдите в корень проекта
cd c:\Users\1\Desktop\workspace-files (2)

# Запустите скрипт загрузки
.\upload-to-vps.ps1
```

**Что происходит:**
1. Собирает фронтенд (`npm run build`)
2. Загружает код на VPS через SCP
3. Запускает автоматический деплой на сервере
4. Запускает приложение через PM2

**Результат:** http://159.194.207.50 готов использовать

---

## Вариант 2: Ручной деплой через VNC консоль

### Шаг 1: Откройте консоль сервера

1. Откройте **https://cp.beget.com**
2. Сервер: **Rightful Razlo**
3. Нажмите **Терминал** → VNC консоль
4. Пароль: `cH8&)XzxRp6B`

### Шаг 2: Подготовьте сервер

Скопируйте и выполните:

```bash
# Создайте директорию для приложения
mkdir -p /opt/crm
cd /opt/crm
```

### Шаг 3: Загрузите код

На вашем компьютере (Windows PowerShell):

```powershell
cd c:\Users\1\Desktop\workspace-files (2)

# Собрать фронтенд
npm run build

# Загрузить на сервер
scp -r dist root@159.194.207.50:/opt/crm/
scp -r api root@159.194.207.50:/opt/crm/
scp server.prod.ts ecosystem.config.cjs package.json package-lock.json root@159.194.207.50:/opt/crm/
scp setup-deploy.sh root@159.194.207.50:/opt/crm/
```

### Шаг 4: Запустите деплой на сервере

В VNC консоли:

```bash
cd /opt/crm
bash setup-deploy.sh
```

Дождитесь завершения (~5-10 минут).

---

## Вариант 3: Полностью ручной (для опытных)

Следуйте инструкциям в файле: `DEPLOY_INSTRUCTIONS.md`

---

## После деплоя

### ✅ Проверьте приложение

```
http://159.194.207.50
```

Вы должны увидеть экран входа CRM.

### ✅ Создайте администратора

Нажмите "Регистрация" и создайте первого пользователя.

### ✅ Проверьте логи (если что-то не работает)

В VNC консоли:

```bash
pm2 logs crm
```

### ✅ Полезные команды

```bash
# Статус приложения
pm2 status

# Перезапуск
pm2 restart crm

# Остановка
pm2 stop crm

# Запуск
pm2 start ecosystem.config.cjs
```

---

## Проблемы и решения

### ❌ "Connection refused" на порту 4200

```bash
# Проверьте, запущено ли приложение
ps aux | grep tsx

# Посмотрите логи
pm2 logs crm

# Перезапустите
pm2 restart crm
```

### ❌ Nginx показывает ошибку 502

```bash
# Проверьте, что приложение слушает на 4200
curl http://localhost:4200/api/health

# Если не работает, проверьте Node.js процессы
pm2 status
```

### ❌ "Permission denied" при загрузке файлов

```bash
# На сервере убедитесь, что директория написываема
chmod -R 755 /opt/crm
mkdir -p /opt/crm/uploads
chmod -R 755 /opt/crm/uploads
```

---

## HTTPS (опционально, на позже)

Когда приложение работает, вы можете добавить HTTPS:

```bash
apt-get install -y certbot python3-certbot-nginx
certbot --nginx -d 159.194.207.50
```

---

## Файлы в этой папке

| Файл | Что делает |
|------|-----------|
| `upload-to-vps.ps1` | PowerShell скрипт для загрузки кода и запуска деплоя |
| `setup-deploy.sh` | Bash скрипт для автоматического деплоя на сервере |
| `DEPLOY_INSTRUCTIONS.md` | Подробные пошаговые инструкции |

---

## Быстрая справка: SSH команды

Если вам нужно подключиться к серверу напрямую (без VNC):

```bash
# SSH доступ
ssh root@159.194.207.50

# Пароль: cH8&)XzxRp6B
```

---

**Вопросы?** Проверьте файл `DEPLOY_INSTRUCTIONS.md` для полной информации.
