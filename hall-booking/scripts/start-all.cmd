@echo off
rem Opens everything for a demo, each in its own window: booking service, Camunda, worker, web app.
rem Camunda needs 1-3 minutes; the app's status lights turn green when each part is ready.
start "Booking service" cmd /k "%~dp0start-mock.cmd"
start "Camunda" cmd /k "%~dp0start-camunda.cmd"
start "Worker" cmd /k "%~dp0start-worker.cmd"
start "Web app" cmd /k "%~dp0start-app.cmd"
ping -n 6 127.0.0.1 >nul
start "" http://localhost:8090
