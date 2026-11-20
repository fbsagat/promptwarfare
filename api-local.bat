@echo off
setlocal EnableExtensions
chcp 65001 >nul
title Prompt Warfare - API local (teste)
cd /d "%~dp0"

rem ==========================================================
rem  API/WebSocket a partir do codigo, SEM Docker.
rem  Serve para a equipe testar o jogo; NAO e referencia de aceite.
rem  A referencia continua sendo o container: api-docker.bat up
rem ==========================================================

if not defined API_PORT set "API_PORT=3100"
if not defined HOST set "HOST=127.0.0.1"
if not defined FRONTEND_PORT set "FRONTEND_PORT=5173"
if not defined MODE set "MODE=strict"

set "LOCAL_DIR=%~dp0data\local"
set "PID_FILE=%LOCAL_DIR%\api.pid"
set "OUT_LOG=%LOCAL_DIR%\api.out.log"
set "ERR_LOG=%LOCAL_DIR%\api.err.log"

if "%~1"=="" goto :cmd_start
if /i "%~1"=="start" goto :cmd_start
if /i "%~1"=="stop" goto :cmd_stop
if /i "%~1"=="status" goto :cmd_status
if /i "%~1"=="logs" goto :cmd_logs
if /i "%~1"=="help" goto :arg_help

echo [ERRO] Comando desconhecido: %~1
echo.
call :print_help
goto :fail

:arg_help
call :print_help
goto :done

rem ============================ start ==============================

:cmd_start
call :ensure_tools
if errorlevel 1 goto :fail
call :ensure_deps
if errorlevel 1 goto :fail
call :ensure_data_dir
if errorlevel 1 goto :fail

call :print_banner

call :health_check
if not errorlevel 1 (
  echo [i] Ja existe uma API respondendo em http://127.0.0.1:%API_PORT%
  echo     Nada a fazer. Use "api-local.bat status" ou "api-local.bat stop".
  echo.
  echo   Frontend: defina API_URL e rode frontend.bat
  echo     set API_URL=http://127.0.0.1:%API_PORT%
  echo     frontend.bat
  echo.
  echo   Reiniciar com outra configuracao: api-local.bat stop  e  api-local.bat
  echo.
  call :health_json
  goto :done
)

call :find_port_pid
if defined PORT_PID (
  echo [ERRO] A porta %API_PORT% ja esta em uso pelo PID %PORT_PID%.
  echo        Encerre esse processo ou use outra porta: set API_PORT=3101
  echo        ^(se for uma API local antiga: api-local.bat stop^)
  goto :fail
)

if /i "%MODE%"=="dev" goto :start_dev
if /i not "%MODE%"=="strict" (
  echo [ERRO] MODE invalido: %MODE%  ^(use strict ou dev^)
  goto :fail
)

rem ---------- modo strict: paridade de contrato com o Docker ----------
set "NODE_ENV=production"
set "SERVE_CLIENT=false"
set "PORT=%API_PORT%"
if not defined CORS_ORIGINS set "CORS_ORIGINS=http://localhost:%FRONTEND_PORT%,http://127.0.0.1:%FRONTEND_PORT%"
if not defined ASSET_BASE_URL set "ASSET_BASE_URL=http://localhost:%API_PORT%/assets/files"
if not defined PROMPT_LEDGER_DB_PATH set "PROMPT_LEDGER_DB_PATH=./data/local/prompt-ledger.db"

echo   Modo      : strict (NODE_ENV=production, SERVE_CLIENT=false)
echo   Porta     : %API_PORT%  ^(HOST=%HOST%^)
echo   Dev tools : desativadas ^(F8 nao aparece; use MODE=dev^)
echo   Ledger    : %PROMPT_LEDGER_DB_PATH%
echo   CORS      : %CORS_ORIGINS%
echo.
echo [..] Iniciando node server.ts em segundo plano...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$p = Start-Process -FilePath 'node' -ArgumentList 'server.ts' -WorkingDirectory '%CD%' -RedirectStandardOutput '%OUT_LOG%' -RedirectStandardError '%ERR_LOG%' -PassThru -WindowStyle Hidden; Set-Content -LiteralPath '%PID_FILE%' -Value $p.Id -Encoding ascii"
if errorlevel 1 (
  echo [ERRO] Falha ao iniciar o processo. Veja %ERR_LOG%
  goto :fail
)
goto :wait_start

rem ---------- modo dev: processo unico (API + Vite), handshake afrouxado ----------
:start_dev
set "NODE_ENV=development"
set "SERVE_CLIENT=true"
set "PORT=%API_PORT%"
if not defined PROMPT_LEDGER_DB_PATH set "PROMPT_LEDGER_DB_PATH=./data/local/prompt-ledger.db"
rem Em dev o Vite embutido serve o cliente, mas o frontend.bat na 5173
rem tambem precisa de CORS liberado para a API nao bloquear o /api/health.
if not defined CORS_ORIGINS set "CORS_ORIGINS=http://localhost:%FRONTEND_PORT%,http://127.0.0.1:%FRONTEND_PORT%"

