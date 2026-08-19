@echo off
chcp 65001 >nul
cd /d "%~dp0"
if not exist ".env" (
  echo [!] .env 파일이 없습니다. .env.example 을 복사해 값을 채우세요.
  pause
  exit /b 1
)
echo 배드민턴 웹앱 서버를 시작합니다...
node --env-file=.env server.js
pause
