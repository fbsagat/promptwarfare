@echo off
setlocal
chcp 65001 >nul
title Prompt Warfare - API (Docker)
cd /d "%~dp0"

rem ==========================================================
rem  Sobe apenas a API/WebSocket no container Docker.
rem  Para o frontend, use frontend.bat apontando API_URL.
rem  API local sem Docker (testes): api-local.bat.
rem ==========================================================

if not defined API_PORT set "API_PORT=3000"
if not defined LOG_LINES set "LOG_LINES=120"

if "%~1"=="" goto :menu
if /i "%~1"=="menu" goto :menu
if /i "%~1"=="help" goto :arg_help
if /i "%~1"=="up" goto :arg_up
if /i "%~1"=="start" goto :arg_start
if /i "%~1"=="restart" goto :arg_restart
if /i "%~1"=="rebuild" goto :arg_rebuild
if /i "%~1"=="status" goto :arg_status
if /i "%~1"=="health" goto :arg_health
if /i "%~1"=="logs" goto :arg_logs
if /i "%~1"=="urls" goto :arg_urls
if /i "%~1"=="stop" goto :arg_stop
if /i "%~1"=="down" goto :arg_down

echo [ERRO] Comando desconhecido: %~1
echo.
call :print_help
goto :fail

:arg_up
call :cmd_up
if errorlevel 1 goto :fail
goto :done

:arg_start
call :cmd_start
if errorlevel 1 goto :fail
goto :done

:arg_restart
call :cmd_restart
if errorlevel 1 goto :fail
goto :done

:arg_rebuild
call :cmd_rebuild
if errorlevel 1 goto :fail
goto :done

:arg_status
call :cmd_status
if errorlevel 1 goto :fail
goto :done

:arg_health
call :cmd_health
if errorlevel 1 goto :fail
goto :done

:arg_logs
call :cmd_logs
if errorlevel 1 goto :fail
goto :done

:arg_urls
call :cmd_urls
if errorlevel 1 goto :fail
goto :done

:arg_stop
call :cmd_stop
if errorlevel 1 goto :fail
goto :done

:arg_down
call :cmd_down
if errorlevel 1 goto :fail
goto :done

:arg_help
call :print_help
goto :done

rem ============================== menu ==============================

:menu
call :ensure_tools
if errorlevel 1 goto :fail
call :resolve_port
cls
echo ==========================================================
echo   Prompt Warfare - API no Docker
echo ==========================================================
echo.
call :menu_status
echo.
echo   [1] Subir/atualizar (build + up)
echo   [2] Iniciar sem rebuild
echo   [3] Reiniciar
echo   [4] Rebuild sem cache
echo   [5] Status e health
echo   [6] Logs (Ctrl+C volta ao menu)
echo   [7] Mostrar URLs
echo   [8] Parar
echo   [9] Derrubar tudo (down)
echo   [0] Sair
echo.
set "OPT="
set /p "OPT=Opcao: "
echo.
if "%OPT%"=="1" call :cmd_up
if "%OPT%"=="2" call :cmd_start
if "%OPT%"=="3" call :cmd_restart
if "%OPT%"=="4" call :cmd_rebuild
if "%OPT%"=="5" call :cmd_status
if "%OPT%"=="6" call :cmd_logs
if "%OPT%"=="7" call :cmd_urls
if "%OPT%"=="8" call :cmd_stop
if "%OPT%"=="9" call :cmd_down
if "%OPT%"=="0" goto :menu_exit
if "%OPT%"=="" goto :menu
goto :menu

:menu_exit
echo Ate mais.
exit /b 0

:menu_status
set "APP_STATE="
for /f "delims=" %%s in ('docker compose ps -a --format "{{.State}}" 2^>nul') do set "APP_STATE=%%s"
if not defined APP_STATE (
  echo   Container : nenhum ^(use [1] para subir^)
) else (
  echo   Container : %APP_STATE%
)
echo   Porta API : %API_PORT%
exit /b 0

rem ========================== comandos =============================

:cmd_up
call :ensure_tools
if errorlevel 1 exit /b 1
call :resolve_port
echo.
echo [..] Subindo a API (docker compose up -d --build)...
docker compose up -d --build
if errorlevel 1 (
  echo.
  echo [ERRO] Falha ao subir o container. Ultimas linhas:
  docker compose logs --tail 40
  exit /b 1
)
call :wait_health
if errorlevel 1 exit /b 1
call :print_summary
exit /b 0

