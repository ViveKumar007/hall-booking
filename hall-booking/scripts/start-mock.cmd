@echo off
rem Starts the mock booking API on http://127.0.0.1:3000 (keep this window open).
cd /d "%~dp0..\mock"
if not exist db.json copy /y db.seed.json db.json >nul
npx --yes json-server@0.17.4 --watch db.json --host 127.0.0.1 --port 3000
