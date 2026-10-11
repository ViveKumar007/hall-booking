@echo off
rem Stops everything started by start-camunda.cmd.
set "C8RUN=E:\camunda8-run-8.8-windows-x86_64\c8run-8.8.32"
set "JAVA_HOME=E:\jdk-21.0.6"
cd /d "%C8RUN%"
"%C8RUN%\c8run.exe" stop
pause
