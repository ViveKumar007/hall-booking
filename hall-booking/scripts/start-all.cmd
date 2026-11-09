@echo off
rem Opens everything for a demo, each in its own window: mail server, Camunda, Spring Boot backend.
rem Camunda needs 1-3 minutes and the backend about 20 s; the app's status lights turn green when each part is ready.
start "Mail server" cmd /k "%~dp0start-mail.cmd"
start "Camunda" cmd /k "%~dp0start-camunda.cmd"
start "Backend" cmd /k "%~dp0start-backend.cmd"
ping -n 31 127.0.0.1 >nul
start "" http://localhost:8090
