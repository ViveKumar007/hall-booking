@echo off
rem Starts Camunda 8 Run (Zeebe, Operate, Tasklist, Connectors, Elasticsearch).
rem JAVA_HOME must point at a folder that contains only the JDK (c8run searches it for "java").
rem The connectors runtime reads its secrets from environment variables, as {{secrets.NAME}} in the BPMN:
rem   BOOKING_API_URL (booking register in the Spring Boot backend), SMTP_HOST, SMTP_PORT, SMTP_USERNAME, SMTP_PASSWORD, MAIL_FROM (from secrets.cmd).
set "C8RUN=E:\camunda8-run-8.8-windows-x86_64\c8run-8.8.32"
set "JAVA_HOME=E:\jdk-21.0.6"
set "BOOKING_API_URL=http://127.0.0.1:8090/register"
if not exist "%~dp0secrets.cmd" copy /y "%~dp0secrets.example.cmd" "%~dp0secrets.cmd" >nul
call "%~dp0secrets.cmd"
cd /d "%C8RUN%"
"%C8RUN%\c8run.exe" start
