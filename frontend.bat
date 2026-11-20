@echo off
setlocal EnableExtensions
chcp 65001 >nul
title Prompt Warfare - Frontend (Vite)
cd /d "%~dp0"

rem ==================================================
rem  Frontend isolado (Vite) contra uma API ja em
rem  execucao: api-docker.bat (referencia) ou api-local.bat (teste).
rem ==================================================

echo ==================================================
echo   Prompt Warfare - frontend (Vite)
echo   Requer a API ja em execucao:
echo     api-docker.bat  (referencia)  porta 3000
echo     api-local.bat   (teste)       porta 3100
echo ==================================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [ERRO] Node.js nao encontrado no PATH.
  echo        Instale o Node 22.18 ou superior: https://nodejs.org
  goto :fail
)

if not exist "node_modules" (
  echo [1/3] Instalando dependencias...
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
  echo [1/3] Dependencias OK.
)

rem API usada pelo cliente. Ordem: API_URL > deteccao (3000 Docker, 3100 local) > 3000.
rem Variavel definida mas vazia conta como nao definida.
if "%API_URL%"=="" set "API_URL="
if defined API_URL goto :api_url_ready

set "DETECTED_API_URL="
for /f "delims=" %%u in ('node -e "const p=async u=>{try{const r=await fetch(u+'/api/health',{signal:AbortSignal.timeout(1200)});return r.ok}catch{return false}};(async()=>{for(const u of ['http://localhost:3000','http://127.0.0.1:3100'])if(await p(u))return console.log(u)})()" 2^>nul') do set "DETECTED_API_URL=%%u"
if not defined DETECTED_API_URL goto :api_url_default
set "API_URL=%DETECTED_API_URL%"
echo [i] API_URL nao definido; detectada a API em %API_URL%
goto :api_url_ready

:api_url_default
set "API_URL=http://localhost:3000"

:api_url_ready
set "VITE_API_URL=%API_URL%"
set "NODE_ENV=development"

if not defined FRONTEND_PORT set "FRONTEND_PORT=5173"

rem --- Porta fixa: CORS do container e definido na criacao, entao nada de fallback silencioso ---
node -e "const net=require('node:net');const s=net.createServer();s.once('error',()=>process.exit(1));s.listen(Number(process.env.FRONTEND_PORT),'127.0.0.1',()=>s.close(()=>process.exit(0)))" >nul 2>nul
if errorlevel 1 (
  echo.
  echo [ERRO] A porta %FRONTEND_PORT% ja esta em uso.
  echo.
  echo        Encerre o outro processo ou escolha outra porta. Exemplo:
  echo          set FRONTEND_PORT=5174
  echo          api-docker.bat up        ^(recria o container com o CORS novo^)
  echo          frontend.bat
  echo.
  echo        No modo local: ajuste FRONTEND_PORT e reinicie api-local.bat.
  goto :fail
)

echo [2/3] Verificando a API em %API_URL% ...
node -e "const api=process.env.API_URL.replace(/\/$/,'');const port=process.env.FRONTEND_PORT;const hosts=['localhost','127.0.0.1'];(async()=>{let h;try{const r=await fetch(api+'/api/health',{signal:AbortSignal.timeout(4000)});if(!r.ok)throw new Error('status '+r.status);h=await r.json()}catch(e){console.log('[aviso] A API nao respondeu em '+api+'/api/health');process.exit(1)}console.log('   API ok: '+h.protocol+' v'+h.protocolVersion+', devMode='+h.devMode);if(h.devMode)console.log('   [aviso] API em modo desenvolvimento: handshake afrouxado, nao serve como aceite.');let bad=false;for(const host of hosts){const origin='http://'+host+':'+port;try{const r=await fetch(api+'/api/health',{method:'OPTIONS',headers:{Origin:origin,'Access-Control-Request-Method':'GET'},signal:AbortSignal.timeout(4000)});const allow=r.headers.get('access-control-allow-origin');if(allow&&(allow==='*'||allow===origin)){console.log('   CORS ok para '+origin)}else{console.log('   [aviso] CORS nao liberou '+origin+(allow?' (allow-origin: '+allow+')':''));bad=true}}catch(e){console.log('   [aviso] Nao foi possivel checar CORS para '+origin);bad=true}}process.exit(bad?2:0)})()"
if errorlevel 2 goto :cors_blocked
if errorlevel 1 goto :api_offline

echo.
echo [3/3] Frontend em http://localhost:%FRONTEND_PORT%  ^(Ctrl+C encerra^)
echo       API: %VITE_API_URL%
echo.

if not defined NO_OPEN (
  start "" /b powershell -NoProfile -WindowStyle Hidden -Command "Start-Sleep -Seconds 3; Start-Process 'http://localhost:%FRONTEND_PORT%'" >nul 2>nul
)

call npx vite --port %FRONTEND_PORT% --strictPort --host 127.0.0.1
if errorlevel 1 goto :vite_failed

echo.
echo Frontend encerrado.
if not defined NO_PAUSE pause
exit /b 0

:vite_failed
echo.
echo Frontend encerrado com erro.
if not defined NO_PAUSE pause
exit /b 1

:api_offline
echo.
echo [ERRO] A API nao respondeu em %API_URL%/api/health
echo.
echo        O jogo abriria bloqueado com "Servidor indisponivel". Suba a API antes:
echo          api-docker.bat up    - referencia, porta 3000
echo          api-local.bat        - teste, porta 3100
echo.
echo        Se a API ja esta no ar em outra porta:
echo          set API_URL=http://127.0.0.1:3100
echo          frontend.bat
goto :fail

:cors_blocked
echo.
echo [ERRO] A API nao liberou a origem deste frontend (CORS).
echo.
echo        O navegador bloquearia /api/health e o jogo mostraria "Servidor indisponivel".
echo        Recrie/reinicie a API com esta origem liberada:
echo          api-docker.bat up    - CORS e definido na criacao do container
echo          api-local.bat stop   - depois rode api-local.bat de novo
goto :fail

:fail
echo.
echo Operacao nao concluida.
if not defined NO_PAUSE pause
exit /b 1
