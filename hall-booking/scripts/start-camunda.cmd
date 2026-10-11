@echo off
rem Starts Camunda 8 Run (Zeebe, Operate, Tasklist, Connectors, Elasticsearch).
rem JAVA_HOME must point at a folder that contains only the JDK (c8run searches it for "java").
rem MOCK_BASE_URL is read by the connectors runtime as {{secrets.MOCK_BASE_URL}}.
set "C8RUN=E:\camunda8-run-8.8-windows-x86_64\c8run-8.8.32"
set "JAVA_HOME=E:\jdk-21.0.6"
set "MOCK_BASE_URL=http://127.0.0.1:3000"
cd /d "%C8RUN%"
"%C8RUN%\c8run.exe" start