echo   Modo      : dev (npm run dev, handshake afrouxado)
echo   Porta     : %API_PORT%  ^(HOST=%HOST%^)
echo   Dev tools : ativas ^(tecla F8 durante a partida^)
echo   Frontend  : http://localhost:%API_PORT%  ^(Vite embutido; frontend.bat na 5173 tambem funciona^)
echo.
echo [..] Iniciando npm run dev em segundo plano...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$p = Start-Process -FilePath 'npm.cmd' -ArgumentList 'run','dev' -WorkingDirectory '%CD%' -RedirectStandardOutput '%OUT_LOG%' -RedirectStandardError '%ERR_LOG%' -PassThru -WindowStyle Hidden; Set-Content -LiteralPath '%PID_FILE%' -Value $p.Id -Encoding ascii"
if errorlevel 1 (
  echo [ERRO] Falha ao iniciar o processo. Veja %ERR_LOG%
  goto :fail
)
goto :wait_start

:wait_start
echo [..] Aguardando http://127.0.0.1:%API_PORT%/api/health ...
set /a HEALTH_TRIES=0
:wait_start_loop
call :health_check
if not errorlevel 1 goto :wait_start_ok
set /a HEALTH_TRIES+=1
if %HEALTH_TRIES% GEQ 45 goto :wait_start_fail
>nul ping -n 2 127.0.0.1
goto :wait_start_loop

:wait_start_ok
echo [ok] API local respondendo.
echo.
if /i "%MODE%"=="dev" (
  echo   API       : http://localhost:%API_PORT%
  echo   WebSocket : ws://localhost:%API_PORT%/ws
  echo   Frontend  : http://localhost:%API_PORT%  ^(ou 5173 via frontend.bat^)
  echo   Dev tools : F8 durante a partida
) else (
  echo   API       : http://localhost:%API_PORT%
  echo   WebSocket : ws://localhost:%API_PORT%/ws
  echo   Health    : http://localhost:%API_PORT%/api/health
  echo   Assets    : http://localhost:%API_PORT%/assets/files
  echo.
  echo   Frontend  : frontend.bat API_URL=http://localhost:%API_PORT%
  echo   Dev tools : desativadas ^(pare e rode com MODE=dev para usar F8^)
)
echo.
echo   Logs : api-local.bat logs
echo   Parar: api-local.bat stop
echo.
goto :done

:wait_start_fail
echo.
echo [ERRO] A API local nao respondeu em 45s.
echo        Ultimas linhas de %ERR_LOG%:
powershell -NoProfile -Command "Get-Content -LiteralPath '%ERR_LOG%' -Tail 20 -ErrorAction SilentlyContinue"
call :kill_from_pidfile
goto :fail

rem ============================ stop ===============================

:cmd_stop
call :ensure_tools
if errorlevel 1 goto :fail
call :find_port_pid
set "STOP_PID=%PORT_PID%"
if defined STOP_PID goto :stop_have_pid
call :read_pidfile
set "STOP_PID=%PID%"
:stop_have_pid
if not defined STOP_PID goto :stop_none

if defined FORCE goto :stop_yes
set "CONFIRM="
set /p "CONFIRM=Parar a API local na porta %API_PORT% (PID %STOP_PID%)? (s/N): "
if /i "%CONFIRM%"=="s" goto :stop_yes
if /i "%CONFIRM%"=="sim" goto :stop_yes
if /i "%CONFIRM%"=="y" goto :stop_yes
echo Cancelado.
goto :done

:stop_none
echo Nenhuma API local encontrada na porta %API_PORT%.
if exist "%PID_FILE%" del "%PID_FILE%" >nul 2>nul
goto :done

:stop_yes
echo [..] Encerrando PID %STOP_PID%...
taskkill /PID %STOP_PID% /T /F
if exist "%PID_FILE%" del "%PID_FILE%" >nul 2>nul
echo [ok] API local encerrada.
goto :done

rem =========================== status =============================

:cmd_status
call :ensure_tools
if errorlevel 1 goto :fail
echo.
echo --- Processo ---
set "PID="
call :read_pidfile
if defined PID (
  tasklist /FI "PID eq %PID%" /FO CSV /NH 2>nul
) else (
  echo sem PID registrado ^(nenhuma API iniciada por api-local.bat^)
)
echo.
echo --- Porta %API_PORT% ---
call :find_port_pid
if defined PORT_PID (
  echo em uso pelo PID %PORT_PID%
) else (
  echo livre
)
echo.
echo --- /api/health ---
call :health_check
if errorlevel 1 (
  echo API nao respondeu em http://127.0.0.1:%API_PORT%/api/health
) else (
  call :health_json
)
echo.
goto :done

rem ============================ logs ==============================

