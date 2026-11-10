@echo off
rem Builds the React frontend (frontend-react) into frontend-react\dist, which the backend serves on http://localhost:8090.
rem Run it after changing the frontend. Needs Node.js 20.19+ or 22.12+; the first run downloads the packages.
cd /d "%~dp0..\..\frontend-react"
if not exist node_modules call npm ci --no-audit --no-fund
call npm run build
