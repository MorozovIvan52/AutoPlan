# PowerShell скрипт для загрузки CRM на VPS через SCP
# Запустите из корня проекта: .\upload-to-vps.ps1

param(
  [string]$Host = "159.194.207.50",
  [string]$User = "root",
  [string]$RemoteDir = "/opt/crm",
  [string]$Password = ""
)

$ErrorActionPreference = "Stop"
$root = Split-Path $PSScriptRoot -Parent

Write-Host "╔════════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "║  CRM Upload to VPS (Beget)            ║" -ForegroundColor Cyan
Write-Host "╚════════════════════════════════════════╝" -ForegroundColor Cyan
Write-Host ""

if (-not (Test-Path "npm")) {
  Write-Host "Ошибка: запустите из корня проекта (где package.json)" -ForegroundColor Red
  exit 1
}

# Проверка, что dist собран
if (-not (Test-Path "dist")) {
  Write-Host "[0/5] Сборка фронтенда..." -ForegroundColor Yellow
  npm run build
  if ($LASTEXITCODE -ne 0) { exit 1 }
}

Write-Host "[1/5] Проверка SSH доступа..." -ForegroundColor Yellow
$sshTest = & ssh -o BatchMode=yes -o ConnectTimeout=5 "$User@$Host" "echo ok" 2>&1
if ($LASTEXITCODE -ne 0) {
  Write-Host "SSH недоступен. Используйте VNC консоль на Beget и запустите:" -ForegroundColor Red
  Write-Host ""
  Write-Host "cd /tmp && curl -fsSL https://raw.githubusercontent.com/your-repo/main/setup-deploy.sh | bash" -ForegroundColor White
  exit 1
}

Write-Host "[2/5] Загрузка dist..." -ForegroundColor Yellow
scp -r dist "$User@$Host`:$RemoteDir/" 2>&1 | Where-Object { $_ -notmatch "^$" }

Write-Host "[3/5] Загрузка api..." -ForegroundColor Yellow
scp -r api "$User@$Host`:$RemoteDir/" 2>&1 | Where-Object { $_ -notmatch "^$" }

Write-Host "[4/5] Загрузка конфигов..." -ForegroundColor Yellow
scp server.prod.ts ecosystem.config.cjs package.json package-lock.json "$User@$Host`:$RemoteDir/" 2>&1 | Where-Object { $_ -notmatch "^$" }
scp setup-deploy.sh "$User@$Host`:$RemoteDir/" 2>&1 | Where-Object { $_ -notmatch "^$" }

Write-Host "[5/5] Запуск деплоя на сервере..." -ForegroundColor Yellow
ssh "$User@$Host" "cd $RemoteDir && bash setup-deploy.sh"

Write-Host ""
Write-Host "✓ Деплой завершён!" -ForegroundColor Green
Write-Host ""
Write-Host "Приложение доступно: http://$Host" -ForegroundColor Green
Write-Host ""