:cmd_logs
if not exist "%OUT_LOG%" (
  echo Nenhum log encontrado em %LOCAL_DIR%
  goto :done
)
echo Ultimas linhas de %OUT_LOG%
echo.
powershell -NoProfile -Command "Get-Content -LiteralPath '%OUT_LOG%' -Tail 40 -ErrorAction SilentlyContinue; Write-Host ''; Write-Host '--- stderr ---'; Get-Content -LiteralPath '%ERR_LOG%' -Tail 40 -ErrorAction SilentlyContinue"
goto :done

rem ========================= utilitarios ==========================

:ensure_tools
where node >nul 2>nul
if errorlevel 1 (
  echo [ERRO] Node.js nao encontrado no PATH.
  echo        Instale o Node 22.18 ou superior: https://nodejs.org
  exit /b 1
)
node -e "const v=process.versions.node.split('.').map(Number);process.exit(v[0]>22||(v[0]===22&&v[1]>=18)?0:1)" >nul 2>nul
if errorlevel 1 (
  echo [ERRO] Node 22.18+ e obrigatorio. Versao atual:
  node -v
  echo        Atualize o Node: https://nodejs.org
  exit /b 1
)
where powershell >nul 2>nul
if errorlevel 1 (
  echo [ERRO] PowerShell nao encontrado no PATH.
  echo        O api-local.bat usa PowerShell para iniciar o processo em segundo plano.
  exit /b 1
)
exit /b 0

:ensure_deps
if exist "node_modules" exit /b 0
echo [..] node_modules ausente; instalando dependencias...
where bun >nul 2>nul
if errorlevel 1 (
  call npm install --legacy-peer-deps
) else (
  call bun install
)
if errorlevel 1 (
  echo [ERRO] Falha ao instalar dependencias.
  exit /b 1
)
exit /b 0

:ensure_data_dir
if not exist "%LOCAL_DIR%" mkdir "%LOCAL_DIR%" >nul 2>nul
if not exist "%LOCAL_DIR%" (
  echo [ERRO] Nao foi possivel criar %LOCAL_DIR%
  exit /b 1
)
exit /b 0

:find_port_pid
set "PORT_PID="
for /f "tokens=5" %%p in ('netstat -ano -p tcp ^| findstr /r /c:":%API_PORT% .*LISTENING"') do set "PORT_PID=%%p"
exit /b 0

:read_pidfile
set "PID="
if exist "%PID_FILE%" set /p PID=<"%PID_FILE%"
exit /b 0

:kill_from_pidfile
call :read_pidfile
if defined PID taskkill /PID %PID% /T /F >nul 2>nul
if exist "%PID_FILE%" del "%PID_FILE%" >nul 2>nul
exit /b 0

:health_check
where curl.exe >nul 2>nul
if errorlevel 1 goto :health_check_ps
curl.exe -fsS --max-time 2 "http://127.0.0.1:%API_PORT%/api/health" >nul 2>nul
exit /b %ERRORLEVEL%

:health_check_ps
powershell -NoProfile -Command "try { Invoke-WebRequest -UseBasicParsing -TimeoutSec 3 'http://127.0.0.1:%API_PORT%/api/health' | Out-Null; exit 0 } catch { exit 1 }"
exit /b %ERRORLEVEL%

:health_json
where curl.exe >nul 2>nul
if errorlevel 1 goto :health_json_ps
curl.exe -fsS --max-time 3 "http://127.0.0.1:%API_PORT%/api/health"
exit /b 0

:health_json_ps
powershell -NoProfile -Command "try { (Invoke-WebRequest -UseBasicParsing -TimeoutSec 3 'http://127.0.0.1:%API_PORT%/api/health').Content } catch { }"
exit /b 0

:print_banner
echo ==========================================================
echo   Prompt Warfare - API local ^(SOMENTE TESTES^)
echo ----------------------------------------------------------
echo   NAO e o servidor de referencia.
echo   O aceite e sempre no Docker: api-docker.bat up
echo ==========================================================
echo.
exit /b 0

:print_help
echo Uso: api-local.bat [comando]
echo.
echo   (sem comando)  Sobe a API local em segundo plano
echo   start         Sobe a API local em segundo plano
echo   stop          Encerra a API local ^(pede confirmacao^)
echo   status        Processo, porta e /api/health
echo   logs          Ultimas linhas de data\local\api.out.log / api.err.log
echo   help          Esta ajuda
echo.
echo Modos: MODE=strict ^(padrao: NODE_ENV=production, SERVE_CLIENT=false, handshake estrito^)
echo        MODE=dev    ^(npm run dev: API + Vite no mesmo processo, handshake afrouxado^)
echo.
echo Opcoes: API_PORT=3100  HOST=127.0.0.1  FRONTEND_PORT=5173
echo          FORCE=1 ^(stop sem confirmar^)  NO_PAUSE=1
echo          CORS_ORIGINS, ASSET_BASE_URL, PROMPT_LEDGER_DB_PATH
echo.
echo O modo local usa data\local\prompt-ledger.db para nao disputar o ledger do Docker.
exit /b 0

:done
if not defined NO_PAUSE pause
exit /b 0

:fail
echo.
echo Operacao nao concluida.
if not defined NO_PAUSE pause
exit /b 1
