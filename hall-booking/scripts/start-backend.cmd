@echo off
rem Starts the Spring Boot backend on http://localhost:8090. Keep this window open. It serves:
rem   - the web pages and their REST API (/api/...),
rem   - the booking register the BPMN's REST connectors call (/register/...), stored in H2 (backend-springboot\data),
rem   - the Zeebe job workers (validate-booking, send-reminder, record-notification),
rem and deploys the BPMN, DMN and forms at startup. Needs Camunda (start-camunda.cmd) and JDK 21.
rem The first start downloads Maven and the libraries (internet needed), later starts take about 20 s.
set "JAVA_HOME=E:\jdk-21.0.6"
if not exist "%~dp0secrets.cmd" copy /y "%~dp0secrets.example.cmd" "%~dp0secrets.cmd" >nul
call "%~dp0secrets.cmd"
cd /d "%~dp0..\..\backend-springboot"
call "%~dp0..\..\backend-springboot\mvnw.cmd" -B spring-boot:run
