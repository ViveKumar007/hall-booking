@echo off
rem Starts the Hall Booking web app on http://localhost:8090 (keep this window open).
rem Needs Camunda (start-camunda.cmd), the booking service (start-mock.cmd) and the worker (start-worker.cmd).
set "APP_PORT=8090"
set "CAMUNDA_URL=http://localhost:8080"
set "MOCK_BASE_URL=http://127.0.0.1:3000"
node "%~dp0..\app\server.js"
