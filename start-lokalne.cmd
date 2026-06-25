@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo ============================================================
echo  Spoustim lokalni nahled generatoru vyrocni zpravy...
echo  Po hlasce "Ready on http://127.0.0.1:8788" otevri v prohlizeci:
echo.
echo      http://127.0.0.1:8788
echo.
echo  Toto okno nechej otevrene. Server zastavis zavrenim okna
echo  nebo klavesami Ctrl+C.
echo ============================================================
echo.
call npx wrangler pages dev public --port 8788 --compatibility-date 2026-01-01
echo.
echo (Server byl ukoncen.)
pause
