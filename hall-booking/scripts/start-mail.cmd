@echo off
rem Starts the local mail server (MailDev): SMTP on 127.0.0.1:1025, inbox on http://localhost:1080. Keep this window open.
rem The Email connector in hall-booking.bpmn sends every requester notification here. Nothing leaves this computer.
rem SMTP login comes from secrets.cmd (created from secrets.example.cmd on the first run).
if not exist "%~dp0secrets.cmd" copy /y "%~dp0secrets.example.cmd" "%~dp0secrets.cmd" >nul
call "%~dp0secrets.cmd"
if /i not "%SMTP_HOST%"=="127.0.0.1" if /i not "%SMTP_HOST%"=="localhost" (
  echo Real mail is on ^(SMTP_HOST=%SMTP_HOST%^): the local mail server is not needed.
  exit /b 0
)
npx --yes maildev@3.0.0 --ip 127.0.0.1 --smtp %SMTP_PORT% --web 1080 --web-ip 127.0.0.1 --incoming-user %SMTP_USERNAME% --incoming-pass %SMTP_PASSWORD% --hide-extensions STARTTLS