:cmd_start
call :ensure_tools
if errorlevel 1 exit /b 1
call :resolve_port
echo.
echo [..] Iniciando a API sem rebuild (docker compose up -d)...
docker compose up -d
if errorlevel 1 (
  echo.
  echo [ERRO] Falha ao iniciar o container. Ultimas linhas:
  docker compose logs --tail 40
  exit /b 1
)
call :wait_health
if errorlevel 1 exit /b 1
call :print_summary
exit /b 0

:cmd_restart
call :ensure_tools
if errorlevel 1 exit /b 1
call :resolve_port
echo.
echo [..] Reiniciando a API (docker compose restart)...
docker compose restart
if errorlevel 1 (
  echo [ERRO] Falha ao reiniciar. Use "api-docker.bat up".
  exit /b 1
)
call :wait_health
if errorlevel 1 exit /b 1
call :print_summary
exit /b 0

:cmd_rebuild
call :ensure_tools
if errorlevel 1 exit /b 1
call :resolve_port
echo.
echo [..] Rebuild sem cache (pode demorar alguns minutos)...
docker compose build --no-cache
if errorlevel 1 (
  echo [ERRO] Falha no build.
  exit /b 1
)
docker compose up -d
if errorlevel 1 (
  echo [ERRO] Falha ao subir o container.
  exit /b 1
)
call :wait_health
if errorlevel 1 exit /b 1
call :print_summary
exit /b 0

:cmd_status
call :ensure_tools
if errorlevel 1 exit /b 1
call :resolve_port
echo.
echo --- Containers ---
docker compose ps -a
echo.
set "APP_ID="
for /f "delims=" %%i in ('docker compose ps -q app 2^>nul') do set "APP_ID=%%i"
if defined APP_ID (
  docker inspect --format "API: estado={{.State.Status}} | health={{if .State.Health}}{{.State.Health.Status}}{{else}}n/a{{end}} | reinicios={{.RestartCount}}" %APP_ID%
) else (
  echo API: nenhum container criado ainda.
)
echo.
echo --- /api/health ---
call :http_health
echo.
exit /b 0

:cmd_health
call :resolve_port
echo.
call :http_health
echo.
exit /b 0

:cmd_logs
call :ensure_tools
if errorlevel 1 exit /b 1
call :resolve_port
echo.
echo [..] Logs da API (Ctrl+C volta). Ultimas %LOG_LINES% linhas.
echo.
docker compose logs -f --tail %LOG_LINES% app
exit /b 0

:cmd_urls
call :resolve_port
call :print_summary
exit /b 0

:cmd_stop
call :ensure_tools
if errorlevel 1 exit /b 1
call :resolve_port
echo.
echo [..] Parando a API...
docker compose stop
if errorlevel 1 (
  echo [ERRO] Falha ao parar.
  exit /b 1
)
echo [ok] Container parado. Use "api-docker.bat start" para voltar.
exit /b 0

:cmd_down
call :ensure_tools
if errorlevel 1 exit /b 1
call :resolve_port
echo.
if defined FORCE goto :down_yes
set "CONFIRM="
set /p "CONFIRM=Derrubar o container da API? (s/N): "
if /i "%CONFIRM%"=="s" goto :down_yes
if /i "%CONFIRM%"=="sim" goto :down_yes
if /i "%CONFIRM%"=="y" goto :down_yes
echo Cancelado.
exit /b 0
:down_yes
echo [..] Derrubando container e rede (docker compose down)...
docker compose down
if errorlevel 1 (
  echo [ERRO] Falha ao derrubar.
  exit /b 1
)
echo [ok] Container removido. A imagem e o volume de dados foram mantidos.
exit /b 0

rem =========================== utilitarios =========================

:ensure_tools
where docker >nul 2>nul
if errorlevel 1 (
  echo [ERRO] Docker nao encontrado no PATH.
  echo        Instale e inicie o Docker Desktop: https://docs.docker.com/desktop/
  exit /b 1
)
docker version --format "{{.Server.Version}}" >nul 2>nul
if errorlevel 1 (
  echo [ERRO] O daemon do Docker nao respondeu.
  echo        Abra o Docker Desktop e espere o status "Running".
  exit /b 1
)
docker compose version >nul 2>nul
if errorlevel 1 (
  echo [ERRO] Docker Compose v2 indisponivel.
  echo        Atualize o Docker Desktop.
  exit /b 1
)
exit /b 0

