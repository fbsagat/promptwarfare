@echo off
echo Starting Prompt Warfare in Development Mode...
:: Garante que o ambiente seja de desenvolvimento para o Vite
set NODE_ENV=development
call npm run dev
pause