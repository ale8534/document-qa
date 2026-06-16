@echo off
title SBR Designer

echo.
echo  ================================================
echo   SBR Designer -- Avvio in corso...
echo  ================================================
echo.

:: Verifica che npm sia disponibile
where npm >nul 2>&1
if %errorlevel% neq 0 (
    echo  ERRORE: npm non trovato.
    echo  Installa Node.js da https://nodejs.org
    echo.
    pause
    exit /b 1
)

:: Installa dipendenze se mancano
if not exist "node_modules" (
    echo  Prima installazione dipendenze -- attendere...
    npm install
    echo.
)

:: Avvia il server in una nuova finestra
echo  Avvio server Vite...
start "SBR Designer - Server" cmd /k "npm run dev"

:: Attendi che il server sia pronto
echo  Attendo che il server sia pronto...
timeout /t 5 /nobreak > nul

:: Apri il browser
echo  Apertura browser...
start http://localhost:5173

echo.
echo  App aperta su: http://localhost:5173
echo.
echo  Per fermare il server chiudi la finestra "SBR Designer - Server"
echo.
pause