:resolve_port
rem Reaproveita a porta publicada pelo container em execucao.
set "RUNNING_API_PORT="
for /f "delims=" %%p in ('node -e "try{const{execSync}=require('node:child_process');const out=execSync('docker compose port app 3000',{encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim();const m=out.match(/(\d+)\s*$/);if(m)process.stdout.write(m[1])}catch{}" 2^>nul') do set "RUNNING_API_PORT=%%p"
if defined RUNNING_API_PORT (
  set "API_PORT=%RUNNING_API_PORT%"
  exit /b 0
)
rem Sem container: escolhe a primeira porta livre a partir de API_PORT.
set "REQUESTED_API_PORT=%API_PORT%"
set "PORT_FILE=%TEMP%\promptwarfare-api-docker-port.txt"
if exist "%PORT_FILE%" del "%PORT_FILE%" >nul 2>nul
node -e "const net=require('node:net');const base=Number(process.env.API_PORT)||3000;const test=(p)=>new Promise((res)=>{const s=net.createServer();s.once('error',()=>res(false));s.listen(p,'0.0.0.0',()=>s.close(()=>res(true)));});(async()=>{for(let p=base;p<base+50&&p<65535;p++){if(await test(p)){process.stdout.write(String(p));return;}}process.stdout.write(String(base));})();" > "%PORT_FILE%" 2>nul
if exist "%PORT_FILE%" set /p API_PORT=<"%PORT_FILE%"
if exist "%PORT_FILE%" del "%PORT_FILE%" >nul 2>nul
if not "%API_PORT%"=="%REQUESTED_API_PORT%" (
  echo [i] A porta %REQUESTED_API_PORT% esta ocupada; publicando a API na porta %API_PORT%.
)
if not defined ASSET_BASE_URL set "ASSET_BASE_URL=http://localhost:%API_PORT%/assets/files"
exit /b 0

:wait_health
echo [..] Aguardando http://localhost:%API_PORT%/api/health ...
where curl.exe >nul 2>nul
if errorlevel 1 goto :wait_health_ps
set /a HEALTH_TRIES=0
:wait_health_loop
curl.exe -fsS --max-time 2 "http://localhost:%API_PORT%/api/health" >nul 2>nul
if not errorlevel 1 goto :wait_health_ok
set /a HEALTH_TRIES+=1
if %HEALTH_TRIES% GEQ 45 goto :wait_health_fail
>nul ping -n 2 127.0.0.1
goto :wait_health_loop

:wait_health_ps
>nul ping -n 6 127.0.0.1
powershell -NoProfile -Command "try { Invoke-WebRequest -UseBasicParsing -TimeoutSec 4 http://localhost:%API_PORT%/api/health | Out-Null } catch { exit 1 }"
if errorlevel 1 goto :wait_health_fail
goto :wait_health_ok

:wait_health_ok
echo [ok] API respondendo em http://localhost:%API_PORT%
exit /b 0

:wait_health_fail
echo.
echo [ERRO] A API nao respondeu em 45s. Ultimas linhas do container:
docker compose logs --tail 40
exit /b 1

:http_health
where curl.exe >nul 2>nul
if errorlevel 1 goto :http_health_ps
curl.exe -fsS --max-time 4 "http://localhost:%API_PORT%/api/health"
if not errorlevel 1 exit /b 0
echo API nao respondeu em http://localhost:%API_PORT%/api/health
exit /b 0

:http_health_ps
powershell -NoProfile -Command "try { (Invoke-WebRequest -UseBasicParsing -TimeoutSec 4 http://localhost:%API_PORT%/api/health).Content } catch { 'API nao respondeu em http://localhost:%API_PORT%/api/health' }"
exit /b 0

:print_summary
echo.
echo   API       : http://localhost:%API_PORT%
echo   WebSocket : ws://localhost:%API_PORT%/ws
echo   Health    : http://localhost:%API_PORT%/api/health
echo   Assets    : http://localhost:%API_PORT%/assets/files
echo   Frontend  : frontend.bat (usa http://localhost:%API_PORT%)
echo.
echo   Logs: api-docker.bat logs   ^| Parar: api-docker.bat stop
exit /b 0

:print_help
echo Uso: api-docker.bat [comando]
echo.
echo   (sem comando)  Menu interativo
echo   up            Build + sobe/atualiza o container   ^(padrao do menu^)
echo   start         Sobe sem rebuild
echo   restart       Reinicia o container
echo   rebuild       Rebuild sem cache (mais lento)
echo   status        Containers, health e /api/health
echo   health        Mostra o JSON de /api/health
echo   logs          Acompanha os logs (Ctrl+C volta)
echo   urls          Mostra as URLs da API
echo   stop          Para o container
echo   down          Remove container e rede (pede confirmacao)
echo.
echo Opcoes: API_PORT=3000  LOG_LINES=120  FORCE=1 (down sem confirmar)  NO_PAUSE=1
exit /b 0

rem ============================== fim ==============================

:done
if not defined NO_PAUSE pause
exit /b 0

:fail
echo.
echo Operacao nao concluida.
if not defined NO_PAUSE pause
exit /b 1
