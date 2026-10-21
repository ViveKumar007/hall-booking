@echo off
rem Starts the external job worker: validate-booking, publish-message, send-reminder, send-notification.
rem Keep this window open: it prints every job it handles. Emails it "sends" are saved in worker\outbox.
set "CAMUNDA_URL=http://localhost:8080"
set "MOCK_BASE_URL=http://127.0.0.1:3000"
node "%~dp0..\worker\worker.js"
