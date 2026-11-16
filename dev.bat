@echo off
setlocal
chcp 65001 >nul
title Prompt Warfare - Servidor Local
cd /d "%~dp0"

echo ==================================================
echo   Prompt Warfare - servidor de desenvolvimento
echo ==================================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [ERRO] Node.js nao encontrado no PATH.
  echo        Instale o Node 22.18 ou superior: https://nodejs.org
  goto :fail
)

if not exist "node_modules" (
  echo [1/2] Instalando dependencias...
  where bun >nul 2>nul
  if errorlevel 1 (
    call npm install --legacy-peer-deps
  ) else (
    call bun install
  )
  if errorlevel 1 (
    echo [ERRO] Falha ao instalar as dependencias.
    goto :fail
  )
) else (
  echo [1/2] Dependencias OK.
)

if not exist ".env" (
  if exist ".env.example" (
    copy /y ".env.example" ".env" >nul
    echo [2/2] .env criado a partir de .env.example.
    echo        Sem GEMINI_API_KEY, armas e eventos usam o gerador procedural.
  ) else (
    echo [2/2] Aviso: .env nao encontrado. Usando o gerador procedural.
  )
) else (
  echo [2/2] .env encontrado. Para usar a IA, defina GEMINI_API_KEY nele.
)

if not defined PORT set "PORT=3000"
set "REQUESTED_PORT=%PORT%"

rem --- Escolhe a primeira porta livre a partir de %PORT% ---
set "PORT_FILE=%TEMP%\promptwarfare-port.txt"
if exist "%PORT_FILE%" del "%PORT_FILE%" >nul 2>nul
node -e "const net=require('node:net');const base=Number(process.env.PORT)||3000;const test=(p)=>new Promise((res)=>{const s=net.createServer();s.once('error',()=>res(false));s.listen(p,'0.0.0.0',()=>s.close(()=>res(true)));});(async()=>{for(let p=base;p<base+50&&p<65535;p++){if(await test(p)){process.stdout.write(String(p));return;}}process.stdout.write(String(base));})();" > "%PORT_FILE%" 2>nul
if exist "%PORT_FILE%" set /p PORT=<"%PORT_FILE%"
if exist "%PORT_FILE%" del "%PORT_FILE%" >nul 2>nul

if not "%PORT%"=="%REQUESTED_PORT%" (
  echo [i] A porta %REQUESTED_PORT% esta em uso por outro processo.
  echo     Usando a porta %PORT%. Para fixar outra, defina PORT antes de iniciar.
)

echo.
echo Servidor em http://localhost:%PORT%  ^(Ctrl+C encerra^)
echo.

if not defined NO_OPEN (
  start "" /b powershell -NoProfile -WindowStyle Hidden -Command "Start-Sleep -Seconds 3; Start-Process 'http://localhost:%PORT%'" >nul 2>nul
)

call npm run dev
set "EXIT_CODE=%ERRORLEVEL%"

echo.
echo Servidor encerrado.
if not "%EXIT_CODE%"=="0" echo Codigo de saida: %EXIT_CODE%
if not defined NO_PAUSE pause
exit /b %EXIT_CODE%

:fail
pause
exit /b 1
